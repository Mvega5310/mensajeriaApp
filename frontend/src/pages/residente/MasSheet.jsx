import { Link, useNavigate } from 'react-router-dom';
import { Button, Sheet, ThemeToggle } from '../../design';
import { logout } from '../../services/auth.js';
import { limpiarSesionEnlace } from '../../hooks/residente/sesionEnlace.js';

/** Hoja "Más" de Mis paquetes: buzón, Términos, tema y cerrar sesión. */
export default function MasSheet({ open, onClose, modo }) {
  const navigate = useNavigate();
  function salir() {
    logout();
    limpiarSesionEnlace();
    navigate('/acceso', { replace: true });
  }
  return (
    <Sheet open={open} onClose={onClose} title="Más">
      {modo === 'normal' && (
        <Button as={Link} to="/paquetes/buzon" variante="secundario">Escribir al operador</Button>
      )}
      <Button as={Link} to="/terminos" variante="secundario">Ver términos</Button>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
        <span>Tema del día o la noche</span>
        <ThemeToggle />
      </div>
      <Button variante="secundario" onClick={salir}>Cerrar sesión</Button>
    </Sheet>
  );
}
