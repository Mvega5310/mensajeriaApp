import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Field, Toast } from '../design';
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
    <div className="auth-card">
      <h1>Recuperar contraseña</h1>
      <p className="auth-sub">Te enviamos un enlace para crear una nueva contraseña.</p>
      {sent ? (
        <p role="status">Si ese correo está registrado, en unos minutos te llega un enlace para restablecer tu contraseña.</p>
      ) : (
        <form onSubmit={handleSubmit}>
          <Field label="Correo" id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          {error && <Toast tipo="error">{error}</Toast>}
          <Button type="submit" disabled={loading} aria-busy={loading}>{loading ? 'Enviando…' : 'Enviar enlace'}</Button>
        </form>
      )}
      <p className="auth-switch"><Link to="/login">Volver a entrar</Link></p>
    </div>
  );
}
