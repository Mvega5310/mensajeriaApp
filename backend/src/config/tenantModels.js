// Contrato único de modelos con tenant (KAN-8, Fase B — design.md §1.5, §2.3).
//
// Esta es la ÚNICA fuente de verdad sobre qué modelos de Prisma llevan
// `conjuntoId` y, por tanto, quedan bajo el filtro automático de la extensión
// de tenant (config/db.js). Vivir en un solo lugar obliga a que agregar un
// modelo nuevo sea una decisión consciente: si no se añade aquí, NO queda
// aislado (y eso debe notarse en revisión), en vez de quedar cubierto/olvidado
// de forma silenciosa.
//
// Exclusiones deliberadas (design.md §1.4, §1.5):
// - `Conjunto`: es la tabla RAÍZ del tenant, no tiene `conjuntoId`. Debe quedar
//   FUERA para que las lecturas pre-tenant (p. ej. resolver un conjunto por
//   codigoInvitacion en register) funcionen sin contexto.
// - `PasswordResetToken`: se accede siempre por token/userId concretos, nunca
//   por barrido entre residentes; no lleva `conjuntoId`.

// Nombres tal como los expone Prisma en la propiedad de modelo del cliente
// (minúscula inicial) para comparaciones en la extensión.
export const MODELOS_CON_TENANT = Object.freeze([
  'user',
  'package',
  'bono',
  'comentario',
]);

// Set para O(1) en la extensión.
const setModelos = new Set(MODELOS_CON_TENANT);

/**
 * ¿Este modelo está sujeto al aislamiento por conjunto?
 * @param {string} model  nombre de modelo de Prisma (ej. 'user', 'package')
 * @returns {boolean}
 */
export function esModeloConTenant(model) {
  if (!model) return false;
  return setModelos.has(String(model).toLowerCase());
}
