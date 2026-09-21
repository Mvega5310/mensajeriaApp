// Pruebas del interceptor de aislamiento (KAN-8, Fase B — B6).
// Runner: node:test. Ejecutar:
//   node --test src/config/__tests__/tenantExtension.interceptor.test.js
//
// REQUIERE prisma generate (el módulo importa `@prisma/client`). La lógica se
// prueba con un fake de `query`, sin base de datos real.
// Se reporta como PENDIENTE DE PRUEBA LOCAL.
//
// NOTA: estas pruebas con fake NO pueden detectar si Prisma acepta el where
// resultante (WhereUniqueInput vs WhereInput). Eso lo cubre la prueba de
// integración contra Postgres real (tenantIsolation.integration.test.js).

import test from 'node:test';
import assert from 'node:assert/strict';

import { aplicarAislamiento } from '../tenantExtension.js';
import { SCOPE } from '../tenantContext.js';

const ctxTenant = (conjuntoId = 'c1', role = 'OPERATOR') => () => ({
  scope: SCOPE.TENANT,
  conjuntoId,
  role,
});
const ctxGlobalLookup = () => () => ({ scope: SCOPE.GLOBAL_LOOKUP });
const ctxAusente = () => () => undefined;

function queryFake() {
  const calls = [];
  const fn = async (args) => {
    calls.push(args);
    return { __ranWith: args };
  };
  fn.calls = calls;
  return fn;
}

// --- Modelos sin tenant: pasan tal cual, incluso sin contexto ---

test('modelo SIN tenant (Conjunto) pasa sin contexto y sin filtro', async () => {
  const query = queryFake();
  await aplicarAislamiento({
    model: 'Conjunto',
    operation: 'findUnique',
    args: { where: { codigoInvitacion: 'abc' } },
    query,
    leerContexto: ctxAusente(),
  });
  assert.deepEqual(query.calls[0], { where: { codigoInvitacion: 'abc' } });
});

test('modelo SIN tenant (PasswordResetToken) pasa sin filtro', async () => {
  const query = queryFake();
  await aplicarAislamiento({
    model: 'PasswordResetToken',
    operation: 'findFirst',
    args: { where: { tokenHash: 'h' } },
    query,
    leerContexto: ctxTenant(),
  });
  assert.deepEqual(query.calls[0], { where: { tokenHash: 'h' } });
});

// --- Falla cerrado ---

test('modelo con tenant SIN contexto -> lanza (falla cerrado)', async () => {
  await assert.rejects(
    aplicarAislamiento({
      model: 'Package',
      operation: 'findMany',
      args: {},
      query: queryFake(),
      leerContexto: ctxAusente(),
    }),
    /sin contexto de conjunto/
  );
});

// --- Exención GLOBAL_LOOKUP ---

test('GLOBAL_LOOKUP exime: no inyecta filtro', async () => {
  const query = queryFake();
  await aplicarAislamiento({
    model: 'User',
    operation: 'findUnique',
    args: { where: { email: 'a@b.c' } },
    query,
    leerContexto: ctxGlobalLookup(),
  });
  assert.deepEqual(query.calls[0], { where: { email: 'a@b.c' } });
});

// --- WhereUniqueInput: spread plano, NO AND ---

test('findUnique por id: conjuntoId en el primer nivel (sin AND, sin reescritura)', async () => {
  const query = queryFake();
  const res = await aplicarAislamiento({
    model: 'Package',
    operation: 'findUnique',
    args: { where: { id: 'p1' } },
    query,
    leerContexto: ctxTenant('cX'),
  });
  // Clave: where plano { id, conjuntoId }, NO { AND: [...] }.
  assert.deepEqual(query.calls[0].where, { id: 'p1', conjuntoId: 'cX' });
  // Se ejecuta la MISMA operación (findUnique), sin redirigir a findFirst.
  assert.equal(res.__ranWith.where.conjuntoId, 'cX');
});

test('findUniqueOrThrow por id: spread plano', async () => {
  const query = queryFake();
  await aplicarAislamiento({
    model: 'User',
    operation: 'findUniqueOrThrow',
    args: { where: { id: 'u1' } },
    query,
    leerContexto: ctxTenant('cX'),
  });
  assert.deepEqual(query.calls[0].where, { id: 'u1', conjuntoId: 'cX' });
});

test('update por id: where plano y data con conjuntoId', async () => {
  const query = queryFake();
  await aplicarAislamiento({
    model: 'Package',
    operation: 'update',
    args: { where: { id: 'p1' }, data: { estado: 'ENTREGADO' } },
    query,
    leerContexto: ctxTenant('cX'),
  });
  assert.deepEqual(query.calls[0].where, { id: 'p1', conjuntoId: 'cX' });
  assert.equal(query.calls[0].data.conjuntoId, 'cX');
});

test('delete por id: where plano', async () => {
  const query = queryFake();
  await aplicarAislamiento({
    model: 'Bono',
    operation: 'delete',
    args: { where: { id: 'b1' } },
    query,
    leerContexto: ctxTenant('cX'),
  });
  assert.deepEqual(query.calls[0].where, { id: 'b1', conjuntoId: 'cX' });
});

test('where único con conjuntoId distinto -> lanza', async () => {
  await assert.rejects(
    aplicarAislamiento({
      model: 'Package',
      operation: 'findUnique',
      args: { where: { id: 'p1', conjuntoId: 'OTRO' } },
      query: queryFake(),
      leerContexto: ctxTenant('cX'),
    }),
    /conjuntoId distinto/
  );
});

// --- WhereInput: AND ---

test('findMany inyecta conjuntoId combinando con AND', async () => {
  const query = queryFake();
  await aplicarAislamiento({
    model: 'Package',
    operation: 'findMany',
    args: { where: { estado: 'ENTREGADO' } },
    query,
    leerContexto: ctxTenant('cX'),
  });
  assert.deepEqual(query.calls[0].where, {
    AND: [{ estado: 'ENTREGADO' }, { conjuntoId: 'cX' }],
  });
});

test('findMany sin where inyecta solo el filtro', async () => {
  const query = queryFake();
  await aplicarAislamiento({
    model: 'Package',
    operation: 'findMany',
    args: {},
    query,
    leerContexto: ctxTenant('cX'),
  });
  assert.deepEqual(query.calls[0].where, { conjuntoId: 'cX' });
});

test('updateMany usa AND y fuerza conjuntoId en data', async () => {
  const query = queryFake();
  await aplicarAislamiento({
    model: 'Package',
    operation: 'updateMany',
    args: { where: { estado: 'PREALERTADO' }, data: { estado: 'EN_RECEPCION' } },
    query,
    leerContexto: ctxTenant('cX'),
  });
  assert.deepEqual(query.calls[0].where, {
    AND: [{ estado: 'PREALERTADO' }, { conjuntoId: 'cX' }],
  });
  assert.equal(query.calls[0].data.conjuntoId, 'cX');
});

test('deleteMany usa AND', async () => {
  const query = queryFake();
  await aplicarAislamiento({
    model: 'Bono',
    operation: 'deleteMany',
    args: { where: { residenteId: 'r1' } },
    query,
    leerContexto: ctxTenant('cX'),
  });
  assert.deepEqual(query.calls[0].where, { AND: [{ residenteId: 'r1' }, { conjuntoId: 'cX' }] });
});

// --- Creaciones ---

test('create fuerza conjuntoId desde el contexto', async () => {
  const query = queryFake();
  await aplicarAislamiento({
    model: 'Comentario',
    operation: 'create',
    args: { data: { mensaje: 'hola' } },
    query,
    leerContexto: ctxTenant('cX'),
  });
  assert.equal(query.calls[0].data.conjuntoId, 'cX');
});

test('create RECHAZA un conjuntoId distinto en data', async () => {
  await assert.rejects(
    aplicarAislamiento({
      model: 'Comentario',
      operation: 'create',
      args: { data: { mensaje: 'hola', conjuntoId: 'OTRO' } },
      query: queryFake(),
      leerContexto: ctxTenant('cX'),
    }),
    /no se permite fijar conjuntoId/
  );
});

// --- upsert: where único plano + conjuntoId en create y update ---

test('upsert: where único plano y conjuntoId forzado en create y update', async () => {
  const query = queryFake();
  await aplicarAislamiento({
    model: 'Bono',
    operation: 'upsert',
    args: {
      where: { id: 'b1' },
      create: { cantidadTotal: 5 },
      update: { cantidadUsada: 1 },
    },
    query,
    leerContexto: ctxTenant('cX'),
  });
  assert.deepEqual(query.calls[0].where, { id: 'b1', conjuntoId: 'cX' });
  assert.equal(query.calls[0].create.conjuntoId, 'cX');
  assert.equal(query.calls[0].update.conjuntoId, 'cX');
});

// --- Operación no contemplada ---

test('operación no soportada sobre modelo con tenant -> lanza', async () => {
  await assert.rejects(
    aplicarAislamiento({
      model: 'Package',
      operation: 'operacionRara',
      args: {},
      query: queryFake(),
      leerContexto: ctxTenant('cX'),
    }),
    /no soportada/
  );
});
