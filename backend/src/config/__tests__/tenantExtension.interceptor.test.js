// Pruebas del interceptor de aislamiento (KAN-8, Fase B — B6).
// Runner: node:test. Ejecutar:
//   node --test src/config/__tests__/tenantExtension.interceptor.test.js
//
// REQUIERE prisma generate (el módulo importa `@prisma/client`). La lógica se
// prueba con fakes de `query` y `client`, sin base de datos real.
// Se reporta como PENDIENTE DE PRUEBA LOCAL.

import test from 'node:test';
import assert from 'node:assert/strict';

import { aplicarAislamiento } from '../tenantExtension.js';
import { SCOPE } from '../tenantContext.js';

// Helpers de contexto inyectable (evita depender del AsyncLocalStorage real).
const ctxTenant = (conjuntoId = 'c1', role = 'OPERATOR') => () => ({
  scope: SCOPE.TENANT,
  conjuntoId,
  role,
});
const ctxGlobalLookup = () => () => ({ scope: SCOPE.GLOBAL_LOOKUP });
const ctxAusente = () => () => undefined;

// query fake: registra los args con los que se le llamó y devuelve un sentinel.
function queryFake() {
  const calls = [];
  const fn = async (args) => {
    calls.push(args);
    return { __ranWith: args };
  };
  fn.calls = calls;
  return fn;
}

// client fake: registra las llamadas de reescritura findFirst/findFirstOrThrow.
function clientFake() {
  const calls = [];
  const mk = (op) => async (args) => {
    calls.push({ op, args });
    return { __rewritten: op, args };
  };
  return {
    calls,
    User: { findFirst: mk('findFirst'), findFirstOrThrow: mk('findFirstOrThrow') },
    user: { findFirst: mk('findFirst'), findFirstOrThrow: mk('findFirstOrThrow') },
    Package: { findFirst: mk('findFirst'), findFirstOrThrow: mk('findFirstOrThrow') },
  };
}

// --- Modelos sin tenant: pasan tal cual, incluso sin contexto ---

test('modelo SIN tenant (Conjunto) pasa sin contexto y sin filtro', async () => {
  const query = queryFake();
  await aplicarAislamiento({
    model: 'Conjunto',
    operation: 'findUnique',
    args: { where: { codigoInvitacion: 'abc' } },
    query,
    client: clientFake(),
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
    client: clientFake(),
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
      client: clientFake(),
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
    client: clientFake(),
    leerContexto: ctxGlobalLookup(),
  });
  assert.deepEqual(query.calls[0], { where: { email: 'a@b.c' } });
});

// --- Lecturas por filtro ---

test('findMany inyecta conjuntoId combinando con AND', async () => {
  const query = queryFake();
  await aplicarAislamiento({
    model: 'Package',
    operation: 'findMany',
    args: { where: { estado: 'ENTREGADO' } },
    query,
    client: clientFake(),
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
    client: clientFake(),
    leerContexto: ctxTenant('cX'),
  });
  assert.deepEqual(query.calls[0].where, { conjuntoId: 'cX' });
});

// --- Reescritura findUnique -> findFirst ---

test('findUnique se reescribe a findFirst del modelo con el filtro', async () => {
  const client = clientFake();
  const res = await aplicarAislamiento({
    model: 'User',
    operation: 'findUnique',
    args: { where: { id: 'u1' } },
    query: queryFake(),
    client,
    leerContexto: ctxTenant('cX'),
  });
  assert.equal(client.calls[0].op, 'findFirst');
  assert.deepEqual(client.calls[0].args.where, { AND: [{ id: 'u1' }, { conjuntoId: 'cX' }] });
  assert.equal(res.__rewritten, 'findFirst');
});

test('findUniqueOrThrow se reescribe a findFirstOrThrow', async () => {
  const client = clientFake();
  await aplicarAislamiento({
    model: 'User',
    operation: 'findUniqueOrThrow',
    args: { where: { id: 'u1' } },
    query: queryFake(),
    client,
    leerContexto: ctxTenant('cX'),
  });
  assert.equal(client.calls[0].op, 'findFirstOrThrow');
});

// --- Creaciones: conjuntoId desde el contexto, nunca desde data ---

test('create fuerza conjuntoId desde el contexto', async () => {
  const query = queryFake();
  await aplicarAislamiento({
    model: 'Comentario',
    operation: 'create',
    args: { data: { mensaje: 'hola' } },
    query,
    client: clientFake(),
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
      client: clientFake(),
      leerContexto: ctxTenant('cX'),
    }),
    /no se permite fijar conjuntoId/
  );
});

// --- Escrituras con where ---

test('update inyecta filtro en where', async () => {
  const query = queryFake();
  await aplicarAislamiento({
    model: 'Package',
    operation: 'update',
    args: { where: { id: 'p1' }, data: { estado: 'ENTREGADO' } },
    query,
    client: clientFake(),
    leerContexto: ctxTenant('cX'),
  });
  assert.deepEqual(query.calls[0].where, { AND: [{ id: 'p1' }, { conjuntoId: 'cX' }] });
  assert.equal(query.calls[0].data.conjuntoId, 'cX');
});

test('deleteMany inyecta filtro', async () => {
  const query = queryFake();
  await aplicarAislamiento({
    model: 'Bono',
    operation: 'deleteMany',
    args: { where: { residenteId: 'r1' } },
    query,
    client: clientFake(),
    leerContexto: ctxTenant('cX'),
  });
  assert.deepEqual(query.calls[0].where, { AND: [{ residenteId: 'r1' }, { conjuntoId: 'cX' }] });
});

// --- upsert ---

test('upsert filtra where y fuerza conjuntoId en create y update', async () => {
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
    client: clientFake(),
    leerContexto: ctxTenant('cX'),
  });
  assert.deepEqual(query.calls[0].where, { AND: [{ id: 'b1' }, { conjuntoId: 'cX' }] });
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
      client: clientFake(),
      leerContexto: ctxTenant('cX'),
    }),
    /no soportada/
  );
});
