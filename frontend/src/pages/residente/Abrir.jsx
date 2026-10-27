import { Navigate } from 'react-router-dom';
import useAbrirEnlace from '../../hooks/residente/useAbrirEnlace.js';
import EnlaceInvalido from './EnlaceInvalido.jsx';
import Pantalla from './Pantalla.jsx';

/** /p (enlace de WhatsApp, `/p#<token>`): canjea el token y entra a Mis paquetes sin contraseña. */
export default function Abrir() {
  const estado = useAbrirEnlace();
  if (estado === 'listo') return <Navigate to="/paquetes" replace />;
  if (estado === 'invalido') return <EnlaceInvalido />;
  return (
    <Pantalla>
      <div className="res-centro" role="status">
        <span className="res-logo">Puerta<b>yá</b></span>
        <p>Abriendo tus paquetes…</p>
      </div>
    </Pantalla>
  );
}
