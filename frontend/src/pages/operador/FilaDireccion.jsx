import { detalleDireccion } from '../../utils/direccion.js';

/** Fila de una dirección en los resultados del operador: apartamento, nombre y, debajo, el
 *  discriminador ("•••• 4567 · nueva · 2 entregas") para no confundir a dos personas con el
 *  mismo nombre. `children` va a la derecha (chip de pendientes, flecha). */
export default function FilaDireccion({ r, onClick, disabled, children }) {
  const detalle = detalleDireccion(r);
  return (
    <button type="button" className="op-sug" disabled={disabled} onClick={onClick}>
      <span className="op-sug__apto">{r.etiqueta}</span>
      <span className="op-sug__col">
        <span className="op-sug__nombre">{r.nombre}</span>
        {detalle && <span className="op-sug__meta">{detalle}</span>}
      </span>
      {children}
    </button>
  );
}
