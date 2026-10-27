// Decodificación y validación de las fotos que llegan como data-URI (T5.1).
// Pura: sin red ni base de datos.

import { AppError, CODIGOS } from '../../domain/errores.js';

export const TIPOS_FOTO = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});
// Tamaño máximo de CADA foto ya decodificada. El frontend las comprime a ~100-300 KB.
export const MAX_BYTES_FOTO = 1.5 * 1024 * 1024;

const RE = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/i;

const invalida = (n) => new AppError(
  CODIGOS.DATOS_INVALIDOS,
  `La foto ${n} no es válida. Usa una imagen JPG, PNG o WebP e intenta de nuevo.`,
  400,
  { campo: 'fotos', indice: n - 1 },
);

const grande = (n, maxBytes) => new AppError(
  CODIGOS.CARGA_DEMASIADO_GRANDE,
  `La foto ${n} pesa demasiado (máximo ${(maxBytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB). Toma otra con menos resolución e intenta de nuevo.`,
  413,
  { campo: 'fotos', indice: n - 1, maxBytes },
);

/** Extensión de archivo para un tipo MIME admitido. */
export const extensionDe = (tipo) => TIPOS_FOTO[tipo] ?? 'bin';

/**
 * @param {string} dataUri  "data:image/jpeg;base64,...."
 * @param {number} [numero] posición 1-based, solo para el mensaje de error
 * @returns {{contenido: Buffer, tipo: string}}
 * @throws AppError 400 (formato/tipo) o 413 (demasiado grande)
 */
export function decodificarDataUri(dataUri, numero = 1, maxBytes = MAX_BYTES_FOTO) {
  if (typeof dataUri !== 'string') throw invalida(numero);
  const m = RE.exec(dataUri.trim());
  if (!m) throw invalida(numero);
  const declarado = m[1].toLowerCase();
  const tipo = declarado === 'image/jpg' ? 'image/jpeg' : declarado;
  if (!TIPOS_FOTO[tipo]) throw invalida(numero);
  const b64 = m[2];
  // Se estima el tamaño ANTES de decodificar para no reservar memoria de más.
  if (Math.floor((b64.length * 3) / 4) > maxBytes + 3) throw grande(numero, maxBytes);
  const contenido = Buffer.from(b64, 'base64');
  if (contenido.length === 0) throw invalida(numero);
  if (contenido.length > maxBytes) throw grande(numero, maxBytes);
  return { contenido, tipo };
}
