import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { login } from '../services/auth.js';
import PasswordField from '../components/PasswordField.jsx';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>puertaya</h1>
        <p className="sub">Ingresa a tu cuenta de residente u operador.</p>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">Correo</label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <PasswordField id="password" value={password} onChange={(e) => setPassword(e.target.value)} />

          {error && <p className="error-text">{error}</p>}

          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>

        <p className="auth-switch">
          <Link to="/recuperar">¿Olvidaste tu contraseña?</Link>
        </p>
        <p className="auth-switch">
          ¿Eres residente nuevo? <Link to="/registro">Crea tu cuenta</Link>
        </p>
      </div>
    </div>
  );
}
