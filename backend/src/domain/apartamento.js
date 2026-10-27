// Interpretación PURA de lo que el operador escribe al buscar un residente (T2.2).
// Sin Prisma ni red. La clave física del apartamento sigue siendo
// services/apartamento.service.js (torre en MAYÚSCULAS + apto solo dígitos);
// aquí solo se entiende el texto de búsqueda y se compara contra lo guardado.
//
// Formato real guardado (registro: auth.controller.js -> normalizarTorre/Apto):
//   torre: "TORRE 1".."TORRE 6" (el <select> del registro envía "Torre N", se
//          guarda en MAYÚSCULAS); datos creados a mano pueden traer "T1" o "1".
//   apto:  solo dígitos ("402").
// Por eso las torres se comparan por su "token" (tokenTorre): "TORRE 2", "T2" y
// "2" son la misma torre.

// Quita tildes/diacríticos y pasa a minúsculas: "Gómez" -> "gomez".
export function sinTildes(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Token canónico de una torre guardada o escrita: "TORRE 2" | "T2" | "2" -> "2";
// "Torre A" -> "A". null si no hay torre.
export function tokenTorre(torre) {
  if (torre == null) return null;
  let t = sinTildes(torre).trim().toUpperCase();
  t = t.replace(/^TORRE\b\s*/, '').replace(/[^A-Z0-9]/g, '');
  t = t.replace(/^T(?=\d)/, '').replace(/^0+(?=\d)/, '');
  return t || null;
}

// Etiqueta legible: torre numérica o de una letra -> "T2 · 304"; torre con
// nombre largo (p. ej. "NORTE") se deja tal cual; sin torre -> solo apto.
export function etiquetaApartamento(torre, apto) {
  const tok = tokenTorre(torre);
  const t = tok ? (/^(\d+|[A-Z])$/.test(tok) ? `T${tok}` : tok) : null;
  if (t && apto) return `${t} · ${apto}`;
  return t || apto || '';
}

const PALABRAS_APTO = new Set(['apto', 'apt', 'ap', 'apartamento']);
const PALABRAS_TORRE = new Set(['torre', 'tor', 't']);

/**
 * Interpreta el texto de búsqueda. Devuelve { torre?, apto?, texto? }:
 *  - apto: solo dígitos. Con o sin torre es prefijo ("30" -> 301..309);
 *    eso lo decide la consulta.
 *  - torre: token canónico ("2", "A").
 *  - texto: texto libre sin tildes/minúsculas, para buscar en el nombre.
 * Formatos: "304", "T2 304", "t2-304", "2-304", "2 304", "2/304",
 * "Torre 2 apto 304", y nombres ("ana", "Ana Gó").
 */
export function interpretarBusqueda(q) {
  const crudo = sinTildes(q).trim();
  if (!crudo) return {};

  const partes = crudo.split(/[\s\-/·.,#_:]+/).filter(Boolean);
  const nums = [];
  let torreExplicita = null;
  let esperaTorre = false;
  let esClave = true;

  for (const p of partes) {
    if (PALABRAS_TORRE.has(p)) { esperaTorre = true; continue; }
    if (PALABRAS_APTO.has(p)) { esperaTorre = false; continue; }
    const mT = /^t(\d+)$/.exec(p);
    if (mT) { torreExplicita = mT[1]; esperaTorre = false; continue; }
    if (esperaTorre && /^([a-z]|\d+)$/.test(p)) { torreExplicita = p.toUpperCase(); esperaTorre = false; continue; }
    if (/^\d+$/.test(p)) { nums.push(p); esperaTorre = false; continue; }
    esClave = false;
    break;
  }

  const hayClave = torreExplicita !== null || nums.length > 0;
  if (!esClave || !hayClave || nums.length > 2 || (torreExplicita !== null && nums.length > 1)) {
    return { texto: crudo.replace(/\s+/g, ' ') };
  }

  const sinCeros = (s) => s.replace(/^0+(?=\d)/, '');
  const out = {};
  if (torreExplicita !== null) {
    out.torre = sinCeros(torreExplicita);
    if (nums.length === 1) out.apto = nums[0];
  } else if (nums.length === 2) {
    out.torre = sinCeros(nums[0]);
    out.apto = nums[1];
  } else {
    out.apto = nums[0];
  }
  return out;
}
