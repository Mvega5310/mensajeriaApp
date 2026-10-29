// Discriminador de una dirección en la lista del operador (revisión S3.2, C5): dos personas
// con el mismo nombre en el mismo apartamento se distinguen sin pedirle nada al residente.
// Texto exacto de la fila:  "•••• 4567 · nueva · 2 entregas"  /  "•••• 0001 · desde mar 2026 · sin entregas".

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "desde mar 2026" (mes y año del alta, hora local). */
export function desdeMesAnio(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `desde ${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

/** Línea de detalle de un resultado de búsqueda: teléfono (4 últimos), antigüedad y entregas. */
export function detalleDireccion(r) {
  const partes = [];
  if (r.telefonoFin) partes.push(`•••• ${r.telefonoFin}`);
  if (r.esNueva) partes.push('nueva');
  else if (r.creadoEn) partes.push(desdeMesAnio(r.creadoEn));
  if (r.entregados > 0) partes.push(`${r.entregados} ${r.entregados === 1 ? 'entrega' : 'entregas'}`);
  else if (r.posibleDuplicado) partes.push('sin entregas');
  return partes.filter(Boolean).join(' · ');
}

const clave = (r) => `${r.etiqueta}|${String(r.nombre ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()}`;

/** Aviso cuando hay 2+ personas con el mismo nombre en el mismo apartamento; null si no. */
export function avisoDuplicados(resultados) {
  const cuenta = new Map();
  for (const r of resultados) if (r.posibleDuplicado) cuenta.set(clave(r), (cuenta.get(clave(r)) ?? 0) + 1);
  if (cuenta.size === 0) return null;
  const n = Math.max(2, ...cuenta.values());
  return `Hay ${n} personas con este nombre en este apartamento: confirma el teléfono.`;
}
