import { Link } from 'react-router-dom';
import './residente.css';

/** Marco de toda pantalla del residente: contenedor .pt (tema) + columna de 520 px. */
export default function Pantalla({ children }) {
  return (
    <div className="pt res-root">
      <main className="res">{children}</main>
    </div>
  );
}

/** Cabecera de marca. `children` va a la derecha (acciones). */
export function Marca({ children }) {
  return (
    <div className="res-marca">
      <Link to="/paquetes" className="res-marca__logo" style={{ textDecoration: 'none' }}>Puerta<b>yá</b></Link>
      {children && <div className="res-marca__der">{children}</div>}
    </div>
  );
}

/** Pantalla de un solo mensaje con salida (enlace inválido, error de carga). */
export function MensajeCentral({ titulo, texto, children }) {
  return (
    <Pantalla>
      <div className="res-centro">
        <span className="res-logo">Puerta<b>yá</b></span>
      </div>
      <div className="res-panel" role="alert">
        <h1>{titulo}</h1>
        <p>{texto}</p>
      </div>
      <div className="res__relleno" />
      <div className="res__acciones">{children}</div>
    </Pantalla>
  );
}
