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
