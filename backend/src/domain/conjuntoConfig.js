// Valores por defecto de la configuración del Conjunto cuando la columna es null.
// Franjas tomadas de frontend/src/utils/schedule.js (TIME_SLOTS); T2.6 las
// borra del frontend y quedan solo aquí.

export const FRANJAS_ENTREGA_DEFAULT = Object.freeze([
  '9:00 a.m. - 12:00 m.',
  '6:00 p.m. - 9:00 p.m.',
]);

/** Franjas efectivas del conjunto: su JSON si es un arreglo no vacío de textos; si no, el default. */
export function franjasDe(conjunto) {
  const f = conjunto?.franjasEntrega;
  if (Array.isArray(f) && f.length > 0 && f.every((x) => typeof x === 'string' && x.trim())) return [...f];
  return [...FRANJAS_ENTREGA_DEFAULT];
}
