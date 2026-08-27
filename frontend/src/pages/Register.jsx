import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { register } from '../services/auth.js';
import PasswordField from '../components/PasswordField.jsx';

const initial = { email: '', password: '', nombre: '', telefono: '', torre: 'Torre 1', apto: '', acceptedTerms: false };

export default function Register() {
  const [fields, setFields] = useState(initial);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  function update(key, value) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(fields);
      setDone(true);
      setTimeout(() => navigate('/login', { replace: true }), 1200);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>Crear cuenta de residente</h1>
        <p className="sub">Solo residentes se registran aquí. La cuenta de operador se crea aparte.</p>

        {done ? (
          <p>Cuenta creada. Redirigiendo a iniciar sesión…</p>
        ) : (
          <form onSubmit={handleSubmit}>
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
                  <option>Torre 1</option>
                  <option>Torre 2</option>
                  <option>Torre 3</option>
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
