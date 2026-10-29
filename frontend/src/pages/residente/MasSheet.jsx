import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Sheet, ThemeToggle } from '../../design';
import { logout } from '../../services/auth.js';
import useDirecciones from '../../hooks/residente/useDirecciones.js';
import useBonosHabilitados from '../../hooks/residente/useBonosHabilitados.js';
import { limpiarSesionEnlace } from '../../hooks/residente/sesionEnlace.js';

/** Hoja "Más" de Mis paquetes: buzón, Términos, tema y cerrar sesión. */
export default function MasSheet({ open, onClose, modo }) {
  const navigate = useNavigate();
  const dir = useDirecciones(modo === 'normal' && open);
  const [verDirs, setVerDirs] = useState(false);
  const bonosHabilitados = useBonosHabilitados(modo === 'normal' && open);
  function salir() {
    logout();
    limpiarSesionEnlace();
    navigate('/acceso', { replace: true });
  }
  const cerrar = () => { setVerDirs(false); onClose(); };
  const variosConjuntos = dir.conjuntosDePersona.length > 1;
  if (verDirs) {
    return (
      <Sheet open={open} onClose={cerrar} title="Mis direcciones">
        <ul className="res-lista" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {dir.direcciones.map((d) => (
            <li key={d.id} className="res-hist">
              <span className="res-linea">{[d.conjunto?.nombre, d.etiqueta, d.nombreRecibe].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ul>
        <Button variante="secundario" onClick={() => setVerDirs(false)}>Volver</Button>
      </Sheet>
    );
  }
  return (
    <Sheet open={open} onClose={cerrar} title="Más">
      {modo === 'normal' && (
        <Button as={Link} to="/paquetes/buzon" variante="secundario">Escribir al operador</Button>
      )}
      {modo === 'normal' && bonosHabilitados && (
        <Button as={Link} to="/paquetes/bonos" variante="secundario">Mis bonos</Button>
      )}
      {modo === 'normal' && (dir.direcciones.length > 1 || variosConjuntos) && (
        <Button variante="secundario" onClick={() => setVerDirs(true)}>Mis direcciones</Button>
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
