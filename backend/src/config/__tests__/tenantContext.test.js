// Pruebas del contexto de tenant (KAN-8, Fase B — tarea B6).
// Runner: node:test integrado (Node >= 18), sin dependencias externas.
// Ejecutar en local con:  node --test src/config/__tests__/tenantContext.test.js
//
// Estas pruebas NO requieren prisma generate: solo ejercitan el AsyncLocalStorage
// y las constantes de scope.

import test from 'node:test';
import assert from 'node:assert/strict';

import { SCOPE, getContext, runWithTenant } from '../tenantContext.js';

test('getContext() es undefined fuera de todo run()', () => {
  assert.equal(getContext(), undefined);
});

test('runWithTenant abre scope TENANT con conjuntoId y role', () => {
  runWithTenant({ conjuntoId: 'c1', role: 'OPERATOR' }, () => {
    const ctx = getContext();
    assert.equal(ctx.scope, SCOPE.TENANT);
    assert.equal(ctx.conjuntoId, 'c1');
    assert.equal(ctx.role, 'OPERATOR');
  });
});

test('runWithTenant rechaza conjuntoId vacío (no permite modo sin tenant)', () => {
  assert.throws(() => runWithTenant({ conjuntoId: '', role: 'RESIDENT' }, () => {}), /conjuntoId/);
  assert.throws(
    () => runWithTenant({ conjuntoId: undefined, role: 'RESIDENT' }, () => {}),
    /conjuntoId/
  );
});

test('el contexto se propaga a través de un await interno', async () => {
  await runWithTenant({ conjuntoId: 'c2', role: 'RESIDENT' }, async () => {
    await Promise.resolve();
    const ctx = getContext();
    assert.equal(ctx.conjuntoId, 'c2');
  });
});

test('contextos anidados no se filtran entre sí', () => {
  runWithTenant({ conjuntoId: 'A', role: 'OPERATOR' }, () => {
    assert.equal(getContext().conjuntoId, 'A');
    runWithTenant({ conjuntoId: 'B', role: 'OPERATOR' }, () => {
      assert.equal(getContext().conjuntoId, 'B');
    });
    // Al salir del anidado, vuelve a A.
    assert.equal(getContext().conjuntoId, 'A');
  });
});

// La exención GLOBAL_LOOKUP se prueba en tenantExtension.interceptor.test.js
// (test "GLOBAL_LOOKUP exime"). Aquí NO abrimos ese scope con tenantStore.run:
// la invariante §2.3.1 exige que `run({ scope: GLOBAL_LOOKUP })` aparezca en un
// solo punto del repo (buscarUsuarioPorEmailSinTenant). Solo comprobamos que la
// constante existe.
test('SCOPE expone TENANT y GLOBAL_LOOKUP', () => {
  assert.equal(SCOPE.TENANT, 'TENANT');
  assert.equal(SCOPE.GLOBAL_LOOKUP, 'GLOBAL_LOOKUP');
});
