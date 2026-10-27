// Enlace firmado del residente (T3.1, decisión D1). Funciones PURAS: sin Prisma,
// sin red y sin leer process.env (el secreto llega como parámetro).
//
// El aviso de llegada por WhatsApp lleva un enlace `${FRONTEND_URL}/p/<token>` que
// abre "Mis paquetes" sin contraseña. El token NO es un JWT de sesión: es un
// permiso de un solo propósito (entrar a la vista del residente) firmado con
// HMAC-SHA256 y con vencimiento.
//
// Formato:  v1.<payload en base64url>.<firma en base64url>
//   - payload = JSON { r: residenteId, c: conjuntoId, e: vencimiento (ms epoch) }
//   - firma   = HMAC-SHA256( secreto, "v1." + payload en base64url )
//   - "v1" es la versión del formato: si algún día cambia, un token viejo se
//     rechaza como inválido en vez de interpretarse mal.
//
// Tiempos: `exp` y `ahora` van en milisegundos desde epoch (como Date.now()).

import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError, CODIGOS } from './errores.js';

export const VERSION_ENLACE = 'v1';
export const VIGENCIA_ENLACE_MS = 7 * 24 * 60 * 60 * 1000; // D1: 7 días

const invalido = () => new AppError(
  CODIGOS.ENLACE_INVALIDO,
  'Este enlace no es válido. Pide a la portería que te reenvíe el aviso.',
  401,
);
const vencido = () => new AppError(
  CODIGOS.ENLACE_VENCIDO,
  'Este enlace ya venció. Pide a la portería que te reenvíe el aviso.',
  401,
);

const b64u = (buf) => Buffer.from(buf).toString('base64url');

function firmaDe(textoFirmado, secreto) {
  return createHmac('sha256', secreto).update(textoFirmado).digest();
}

/** Vencimiento (ms epoch) de un enlace emitido en `ahora` con la vigencia de D1. */
export function vencimientoPorDefecto(ahora = Date.now()) {
  return ahora + VIGENCIA_ENLACE_MS;
}

/**
 * @param {{residenteId:string, conjuntoId:string, exp:number}} datos  exp en ms epoch.
 * @param {string} secreto
 * @returns {string} token compacto, seguro para URL.
 */
export function firmar({ residenteId, conjuntoId, exp }, secreto) {
  if (typeof secreto !== 'string' || secreto === '') throw new Error('firmar requiere un secreto no vacío');
  if (typeof residenteId !== 'string' || !residenteId || typeof conjuntoId !== 'string' || !conjuntoId) {
    throw new Error('firmar requiere residenteId y conjuntoId');
  }
  if (!Number.isFinite(exp)) throw new Error('firmar requiere un exp numérico (ms epoch)');
  const payload = b64u(JSON.stringify({ r: residenteId, c: conjuntoId, e: exp }));
  const cuerpo = `${VERSION_ENLACE}.${payload}`;
  return `${cuerpo}.${b64u(firmaDe(cuerpo, secreto))}`;
}

/**
 * Valida firma y vencimiento. La firma se comprueba ANTES de mirar el contenido
 * (y en tiempo constante): un payload alterado nunca llega a interpretarse.
 *
 * @returns {{residenteId:string, conjuntoId:string, exp:number}}
 * @throws {AppError} ENLACE_INVALIDO | ENLACE_VENCIDO (401)
 */
export function verificar(token, secreto, ahora = Date.now()) {
  if (typeof secreto !== 'string' || secreto === '') throw new Error('verificar requiere un secreto no vacío');
  if (typeof token !== 'string' || token.length > 1024) throw invalido();
  const partes = token.split('.');
  if (partes.length !== 3 || partes[0] !== VERSION_ENLACE || !partes[1] || !partes[2]) throw invalido();
  const [version, payload, firma] = partes;
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]+$/.test(firma)) throw invalido();

  const esperada = firmaDe(`${version}.${payload}`, secreto);
  const recibida = Buffer.from(firma, 'base64url');
  // timingSafeEqual exige el mismo largo; el largo de un HMAC-SHA256 no es secreto.
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) throw invalido();

  let datos;
  try {
    datos = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw invalido();
  }
  if (!datos || typeof datos.r !== 'string' || !datos.r || typeof datos.c !== 'string' || !datos.c
    || !Number.isFinite(datos.e)) throw invalido();

  if (ahora >= datos.e) throw vencido();
  return { residenteId: datos.r, conjuntoId: datos.c, exp: datos.e };
}
