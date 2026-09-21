// Contexto de tenant por petición (KAN-8, Fase B — design.md §2.3).
//
// El aislamiento multi-conjunto se apoya en un AsyncLocalStorage que lleva,
// por cada request, el "scope" activo. La extensión de Prisma (ver
// config/db.js) lee este contexto para decidir cómo filtrar:
//
//   { scope: 'TENANT', conjuntoId, role }  -> filtra/fuerza por conjuntoId.
//   { scope: 'GLOBAL_LOOKUP' }             -> exención puntual y explícita para
//                                             las lecturas pre-tenant de
//                                             autenticación (login por email).
//   (contexto ausente)                     -> la extensión LANZA (falla cerrado):
//                                             la ausencia de contexto NUNCA se
//                                             interpreta como permiso.
//
// Reglas duras que este módulo ayuda a sostener (design.md §2.3, §2.3.1):
// - El scope GLOBAL_LOOKUP SOLO se abre dentro de buscarUsuarioPorEmailSinTenant()
//   (auth.controller.js). Ninguna otra parte del código debe abrir ese scope.
// - No existe ningún flag de runtime que active/desactive el aislamiento: el
//   comportamiento depende solo del contexto presente en cada request.

import { AsyncLocalStorage } from 'node:async_hooks';

export const SCOPE = Object.freeze({
  TENANT: 'TENANT',
  GLOBAL_LOOKUP: 'GLOBAL_LOOKUP',
});

// Store único para todo el proceso. La extensión de Prisma y el middleware de
// tenant comparten esta instancia.
export const tenantStore = new AsyncLocalStorage();

/**
 * Devuelve el contexto activo o undefined si no hay ninguno.
 * La extensión usa esto para decidir entre filtrar, eximir o lanzar.
 */
export function getContext() {
  return tenantStore.getStore();
}

/**
 * Ejecuta `fn` dentro de un contexto de tenant concreto.
 * Lo usa el middleware de tenant (Fase B4/Fase C) tras resolver el conjunto
 * del usuario autenticado por su `sub` contra la BD.
 *
 * @param {{ conjuntoId: string, role: string }} params
 * @param {() => T} fn
 * @returns {T}
 */
export function runWithTenant({ conjuntoId, role }, fn) {
  if (!conjuntoId) {
    // No abrimos un contexto TENANT sin conjuntoId: eso equivaldría a un
    // "modo sin tenant" encubierto. El llamador (middleware) debe rechazar
    // la request antes de llegar aquí.
    throw new Error('runWithTenant requiere un conjuntoId no vacío');
  }
  return tenantStore.run({ scope: SCOPE.TENANT, conjuntoId, role }, fn);
}

// NOTA sobre GLOBAL_LOOKUP: este módulo NO expone un helper para abrir ese
// scope a propósito. La invariante de design.md §2.3.1 exige que
// `tenantStore.run({ scope: SCOPE.GLOBAL_LOOKUP }, ...)` aparezca EXACTAMENTE
// UNA VEZ en todo el repositorio, dentro de la función
// buscarUsuarioPorEmailSinTenant() (auth.controller.js, Fase C). Si se
// expusiera un helper aquí, ese "una sola vez" se diluiría y cualquiera podría
// abrir el scope importándolo. Por eso el único call site es esa función.
