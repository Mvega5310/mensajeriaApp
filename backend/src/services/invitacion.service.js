// Generación del código de invitación por conjunto (KAN-8 — design.md §3.1).
//
// Token opaco, no adivinable y no secuencial, embebible en el enlace/QR de
// registro. Se genera con aleatoriedad criptográfica. Este módulo es el único
// generador; lo usan prisma/seed.js y (más adelante) la tarea C1.

import crypto from 'node:crypto';

// Alfabeto base32 sin caracteres ambiguos (sin 0/O/1/I/L) para que el código
// sea legible si alguien lo teclea a mano.
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Genera un código de invitación opaco.
 * @param {object} [opts]
 * @param {string} [opts.prefijo]  prefijo legible opcional (p. ej. el slug del
 *                                 conjunto). Se normaliza a [a-z0-9-].
 * @param {number} [opts.longitud] nº de caracteres aleatorios (por defecto 12).
 * @returns {string} p. ej. "local-K7Q2M9XR4TV=" (sin el prefijo si no se pasa).
 */
export function generarCodigoInvitacion({ prefijo, longitud = 12 } = {}) {
  const bytes = crypto.randomBytes(longitud);
  let aleatorio = '';
  for (let i = 0; i < longitud; i += 1) {
    aleatorio += ALFABETO[bytes[i] % ALFABETO.length];
  }
  if (!prefijo) return aleatorio;
  const prefijoLimpio = String(prefijo)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return prefijoLimpio ? `${prefijoLimpio}-${aleatorio}` : aleatorio;
}

/**
 * Lleva un código de invitación a su forma canónica, para que el residente pueda
 * teclearlo con cualquier caja o espacios y aun así coincida con lo persistido.
 * Reglas (KAN-8, revisión C5):
 * - quita todos los espacios (inicio, fin y en medio);
 * - si hay guion: la parte antes del ÚLTIMO guion va en minúsculas (el prefijo/
 *   slug) y la parte después en mayúsculas (el token aleatorio base32);
 * - si no hay guion: todo en mayúsculas.
 *
 * Debe coincidir con lo que produce generarCodigoInvitacion(): prefijo en
 * minúsculas + '-' + aleatorio en mayúsculas (o solo aleatorio en mayúsculas).
 *
 * @param {string} codigo
 * @returns {string}
 */
export function normalizarCodigoInvitacion(codigo) {
  if (codigo == null) return '';
  const sinEspacios = String(codigo).replace(/\s+/g, '');
  const ultimoGuion = sinEspacios.lastIndexOf('-');
  if (ultimoGuion === -1) {
    return sinEspacios.toUpperCase();
  }
  const prefijo = sinEspacios.slice(0, ultimoGuion).toLowerCase();
  const token = sinEspacios.slice(ultimoGuion + 1).toUpperCase();
  return `${prefijo}-${token}`;
}
