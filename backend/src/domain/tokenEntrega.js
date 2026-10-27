// Token de entrega por lote (T2.5). Lógica PURA: sin Prisma ni reloj propio
// (`ahora` y `secreto` entran por parámetro).
//
// Lo emite POST /entregas/verificar-pin tras comprobar el PIN y lo consume
// POST /entregas/confirmar, para que confirmar NO repita el PIN. Liga:
//   operador + conjunto + residente + ids exactos de los paquetes del lote.
// Formato: base64url(JSON payload) "." base64url(HMAC-SHA256). Es un token
// firmado, no cifrado: no lleva datos sensibles (ids opacos; nunca el PIN).
// El HMAC usa un prefijo de dominio para que un JWT de sesión firmado con el
// mismo secreto nunca valga como token de entrega ni al revés.

import crypto from 'node:crypto';

export const TOKEN_ENTREGA_TTL_MS = 10 * 60 * 1000;
const DOMINIO = 'puertaya:entrega:v1:';

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const firma = (cuerpo, secreto) => crypto.createHmac('sha256', DOMINIO + secreto).update(cuerpo).digest();

/**
 * @param {{operadorId:string, conjuntoId:string, residenteId:string, paqueteIds:string[]}} datos
 * @param {{secreto:string, ahora?:Date, ttlMs?:number}} opciones
 * @returns {{token:string, venceEn:Date}}
 */
export function firmarTokenEntrega({ operadorId, conjuntoId, residenteId, paqueteIds }, { secreto, ahora = new Date(), ttlMs = TOKEN_ENTREGA_TTL_MS }) {
  if (!secreto) throw new Error('Falta el secreto para firmar el token de entrega.');
  const exp = ahora.getTime() + ttlMs;
  const cuerpo = b64(JSON.stringify({ o: operadorId, c: conjuntoId, r: residenteId, p: [...paqueteIds].sort(), exp }));
  return { token: `${cuerpo}.${b64(firma(cuerpo, secreto))}`, venceEn: new Date(exp) };
}

/**
 * @returns {{ok:true, operadorId:string, conjuntoId:string, residenteId:string, paqueteIds:string[], venceEn:Date}
 *   | {ok:false, motivo:'MALFORMADO'|'FIRMA'|'VENCIDO'}}
 */
export function verificarTokenEntrega(token, { secreto, ahora = new Date() }) {
  if (typeof token !== 'string' || !secreto) return { ok: false, motivo: 'MALFORMADO' };
  const partes = token.split('.');
  if (partes.length !== 2 || !partes[0] || !partes[1]) return { ok: false, motivo: 'MALFORMADO' };
  const [cuerpo, firmaRecibida] = partes;
  const esperada = firma(cuerpo, secreto);
  const recibida = Buffer.from(firmaRecibida, 'base64url');
  if (recibida.length !== esperada.length || !crypto.timingSafeEqual(recibida, esperada)) {
    return { ok: false, motivo: 'FIRMA' };
  }
  let p;
  try { p = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8')); } catch { return { ok: false, motivo: 'MALFORMADO' }; }
  if (!p || typeof p.o !== 'string' || typeof p.c !== 'string' || typeof p.r !== 'string'
    || !Array.isArray(p.p) || !p.p.every((x) => typeof x === 'string') || typeof p.exp !== 'number') {
    return { ok: false, motivo: 'MALFORMADO' };
  }
  if (p.exp <= ahora.getTime()) return { ok: false, motivo: 'VENCIDO' };
  return { ok: true, operadorId: p.o, conjuntoId: p.c, residenteId: p.r, paqueteIds: p.p, venceEn: new Date(p.exp) };
}
