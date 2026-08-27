import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { confirmPasswordReset } from '../services/auth.js';
import PasswordField from '../components/PasswordField.jsx';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await confirmPasswordReset(token, password);
      setDone(true);
      setTimeout(() => navigate('/login', { replace: true }), 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>Enlace inválido</h1>
          <p className="sub">Este enlace de restablecimiento no es válido. Pide uno nuevo.</p>
          <p className="auth-switch"><Link to="/recuperar">Solicitar enlace</Link></p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>Crear nueva contraseña</h1>
        {done ? (
          <p>Contraseña actualizada. Redirigiendo a iniciar sesión…</p>
        ) : (
          <form onSubmit={handleSubmit}>
            <PasswordField id="password" label="Nueva contraseña" value={password}
              onChange={(e) => setPassword(e.target.value)} minLength={8}
              pattern="(?=.*[A-Za-z])(?=.*\d).{8,}"
              hint="Mínimo 8 caracteres, con al menos una letra y un número." />

            {error && <p className="error-text">{error}</p>}

            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? 'Guardando…' : 'Guardar contraseña'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
