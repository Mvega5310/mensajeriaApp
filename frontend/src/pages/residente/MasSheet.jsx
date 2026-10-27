import { Link, useNavigate } from 'react-router-dom';
import { Button, Sheet, ThemeToggle } from '../../design';
import { logout } from '../../services/auth.js';
import useBonosHabilitados from '../../hooks/residente/useBonosHabilitados.js';
import { limpiarSesionEnlace } from '../../hooks/residente/sesionEnlace.js';

/** Hoja "Más" de Mis paquetes: buzón, Términos, tema y cerrar sesión. */
export default function MasSheet({ open, onClose, modo }) {
  const navigate = useNavigate();
  const bonosHabilitados = useBonosHabilitados(modo === 'normal' && open);
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
      {modo === 'normal' && bonosHabilitados && (
        <Button as={Link} to="/paquetes/bonos" variante="secundario">Mis bonos</Button>
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
