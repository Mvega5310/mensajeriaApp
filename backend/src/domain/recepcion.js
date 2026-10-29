// Reglas puras de la recepción de paquetes (T2.3). Sin Prisma ni red.

import { AppError, CODIGOS } from './errores.js';
import { esCategoriaValida } from './cobro.js';

export const GUIA_POR_DEFECTO = 'Sin Guía';
export const PROVEEDOR_POR_DEFECTO = 'Sin especificar';
const MAX_TEXTO = 120;

const invalido = (message, details) => new AppError(CODIGOS.DATOS_INVALIDOS, message, 400, details);

function textoOpcional(valor, campo, etiqueta) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') throw invalido(`${etiqueta} no es válido. Revísalo e intenta de nuevo.`, { campo });
  const t = valor.trim();
  if (!t) return null;
  if (t.length > MAX_TEXTO) {
    throw invalido(`${etiqueta} puede tener hasta ${MAX_TEXTO} caracteres. Acórtalo e intenta de nuevo.`, { campo });
  }
  return t;
}

export function mensajeMaxFotos(max) {
  if (max === 0) return 'Este conjunto no admite fotos al recibir. Quita las fotos e intenta de nuevo.';
  return `Puedes adjuntar hasta ${max} ${max === 1 ? 'foto' : 'fotos'}. Quita las que sobren e intenta de nuevo.`;
}

// Presupuesto de bytes de las fotos en el cuerpo JSON (data-URI base64). Se calcula,
// no se adivina: máx. razonable de fotos x tope por foto decodificada (1,5 MB, el de
// services/almacen/dataUri.js) x 1,37 (base64 + prefijo data:). Con 4 fotos son
// ~8,2 MB. El parser JSON de las dos rutas con fotos admite ese presupuesto más un
// margen para el resto de campos; el resto de la API se queda en 1 MB (app.js).
export const MAX_BYTES_FOTO_DECODIFICADA = 1.5 * 1024 * 1024;
export const MAX_FOTOS_RAZONABLE = 4;
export const FACTOR_BASE64 = 1.37;
export const PRESUPUESTO_FOTOS_BYTES = Math.ceil(MAX_FOTOS_RAZONABLE * MAX_BYTES_FOTO_DECODIFICADA * FACTOR_BASE64);
export const LIMITE_JSON_FOTOS_BYTES = PRESUPUESTO_FOTOS_BYTES + 1024 * 1024;

const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(1).replace('.', ',');

/** Valida `fotos` contra el máximo del conjunto y el presupuesto de bytes (lo comparten recepción y checkin). */
export function validarFotos(fotos, maxFotos) {
  if (fotos === undefined || fotos === null) return [];
  if (!Array.isArray(fotos) || fotos.length > maxFotos || fotos.some((f) => typeof f !== 'string' || !f)) {
    throw invalido(mensajeMaxFotos(maxFotos), { campo: 'fotos', max: maxFotos });
  }
  const total = fotos.reduce((s, f) => s + f.length, 0);
  if (total > PRESUPUESTO_FOTOS_BYTES) {
    throw new AppError(
      CODIGOS.CARGA_DEMASIADO_GRANDE,
      `Las fotos pesan demasiado en total (máximo ${mb(PRESUPUESTO_FOTOS_BYTES)} MB). Quita una foto o toma otras con menos resolución e intenta de nuevo.`,
      413,
      { campo: 'fotos', maxBytes: PRESUPUESTO_FOTOS_BYTES },
    );
  }
  return fotos;
}

/**
 * Valida y normaliza el body de POST /packages/recepcion.
 * @returns {{residenteId:string|null, domicilioId:string|null, etiquetaNombre:string|null, categoriaPeso:string,
 *   guia:string|null, transportadora:string|null, fotos:string[]}}
 */
export function validarRecepcion(body, { maxFotos }) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const residenteId = b.residenteId === undefined || b.residenteId === null || b.residenteId === ''
    ? null : b.residenteId;
  if (residenteId !== null && typeof residenteId !== 'string') {
    throw invalido('El residente no es válido. Búscalo de nuevo e intenta otra vez.', { campo: 'residenteId' });
  }
  // PLAN-conjunto S1.2: el destino es una dirección de entrega (`domicilioId`); `residenteId`
  // se conserva por compatibilidad (S1.3 cambia el contrato público).
  const domicilioId = b.domicilioId === undefined || b.domicilioId === null || b.domicilioId === ''
    ? null : b.domicilioId;
  if (domicilioId !== null && typeof domicilioId !== 'string') {
    throw invalido('La dirección no es válida. Búscala de nuevo e intenta otra vez.', { campo: 'domicilioId' });
  }
  const etiquetaNombre = textoOpcional(b.etiquetaNombre, 'etiquetaNombre', 'El nombre de la etiqueta');
  if (residenteId === null && domicilioId === null && !etiquetaNombre) {
    throw invalido('Escribe el nombre que dice la etiqueta o elige un residente.', { campo: 'etiquetaNombre' });
  }
  if (!esCategoriaValida(b.categoriaPeso)) {
    throw invalido('La categoría de peso no es válida. Elige una de la lista.', { campo: 'categoriaPeso' });
  }
  return {
    residenteId,
    domicilioId,
    etiquetaNombre,
    categoriaPeso: b.categoriaPeso,
    guia: textoOpcional(b.guia, 'guia', 'La guía'),
    transportadora: textoOpcional(b.transportadora, 'transportadora', 'La transportadora'),
    fotos: validarFotos(b.fotos, maxFotos),
  };
}

/** Guía comparable: sin espacios ni guiones, en mayúsculas. "Sin Guía"/vacía => '' (no compara). */
export function normalizarGuia(guia) {
  if (guia == null) return '';
  const g = String(guia).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s\-_]+/g, '').toUpperCase();
  if (g === 'SINGUIA') return '';
  return g;
}

/**
 * Elige la pre-alerta abierta a vincular: primero la que coincida por guía; si no,
 * la más antigua (createdAt, desempate por id).
 * @param {Array<{id:string, guia:string, createdAt:Date}>} prealertas
 */
export function elegirPrealerta(prealertas, guia) {
  if (!prealertas?.length) return null;
  const g = normalizarGuia(guia);
  if (g) {
    const porGuia = prealertas.filter((p) => normalizarGuia(p.guia) === g);
    if (porGuia.length) return masAntigua(porGuia);
  }
  return masAntigua(prealertas);
}

function masAntigua(lista) {
  return [...lista].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || (a.id < b.id ? -1 : 1))[0];
}

/** Valida la clave `Idempotency-Key` (opcional): 1 a 128 caracteres imprimibles sin espacios. */
export function validarClaveIdempotencia(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const c = String(valor).trim();
  if (!c || c.length > 128 || /[^\x21-\x7e]/.test(c)) {
    throw invalido('La clave de reintento no es válida. Usa hasta 128 caracteres sin espacios.', { campo: 'Idempotency-Key' });
  }
  return c;
}
