// Pruebas de los helpers puros de la extensión de tenant (KAN-8, Fase B — B6).
// Runner: node:test. Ejecutar:
//   node --test src/config/__tests__/tenantExtension.helpers.test.js
//
// IMPORTANTE: este archivo importa desde tenantExtension.js, que a su vez
// importa `@prisma/client`. Eso REQUIERE haber corrido `prisma generate` antes,
// aunque los helpers en sí no toquen la base de datos. Si aún no generaste el
// cliente, este archivo fallará al importar (no por la lógica). Se reporta como
// PENDIENTE DE PRUEBA LOCAL.

import test from 'node:test';
import assert from 'node:assert/strict';

import { conFiltroConjunto, forzarConjuntoEnData } from '../tenantExtension.js';

test('conFiltroConjunto añade el filtro cuando no hay where', () => {
  assert.deepEqual(conFiltroConjunto(undefined, 'c1'), { conjuntoId: 'c1' });
  assert.deepEqual(conFiltroConjunto(null, 'c1'), { conjuntoId: 'c1' });
});

test('conFiltroConjunto combina con AND sin pisar el where del llamador', () => {
  const out = conFiltroConjunto({ estado: 'ENTREGADO' }, 'c1');
  assert.deepEqual(out, { AND: [{ estado: 'ENTREGADO' }, { conjuntoId: 'c1' }] });
});

test('forzarConjuntoEnData fija conjuntoId desde el contexto', () => {
  assert.deepEqual(forzarConjuntoEnData({ nombre: 'x' }, 'c1'), {
    nombre: 'x',
    conjuntoId: 'c1',
  });
});

test('forzarConjuntoEnData tolera data undefined', () => {
  assert.deepEqual(forzarConjuntoEnData(undefined, 'c1'), { conjuntoId: 'c1' });
});

test('forzarConjuntoEnData ACEPTA conjuntoId igual al del contexto', () => {
  assert.deepEqual(forzarConjuntoEnData({ conjuntoId: 'c1', x: 1 }, 'c1'), {
    conjuntoId: 'c1',
    x: 1,
  });
});

test('forzarConjuntoEnData RECHAZA un conjuntoId distinto en data', () => {
  assert.throws(() => forzarConjuntoEnData({ conjuntoId: 'OTRO' }, 'c1'), /no se permite fijar conjuntoId/);
});

test('forzarConjuntoEnData aplica a arrays (createMany)', () => {
  const out = forzarConjuntoEnData([{ a: 1 }, { a: 2 }], 'c1');
  assert.deepEqual(out, [
    { a: 1, conjuntoId: 'c1' },
    { a: 2, conjuntoId: 'c1' },
  ]);
});

test('forzarConjuntoEnData en array rechaza si un item trae conjuntoId distinto', () => {
  assert.throws(
    () => forzarConjuntoEnData([{ a: 1 }, { conjuntoId: 'OTRO' }], 'c1'),
    /no se permite fijar conjuntoId/
  );
});
