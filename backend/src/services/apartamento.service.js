// Identifica un apartamento físico de forma consistente, sin importar
// cómo haya escrito cada cuenta su torre/apto — necesario porque la
// cortesía de primera entrega es por apartamento, no por cuenta (varias
// personas del mismo apto pueden registrarse con correos distintos).

import { tokenTorre } from '../domain/apartamento.js';

// trim + mayúsculas: cierra el caso más común de inconsistencia de
// escritura (espacios, minúsculas). No intenta mapear abreviaturas tipo
// "T1" a "Torre 1" — eso requeriría una lista fija de torres válidas
// del conjunto, fuera de alcance por ahora.
export function normalizarTorre(torre) {
  if (torre == null || torre === '') return null;
  // Un número u otro tipo no-texto (p. ej. torre: 2 en el JSON) no debe tumbar con un 500.
  const limpio = String(torre).trim().toUpperCase();
  return limpio || null;
}

// trim + solo dígitos: "302", "Apto 302", "apto-302" → todos "302".
export function normalizarApto(apto) {
  if (apto == null || apto === '') return null;
  const soloDigitos = String(apto).replace(/\D/g, '');
  return soloDigitos || null;
}

// Clave física del apartamento. La torre se normaliza con `tokenTorre`
// (domain/apartamento.js): "TORRE 2", "Torre 2", "T2" y "2" son LA MISMA torre,
// así que 'TORRE 2'/710 y 'T2'/710 comparten cortesía, lote de entrega y etiqueta.
//
// null si torre o apto vienen incompletos — a propósito: sin eso, cualquier cuenta
// sin apto quedaría agrupada con cualquier OTRA cuenta sin apto, como si fueran el
// mismo apartamento. Quien llama debe tratar null como "no se puede agrupar por
// apartamento, usar la cuenta sola".
export function claveApartamento(torre, apto) {
  const t = tokenTorre(torre);
  const a = normalizarApto(apto);
  if (!t || !a) return null;
  return `${t}|${a}`;
}

/**
 * Clave del apartamento de una cuenta residente: la física si torre/apto están
 * completos; si no, la cuenta sola (`cuenta:<id>`). Es la clave de la cortesía,
 * del lote de entrega y de la reserva `CortesiaApartamento`.
 */
export function claveDeResidente(residente) {
  return claveApartamento(residente.torre, residente.apto) || `cuenta:${residente.id}`;
}
