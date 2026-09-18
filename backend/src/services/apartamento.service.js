// Identifica un apartamento físico de forma consistente, sin importar
// cómo haya escrito cada cuenta su torre/apto — necesario porque la
// cortesía de primera entrega es por apartamento, no por cuenta (varias
// personas del mismo apto pueden registrarse con correos distintos).

// trim + mayúsculas: cierra el caso más común de inconsistencia de
// escritura (espacios, minúsculas). No intenta mapear abreviaturas tipo
// "T1" a "Torre 1" — eso requeriría una lista fija de torres válidas
// del conjunto, fuera de alcance por ahora.
export function normalizarTorre(torre) {
  if (!torre) return null;
  const limpio = torre.trim().toUpperCase();
  return limpio || null;
}

// trim + solo dígitos: "302", "Apto 302", "apto-302" → todos "302".
export function normalizarApto(apto) {
  if (!apto) return null;
  const soloDigitos = apto.replace(/\D/g, '');
  return soloDigitos || null;
}

// null si torre o apto vienen incompletos — a propósito: sin eso,
// cualquier cuenta sin apto quedaría agrupada con cualquier OTRA cuenta
// sin apto, como si fueran el mismo apartamento. Quien llama debe tratar
// null como "no se puede agrupar por apartamento, usar la cuenta sola".
export function claveApartamento(torre, apto) {
  const t = normalizarTorre(torre);
  const a = normalizarApto(apto);
  if (!t || !a) return null;
  return `${t}|${a}`;
}
