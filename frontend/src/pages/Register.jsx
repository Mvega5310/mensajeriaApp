import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { register } from '../services/auth.js';
import PasswordField from '../components/PasswordField.jsx';

const initial = { email: '', password: '', nombre: '', telefono: '', torre: 'Torre 1', apto: '', acceptedTerms: false };

export default function Register() {
  const [searchParams] = useSearchParams();
  // Código de invitación del enlace/QR (KAN-8). Los flyers antiguos (KAN-3)
  // apuntan a la raíz sin ?c=, así que si no viene en la URL se pide a mano.
  // NO hay código ni conjunto por defecto: si falta, el residente debe
  // escribir el que le entregó el operador de su conjunto.
  const codigoDeUrl = (searchParams.get('c') || '').trim();

  const [fields, setFields] = useState(initial);
  // Código escrito a mano. Cuando NO hay ?c= arranca vacío; si un ?c= resulta
  // inválido, se precarga aquí con el valor de la URL para poder corregirlo.
  const [codigoManual, setCodigoManual] = useState('');
  // El campo de código se muestra si no vino en la URL, o si un ?c= falló y hay
  // que dejar corregirlo.
  const [mostrarCampoCodigo, setMostrarCampoCodigo] = useState(!codigoDeUrl);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // El código efectivo: si el campo manual está visible, manda ese (es el que
  // el residente edita, incluido el caso de corregir un ?c= inválido); si no,
  // el de la URL. El backend normaliza caja y espacios (normalizarCodigoInvitacion).
  const codigoInvitacion = (mostrarCampoCodigo ? codigoManual : codigoDeUrl).trim();

  function update(key, value) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // El resto del formulario se conserva en `fields`; ante un error de
      // código no se pierde nada y el residente puede corregir el código.
      await register({ ...fields, codigoInvitacion });
      setDone(true);
      setTimeout(() => navigate('/login', { replace: true }), 1200);
    } catch (err) {
      setError(err.message);
      // Detección por código estable (no por texto): si falló por el código y
      // venía de la URL, mostramos el campo precargado con ese valor para que el
      // residente lo corrija sin perder lo demás.
      if (err.code === 'INVITACION_INVALIDA' && !mostrarCampoCodigo) {
        setCodigoManual(codigoDeUrl);
        setMostrarCampoCodigo(true);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>Crear cuenta de residente</h1>
        <p className="sub">
          Regístrate con el enlace o el código de invitación que te entregó el operador de tu conjunto.
        </p>

        {done ? (
          <p>Cuenta creada. Redirigiendo a iniciar sesión…</p>
        ) : (
          <form onSubmit={handleSubmit}>
            {/* Se muestra si el código NO viene en la URL (flyers KAN-3 sin ?c=)
                o si un ?c= resultó inválido y hay que corregirlo. */}
            {mostrarCampoCodigo && (
              <div className="field">
                <label htmlFor="codigoInvitacion">Código de invitación</label>
                <input
                  id="codigoInvitacion"
                  required
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="Ej. conjunto-K7Q2M9XR4TV"
                  value={codigoManual}
                  onChange={(e) => setCodigoManual(e.target.value)}
                  onBlur={(e) => setCodigoManual(e.target.value.trim())}
                />
                <p className="hint">Te lo entrega el operador de tu conjunto residencial.</p>
              </div>
            )}

            <div className="field">
              <label htmlFor="nombre">Nombre completo</label>
              <input id="nombre" required value={fields.nombre} onChange={(e) => update('nombre', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="email">Correo</label>
              <input id="email" type="email" required value={fields.email} onChange={(e) => update('email', e.target.value)} />
            </div>
            <PasswordField id="password" value={fields.password} onChange={(e) => update('password', e.target.value)}
              minLength={8} pattern="(?=.*[A-Za-z])(?=.*\d).{8,}"
              hint="Mínimo 8 caracteres, con al menos una letra y un número." />
            <div className="field">
              <label htmlFor="telefono">Teléfono (WhatsApp)</label>
              <input id="telefono" type="tel" required pattern="[0-9]{10}" title="10 dígitos" value={fields.telefono} onChange={(e) => update('telefono', e.target.value)} />
            </div>
            <div className="grid-2">
              <div className="field">
                <label htmlFor="torre">Torre</label>
                <select id="torre" value={fields.torre} onChange={(e) => update('torre', e.target.value)}>
                  {[1, 2, 3, 4, 5, 6].map((n) => <option key={n}>{`Torre ${n}`}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="apto">Apartamento</label>
                <input id="apto" required placeholder="Ej. 402" value={fields.apto} onChange={(e) => update('apto', e.target.value)} />
              </div>
            </div>

            <label className="terms-check">
              <input type="checkbox" required checked={fields.acceptedTerms}
                onChange={(e) => update('acceptedTerms', e.target.checked)} />
              <span>
                Acepto los <Link to="/terminos" target="_blank" rel="noreferrer">Términos y Condiciones y el Aviso de Tratamiento de Datos</Link>.
              </span>
            </label>

            {error && <p className="error-text">{error}</p>}

            <button className="btn btn-primary" type="submit" disabled={loading || !fields.acceptedTerms}>
              {loading ? 'Creando…' : 'Crear cuenta'}
            </button>
          </form>
        )}

        <p className="auth-switch">
          ¿Ya tienes cuenta? <Link to="/login">Inicia sesión</Link>
        </p>
      </div>
    </div>
  );
}
