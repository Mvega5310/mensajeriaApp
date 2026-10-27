import { Navigate, useParams } from 'react-router-dom';
import { useCanjearAcceso } from '../../hooks/residente/useAcceso.js';
import { getRole } from '../../services/auth.js';
import Acceso from './Acceso.jsx';
import Pantalla from './Pantalla.jsx';

/** /acceso/:token (enlace del correo): canjea solo al cargar y entra; si falla, pide otro. */
export default function AccesoToken() {
  const { token } = useParams();
  const estado = useCanjearAcceso(token);
  if (estado === 'listo') return <Navigate to={getRole() === 'OPERATOR' ? '/op/recibir' : '/paquetes'} replace />;
  if (estado === 'invalido') return <Acceso aviso="Este enlace ya no sirve. Pide uno nuevo con tu correo." />;
  return (
    <Pantalla>
      <div className="res-centro" role="status">
        <span className="res-logo">Puerta<b>yá</b></span>
        <p>Entrando…</p>
      </div>
    </Pantalla>
  );
}
