import { useState } from 'react';
import { Link } from 'react-router-dom';
import { requestPasswordReset } from '../services/auth.js';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>Recuperar contraseña</h1>
        <p className="sub">Te enviamos un enlace para crear una nueva contraseña.</p>

        {sent ? (
          <p>Si ese correo está registrado, en unos minutos te llega un enlace para restablecer tu contraseña.</p>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="email">Correo</label>
              <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>

            {error && <p className="error-text">{error}</p>}

            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? 'Enviando…' : 'Enviar enlace'}
            </button>
          </form>
        )}

        <p className="auth-switch">
          <Link to="/login">Volver a iniciar sesión</Link>
        </p>
      </div>
    </div>
  );
}
