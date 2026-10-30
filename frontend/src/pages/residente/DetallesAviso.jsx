import { Field } from '../../design';

/** Campos opcionales del aviso: tienda, contra entrega (y monto), valor declarado, PIN del
 *  proveedor y nota. El tamaño no se pregunta: lo elige el operador al recoger el paquete. `set(campo, valor)` actualiza el formulario. */
export default function DetallesAviso({ form, set }) {
  return (
    <div className="res-detalles">
      <Field label="Tienda (si la sabes)" placeholder="Mercado Libre, Amazon…" value={form.tienda}
        onChange={(e) => set('tienda', e.target.value)} maxLength={80} />
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
