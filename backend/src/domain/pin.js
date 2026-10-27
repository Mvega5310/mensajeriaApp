// Límite de intentos del PIN de entrega (T1.4). Lógica PURA: sin reloj propio
// (`ahora` entra por parámetro), sin base de datos. La persistencia vive en
// services/pin.service.js (registrarIntentoPin).

export const PIN_MAX_INTENTOS = 5;
export const PIN_BLOQUEO_MIN = 15;

const MS_MIN = 60 * 1000;

function minutosHasta(fecha, ahora) {
  return Math.max(1, Math.ceil((fecha.getTime() - ahora.getTime()) / MS_MIN));
}

/**
 * Evalúa un intento de PIN y dice qué guardar.
 *
 * @param {object} p
 * @param {number} p.intentos        fallos acumulados guardados.
 * @param {Date|null} p.bloqueadoHasta  bloqueo guardado (puede estar vencido).
 * @param {Date} p.ahora
 * @param {boolean} p.correcto       si el PIN enviado coincide.
 * @param {number} [p.max=5]
 * @param {number} [p.bloqueoMin=15]
 * @returns {{permitido:boolean, bloquear:boolean, nuevosIntentos:number,
 *   bloqueadoHasta:Date|null, minutosRestantes:number, intentosRestantes:number}}
 *  - permitido: el intento se pudo evaluar (false = estaba bloqueado; aunque el
 *    PIN sea correcto no se acepta).
 *  - bloquear: este intento fallido dispara el bloqueo.
 *  - minutosRestantes: del bloqueo vigente (0 si no hay).
 */
export function evaluarIntento({ intentos, bloqueadoHasta, ahora, correcto, max = PIN_MAX_INTENTOS, bloqueoMin = PIN_BLOQUEO_MIN }) {
  if (bloqueadoHasta && bloqueadoHasta.getTime() > ahora.getTime()) {
    return {
      permitido: false,
      bloquear: false,
      nuevosIntentos: intentos,
      bloqueadoHasta,
      minutosRestantes: minutosHasta(bloqueadoHasta, ahora),
      intentosRestantes: 0,
    };
  }

  if (correcto) {
    return { permitido: true, bloquear: false, nuevosIntentos: 0, bloqueadoHasta: null, minutosRestantes: 0, intentosRestantes: max };
  }

  // Un bloqueo ya vencido arranca la cuenta de nuevo.
  const base = bloqueadoHasta ? 0 : intentos;
  const nuevosIntentos = base + 1;
  if (nuevosIntentos >= max) {
    const hasta = new Date(ahora.getTime() + bloqueoMin * MS_MIN);
    return { permitido: true, bloquear: true, nuevosIntentos, bloqueadoHasta: hasta, minutosRestantes: bloqueoMin, intentosRestantes: 0 };
  }
  return {
    permitido: true,
    bloquear: false,
    nuevosIntentos,
    bloqueadoHasta: null,
    minutosRestantes: 0,
    intentosRestantes: max - nuevosIntentos,
  };
}
