// Fechas "de calendario" del conjunto (T2.7). Puras, sin Prisma.
// Colombia no tiene horario de verano: America/Bogota es UTC-5 todo el año, así
// que el día de Bogotá se calcula con un desfase fijo (sin librerías de zonas).

export const ZONA = 'America/Bogota';
const DESFASE_MS = 5 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;
const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Inicio (inclusive) del día de Bogotá que contiene `ahora`, como Date UTC. */
export function inicioDiaBogota(ahora = new Date()) {
  const local = new Date(ahora.getTime() - DESFASE_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + DESFASE_MS);
}

/** { inicio, fin } del día de Bogotá de `ahora`; fin es EXCLUSIVO (inicio del día siguiente). */
export function rangoHoyBogota(ahora = new Date()) {
  const inicio = inicioDiaBogota(ahora);
  return { inicio, fin: new Date(inicio.getTime() + DIA_MS) };
}

/**
 * Interpreta un filtro de fecha de la URL. "YYYY-MM-DD" es un día de Bogotá:
 * `desde` -> su inicio; `hasta` -> el inicio del día SIGUIENTE (límite EXCLUSIVO,
 * así "hasta" incluye todo ese día). Una fecha-hora ISO completa se usa tal cual
 * (para `hasta` se devuelve +1 ms, también como límite exclusivo).
 * Devuelve un Date o null si no es válida.
 */
export function parsearFiltroFecha(valor, tipo) {
  if (typeof valor !== 'string' || !valor) return null;
  if (SOLO_FECHA.test(valor)) {
    const [a, m, d] = valor.split('-').map(Number);
    const ini = new Date(Date.UTC(a, m - 1, d) + DESFASE_MS);
    // Rechaza días inexistentes (2026-02-31 se desbordaría a marzo).
    const comprobacion = new Date(ini.getTime() - DESFASE_MS);
    if (Number.isNaN(ini.getTime()) || comprobacion.getUTCMonth() !== m - 1 || comprobacion.getUTCDate() !== d) return null;
    return tipo === 'hasta' ? new Date(ini.getTime() + DIA_MS) : ini;
  }
  const t = new Date(valor);
  if (Number.isNaN(t.getTime())) return null;
  return tipo === 'hasta' ? new Date(t.getTime() + 1) : t;
}
