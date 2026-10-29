import { useState } from 'react';
import { Button, Field, Toast } from '../../design';
import useBitacora from '../../hooks/operador/useBitacora.js';
import { etiquetaApto, horaCorta } from '../../utils/apto.js';

const ESTADOS = [
  ['', 'Todos'], ['EN_RECEPCION', 'En portería'], ['PROGRAMADO', 'Programado'],
  ['ENTREGADO', 'Entregado'], ['SIN_ASIGNAR', 'Sin asignar'], ['PREALERTADO', 'Prealertado'],
];
const NOMBRE_ESTADO = Object.fromEntries(ESTADOS);

function dia(iso) {
  return iso ? new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : '';
}

/** Bitácora: lista paginada de todos los paquetes, con filtros por fecha, estado y texto. */
export default function BitacoraVista({ onVolver }) {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [estado, setEstado] = useState('');
  const [q, setQ] = useState('');
  const b = useBitacora({ desde, hasta, estado, q });

  return (
    <div className="op-hoja">
      <Field label="Buscar" placeholder="Apartamento, nombre o guía" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      <div className="op-fechas">
        <Field label="Desde" type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} />
        <Field label="Hasta" type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} />
      </div>
      <div className="ds-field">
        <label className="ds-field__label" htmlFor="bit-estado">Estado</label>
        <select id="bit-estado" className="ds-field__input" value={estado} onChange={(e) => setEstado(e.target.value)}>
          {ESTADOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
      </div>

      {b.error && <Toast tipo="error">{b.error}</Toast>}
      <p className="op-muted" aria-live="polite">{b.cargando ? 'Cargando…' : `${b.total} ${b.total === 1 ? 'paquete' : 'paquetes'}`}</p>
      {!b.cargando && !b.error && b.items.length === 0 && <p className="op-vacio">No hay paquetes con esos filtros. Cambia las fechas o el estado.</p>}
      {b.items.map((p) => (
        <div className="op-fila op-fila--lectura" key={p.id}>
          <b>
            {p.residente ? `${etiquetaApto(p.residente.torre, p.residente.apto)} · ${p.residente.nombre}` : `Etiqueta: ${p.etiquetaNombre ?? 'sin nombre'}`}
          </b>
          <span className="op-muted">
            {NOMBRE_ESTADO[p.estado] ?? p.estado} · {dia(p.recibidoEn ?? p.createdAt)} {horaCorta(p.recibidoEn ?? p.createdAt)}
            {p.guia && p.guia !== 'Sin Guía' ? ` · ${p.guia}` : ''}
          </span>
        </div>
      ))}
      {b.paginas > 1 && (
        <div style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
          <Button variante="secundario" disabled={b.pagina <= 1} onClick={() => b.setPagina(b.pagina - 1)}>Ver anteriores</Button>
          <span className="op-muted" style={{ whiteSpace: 'nowrap' }}>{b.pagina} de {b.paginas}</span>
          <Button variante="secundario" disabled={b.pagina >= b.paginas} onClick={() => b.setPagina(b.pagina + 1)}>Ver siguientes</Button>
        </div>
      )}
      <Button variante="secundario" onClick={onVolver}>Volver</Button>
    </div>
  );
}
