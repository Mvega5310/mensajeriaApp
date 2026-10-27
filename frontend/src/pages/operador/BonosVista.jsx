import { useState } from 'react';
import { Button, Field, Toast } from '../../design';
import useBonos from '../../hooks/operador/useBonos.js';
import { formatCOP } from '../../utils/format.js';
import { tiersConCosto } from '../../utils/tiers.js';

/** Bonos del residente + alta de un bono nuevo (pago ya recibido). Solo con bonosHabilitados. */
export default function BonosVista({ residenteId, config, onVolver }) {
  const { bonos, error, guardando, crear } = useBonos(residenteId);
  const [form, setForm] = useState({ categoriaPeso: 'ESTANDAR', cantidad: '', precioPagado: '' });
  const tiers = tiersConCosto(config?.tarifas);

  async function enviar(e) {
    e.preventDefault();
    if (await crear(form)) setForm({ ...form, cantidad: '', precioPagado: '' });
  }

  return (
    <form className="op-hoja" onSubmit={enviar}>
      {bonos.length === 0 && <p className="op-muted">Todavía no tiene bonos.</p>}
      {bonos.map((b) => {
        const quedan = b.cantidadTotal - b.cantidadUsada;
        const nombre = tiers.find((t) => t.value === b.categoriaPeso)?.label ?? b.categoriaPeso;
        return (
          <div className="op-fila op-fila--lectura" key={b.id}>
            <b>{nombre} · pagó {formatCOP(b.precioPagado)}</b>
            <span className="op-muted">{quedan > 0 ? `Quedan ${quedan} de ${b.cantidadTotal}` : 'Agotado'}</span>
          </div>
        );
      })}
      <h3>Registrar bono</h3>
      <label className="ds-field__label" htmlFor="bono-cat">Categoría que cubre</label>
      <select id="bono-cat" className="op-select" value={form.categoriaPeso} onChange={(e) => setForm({ ...form, categoriaPeso: e.target.value })}>
        {tiers.map((t) => <option key={t.value} value={t.value}>{t.label}{t.costo != null ? ` · ${formatCOP(t.costo)}` : ''}</option>)}
      </select>
      <Field label="Cantidad de entregas" type="number" inputMode="numeric" min="1" required mono value={form.cantidad} onChange={(e) => setForm({ ...form, cantidad: e.target.value })} />
      <Field label="Precio total pagado" type="number" inputMode="numeric" min="0" required mono value={form.precioPagado} onChange={(e) => setForm({ ...form, precioPagado: e.target.value })} />
      {error && <Toast tipo="error">{error}</Toast>}
      <Button type="submit" variante="secundario" disabled={guardando}>{guardando ? 'Guardando' : 'Registrar bono'}</Button>
      <Button variante="secundario" onClick={onVolver}>Volver</Button>
    </form>
  );
}
