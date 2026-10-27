import { Field } from '../../design';
import { NOMBRES_CORTOS } from '../../utils/tiers.js';

/** Campos opcionales del aviso (lo que pedía el formulario viejo): tienda, tamaño, contra entrega,
 *  valor declarado, PIN del proveedor y nota. `set(campo, valor)` actualiza el formulario. */
export default function DetallesAviso({ form, set }) {
  return (
    <div className="res-detalles">
      <Field label="Tienda (si la sabes)" placeholder="Mercado Libre, Amazon…" value={form.tienda}
        onChange={(e) => set('tienda', e.target.value)} maxLength={80} />
      <div className="res-seccion" style={{ padding: 0 }}>
        <span className="res-etiqueta">Tamaño aproximado</span>
        <div role="radiogroup" aria-label="Tamaño aproximado" className="res-chips">
          {Object.entries(NOMBRES_CORTOS).map(([valor, { nombre }]) => (
            <button key={valor} type="button" role="radio" aria-checked={form.categoriaPeso === valor}
              className="res-chip" onClick={() => set('categoriaPeso', valor)}>{nombre}</button>
          ))}
        </div>
        <span className="ds-field__ayuda">Es un estimado. El operador confirma el tamaño real al recibirlo.</span>
      </div>
      <label className="res-check">
        <input type="checkbox" checked={form.contraEntrega} onChange={(e) => set('contraEntrega', e.target.checked)} />
        Es contra entrega
      </label>
      {form.contraEntrega && (
        <Field label="Monto a pagar al transportista" type="number" inputMode="numeric" min="0" mono
          value={form.valorProducto} onChange={(e) => set('valorProducto', e.target.value)} />
      )}
      <Field label="Valor declarado" type="number" inputMode="numeric" min="0" mono value={form.valorDeclarado}
        onChange={(e) => set('valorDeclarado', e.target.value)}
        ayuda="Opcional. Es el tope que reconocemos si se daña o se pierde en custodia." />
      <Field label="PIN del proveedor" mono maxLength={30} value={form.pinProveedor}
        onChange={(e) => set('pinProveedor', e.target.value)}
        ayuda="Opcional. Algunas tiendas dan un código para su mensajero. No es tu PIN de entrega." />
      <div className="ds-field">
        <label className="ds-field__label" htmlFor="aviso-nota">Nota para el operador</label>
        <textarea id="aviso-nota" className="res-area" rows={3} maxLength={500} value={form.notas}
          onChange={(e) => set('notas', e.target.value)} />
      </div>
    </div>
  );
}
