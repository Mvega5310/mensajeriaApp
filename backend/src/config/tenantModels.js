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
// - `User` (PLAN-conjunto S1.1): la cuenta del RESIDENT es de la persona y sirve en
//   cualquier conjunto, así que ya NO se aísla por tenant. DECISIÓN (opción a): User
//   sale de esta lista y TODO acceso a `prisma.user` pasa por un único servicio,
//   services/usuario.service.js (el único archivo, junto a buscarUsuarioPorEmailSinTenant,
//   tenantBootstrap, seed y scripts, que puede nombrar `prisma.user`; lo vigila
//   auditoriaInvariantes.test.js). Por qué no una regla especial dentro de la extensión:
//   el contexto de un residente es "el conjunto de la solicitud", que ya no coincide con
//   User.conjuntoId, y el aislamiento correcto de un residente es por id de la sesión, no
//   por conjunto; meterlo en la extensión exigiría que el contexto lleve el usuario y
//   duplicaría la lógica del servicio. El servicio tiene una API mínima y cada función
//   filtra a mano (OPERATOR: por el conjunto del contexto; RESIDENT: por id de la sesión).
// - `UsuarioConjunto`: índice sin datos personales (usuarioId, conjuntoId) para saber en
//   qué conjuntos tiene domicilio una persona; solo lo lee services/domicilio.service.js
//   (lo vigila la auditoría). Ver comentario en schema.prisma.

// Nombres tal como los expone Prisma en la propiedad de modelo del cliente
// (minúscula inicial) para comparaciones en la extensión.
export const MODELOS_CON_TENANT = Object.freeze([
  'package',
  'domicilio',
  'bono',
  'comentario',
  'paqueteevento',
  'claveidempotencia',
  'paquetefoto',
  'cortesiaapartamento',
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
