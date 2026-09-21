// Pruebas del contexto de tenant (KAN-8, Fase B — tarea B6).
// Runner: node:test integrado (Node >= 18), sin dependencias externas.
// Ejecutar en local con:  node --test src/config/__tests__/tenantContext.test.js
//
// Estas pruebas NO requieren prisma generate: solo ejercitan el AsyncLocalStorage
// y las constantes de scope.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SCOPE,
  tenantStore,
  getContext,
  runWithTenant,
} from '../tenantContext.js';

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

test('GLOBAL_LOOKUP solo debería abrirse manualmente (aquí, para probar la exención)', () => {
  // Nota: en producción este scope SOLO lo abre buscarUsuarioPorEmailSinTenant().
  // Aquí lo abrimos directamente solo para verificar que el store lo refleja.
  tenantStore.run({ scope: SCOPE.GLOBAL_LOOKUP }, () => {
    assert.equal(getContext().scope, SCOPE.GLOBAL_LOOKUP);
  });
});
