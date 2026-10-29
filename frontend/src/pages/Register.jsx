import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Button, Field, Toast } from '../design';
import { register } from '../services/auth.js';
import { getConfigPublica } from '../services/conjunto.js';
import PasswordField from '../components/PasswordField.jsx';

const initial = { email: '', password: '', nombre: '', telefono: '', torre: 'Torre 1', apto: '', acceptedTerms: false };

export default function Register() {
  const [searchParams] = useSearchParams();
  // Código de invitación del enlace/QR (KAN-8). Los flyers antiguos (KAN-3)
  // apuntan a la raíz sin ?c=. Sin código, el backend acepta el registro solo
  // mientras exista UN ÚNICO conjunto (config-publica sin ?c= responde 200); si
  // hay varios, responde 400 y se pide el código a mano.
  const codigoDeUrl = (searchParams.get('c') || '').trim();
  // QR nuevo (S1.3): `?conjunto=<slug>` llega con el conjunto ya elegido. El selector visual llega en S2.3.
  const slugDeUrl = (searchParams.get('conjunto') || '').trim();

  const [fields, setFields] = useState(initial);
  // Código escrito a mano. Cuando NO hay ?c= arranca vacío; si un ?c= resulta
  // inválido, se precarga aquí con el valor de la URL para poder corregirlo.
  const [codigoManual, setCodigoManual] = useState('');
  // Sin ?c=, el campo de código queda oculto hasta saber si hace falta (varios
  // conjuntos). Con ?c=, solo aparece si ese código falla y hay que corregirlo.
  const [mostrarCampoCodigo, setMostrarCampoCodigo] = useState(false);
  // Datos públicos del conjunto (nombre, punto de recepción) para mostrarlos.
  const [conjunto, setConjunto] = useState(null);
  const [cargandoConjunto, setCargandoConjunto] = useState(true);

  useEffect(() => {
    let vigente = true;
    setCargandoConjunto(true);
    getConfigPublica(codigoDeUrl, slugDeUrl)
      .then((cfg) => { if (vigente) setConjunto(cfg); })
      .catch((err) => {
        if (!vigente) return;
        setConjunto(null);
        // Sin ?c= y el backend no resuelve un conjunto único (hay varios): el
        // residente debe escribir su código. Ante otro error (red) no se exige:
        // si hiciera falta, el propio registro lo pide (ver handleSubmit).
        if (!codigoDeUrl && !slugDeUrl && (err.code === 'INVITACION_INVALIDA' || err.code === 'CONJUNTO_REQUERIDO')) setMostrarCampoCodigo(true);
      })
      .finally(() => { if (vigente) setCargandoConjunto(false); });
    return () => { vigente = false; };
  }, [codigoDeUrl, slugDeUrl]);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const irA = useNavigate();

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
      await register({ ...fields, codigoInvitacion, ...(slugDeUrl ? { conjunto: slugDeUrl } : {}) });
      setDone(true);
      setTimeout(() => irA('/login', { replace: true }), 1200);
    } catch (err) {
      setError(err.message);
      // Detección por código estable (no por texto): si falló por el código y
      // venía de la URL, mostramos el campo precargado con ese valor para que el
      // residente lo corrija sin perder lo demás.
      if ((err.code === 'INVITACION_INVALIDA' || err.code === 'CONJUNTO_REQUERIDO') && !mostrarCampoCodigo) {
        setCodigoManual(codigoDeUrl);
        setMostrarCampoCodigo(true);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-card">
      <h1>Crear cuenta de residente</h1>
      <p className="auth-sub">
        {conjunto
          ? `Te estás registrando en ${conjunto.nombre}.`
          : 'Regístrate con el enlace o el código de invitación que te entregó el operador de tu conjunto.'}
      </p>
      {conjunto?.puntoRecepcion && (
        <p className="auth-sub">Punto de recepción: {conjunto.puntoRecepcion}</p>
      )}

      {cargandoConjunto ? (
        <p role="status">Cargando…</p>
      ) : done ? (
        <p role="status">Cuenta creada. Te llevamos a entrar…</p>
      ) : (
        <form onSubmit={handleSubmit}>
          {/* Se muestra si el código NO viene en la URL (flyers KAN-3 sin ?c=)
              o si un ?c= resultó inválido y hay que corregirlo. */}
          {mostrarCampoCodigo && (
            <Field label="Código de invitación" id="codigoInvitacion" required autoCapitalize="off" autoCorrect="off"
              spellCheck={false} placeholder="Ej. conjunto-K7Q2M9XR4TV" value={codigoManual}
              ayuda="Te lo entrega el operador de tu conjunto residencial."
              onChange={(e) => setCodigoManual(e.target.value)}
              onBlur={(e) => setCodigoManual(e.target.value.trim())} />
          )}
          <Field label="Nombre completo" id="nombre" required value={fields.nombre} onChange={(e) => update('nombre', e.target.value)} />
          <Field label="Correo" id="email" type="email" required autoComplete="email" value={fields.email} onChange={(e) => update('email', e.target.value)} />
          <PasswordField id="password" value={fields.password} autoComplete="new-password" onChange={(e) => update('password', e.target.value)}
            minLength={8} pattern="(?=.*[A-Za-z])(?=.*\d).{8,}"
            hint="Mínimo 8 caracteres, con al menos una letra y un número." />
          <Field label="Teléfono (WhatsApp)" id="telefono" type="tel" inputMode="numeric" required pattern="[0-9]{10}" title="10 dígitos"
            value={fields.telefono} onChange={(e) => update('telefono', e.target.value)} />
          <div className="auth-dos">
            <div className="ds-field">
              <label className="ds-field__label" htmlFor="torre">Torre</label>
              <select id="torre" className="auth-select" value={fields.torre} onChange={(e) => update('torre', e.target.value)}>
                {[1, 2, 3, 4, 5, 6].map((n) => <option key={n}>{`Torre ${n}`}</option>)}
              </select>
            </div>
            <Field label="Apartamento" id="apto" required placeholder="Ej. 402" mono value={fields.apto} onChange={(e) => update('apto', e.target.value)} />
          </div>

          <label className="auth-check">
            <input type="checkbox" required checked={fields.acceptedTerms}
              onChange={(e) => update('acceptedTerms', e.target.checked)} />
            <span>
              Acepto los <Link
                to={codigoInvitacion ? `/terminos?c=${encodeURIComponent(codigoInvitacion)}` : '/terminos'}
                target="_blank" rel="noreferrer">Términos y Condiciones y el Aviso de Tratamiento de Datos</Link>.
            </span>
          </label>

          {error && <Toast tipo="error">{error}</Toast>}
          <Button type="submit" disabled={loading || !fields.acceptedTerms} aria-busy={loading}>{loading ? 'Creando…' : 'Crear cuenta'}</Button>
        </form>
      )}

      <p className="auth-switch">¿Ya tienes cuenta? <Link to="/login">Entra aquí</Link></p>
    </div>
  );
}
