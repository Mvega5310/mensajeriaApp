import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Button, Toast } from '../design';
import { confirmPasswordReset } from '../services/auth.js';
import PasswordField from '../components/PasswordField.jsx';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const irA = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await confirmPasswordReset(token, password);
      setDone(true);
      setTimeout(() => irA('/login', { replace: true }), 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="auth-card">
        <h1>Este enlace ya no sirve</h1>
        <p className="auth-sub">Pide uno nuevo para crear tu contraseña.</p>
        <Button as={Link} to="/recuperar">Pedir enlace</Button>
      </div>
    );
  }

  return (
    <div className="auth-card">
      <h1>Crear nueva contraseña</h1>
      {done ? (
        <p role="status">Contraseña actualizada. Te llevamos a entrar…</p>
      ) : (
        <form onSubmit={handleSubmit}>
          <PasswordField id="password" label="Nueva contraseña" value={password} autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)} minLength={8}
            pattern="(?=.*[A-Za-z])(?=.*\d).{8,}"
            hint="Mínimo 8 caracteres, con al menos una letra y un número." />
          {error && <Toast tipo="error">{error}</Toast>}
          <Button type="submit" disabled={loading} aria-busy={loading}>{loading ? 'Guardando…' : 'Guardar contraseña'}</Button>
        </form>
      )}
    </div>
  );
}
