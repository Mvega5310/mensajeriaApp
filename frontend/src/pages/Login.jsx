import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Button, Field, Toast } from '../design';
import { login } from '../services/auth.js';
import PasswordField from '../components/PasswordField.jsx';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const irA = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      irA('/', { replace: true }); // la raíz lleva al operador a /op/recibir y al residente a /paquetes
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-card">
      <h1>Entra a tu cuenta</h1>
      <p className="auth-sub">Con tu correo y contraseña. Si prefieres, te enviamos un enlace sin contraseña.</p>
      <form onSubmit={handleSubmit}>
        <Field label="Correo" id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <PasswordField id="password" value={password} autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} />
        {error && <Toast tipo="error">{error}</Toast>}
        <Button type="submit" disabled={loading} aria-busy={loading}>{loading ? 'Entrando…' : 'Entrar'}</Button>
      </form>
      <Button as={Link} to="/acceso" variante="secundario">Entrar con correo</Button>
      <p className="auth-switch"><Link to="/recuperar">¿Olvidaste tu contraseña?</Link></p>
      <p className="auth-switch">¿Eres residente nuevo? <Link to="/registro">Crea tu cuenta</Link></p>
    </div>
  );
}
