// Integración de T2.2 contra Postgres real: GET /residentes/buscar.
// Mismo patrón de skip/guarda de localhost que las demás integraciones.

import test from 'node:test';
import assert from 'node:assert/strict';
import { purgarEventos } from '../../../test-support/purgarEventos.js';

const dbUrl = process.env.DATABASE_URL;
let dbHost = null;
try { dbHost = dbUrl ? new URL(dbUrl).hostname : null; } catch { dbHost = null; }
const esLocal = !!dbHost && new Set(['localhost', '127.0.0.1', '::1']).has(dbHost);
const razonSkip = !dbUrl
  ? 'DATABASE_URL no definida'
  : !esLocal
    ? `DATABASE_URL apunta a un host NO local (${dbHost}); esta prueba crea/borra datos`
    : null;
const omitir = razonSkip !== null;
if (omitir) console.warn(`[buscarResidentes.integration] OMITIDA: ${razonSkip}`);
if (!omitir && !process.env.JWT_SECRET) process.env.JWT_SECRET = 'itest-secret';

let prisma, runWithTenant, createApp, server, base;
const SLUG_A = 'itestb-alfa';
const SLUG_B = 'itestb-beta';
const PWD = 'Password1';
const ctx = {};
const skip = omitir && razonSkip;

const enA = (fn) => runWithTenant({ conjuntoId: ctx.A, role: 'OPERATOR' }, fn);

async function limpiar() {
  const conjuntos = await prisma.conjunto.findMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } });
  for (const c of conjuntos) {
    await purgarEventos(prisma, c.id);
    await runWithTenant({ conjuntoId: c.id, role: 'OPERATOR' }, async () => {
      await prisma.bono.deleteMany({});
      await prisma.package.deleteMany({});
      await prisma.user.deleteMany({});
    });
  }
  await prisma.conjunto.deleteMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } });
}

function api(path, { token } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${base}${path}`, { headers });
}
async function login(email) {
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PWD }),
  });
  return (await r.json()).token;
}
const buscar = async (q, token = ctx.tOp) => {
  const r = await api(`/api/residentes/buscar?q=${encodeURIComponent(q)}`, { token });
  return { status: r.status, body: await r.json() };
};

test('setup', { skip }, async () => {
  ({ prisma } = await import('../db.js'));
  ({ runWithTenant } = await import('../tenantContext.js'));
  ({ createApp } = await import('../../app.js'));
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(PWD, 10);
  await limpiar();
  const mk = (slug) => prisma.conjunto.create({
    data: {
      nombre: slug, slug, codigoInvitacion: `${slug}-cod`, operadorNombre: 'Op', operadorWhatsapp: '573000000000',
      operadorDomicilio: 'Dir', puntoRecepcion: 'Recepción',
    },
  });
  ctx.A = (await mk(SLUG_A)).id;
  ctx.B = (await mk(SLUG_B)).id;
  const user = (conjuntoId, email, role, nombre, torre, apto) => runWithTenant({ conjuntoId, role: 'OPERATOR' }, () =>
    prisma.user.create({
      data: { email, passwordHash: hash, role, nombre, telefono: '3001112222', torre, apto, termsAcceptedAt: new Date() },
    }));
  ctx.op = await user(ctx.A, 'op@rb-a.local', 'OPERATOR', 'Operador', null, null);
  ctx.ana = await user(ctx.A, 'ana@rb-a.local', 'RESIDENT', 'Ana Gómez', 'TORRE 2', '304');
  ctx.luis = await user(ctx.A, 'luis@rb-a.local', 'RESIDENT', 'Luis Pérez', 'TORRE 1', '304');
  ctx.t1 = await user(ctx.A, 't1@rb-a.local', 'RESIDENT', 'Marta Ríos', 'T3', '301');
  // 7 residentes en torre 5 para el máximo de 5.
  for (let i = 1; i <= 7; i += 1) await user(ctx.A, `m${i}@rb-a.local`, 'RESIDENT', `Masivo ${i}`, 'TORRE 5', `50${i}`);
  // Otro conjunto: mismo apto/nombre, nunca debe aparecer.
  await user(ctx.B, 'ana@rb-b.local', 'RESIDENT', 'Ana Gómez', 'TORRE 2', '304');

  const mkPkg = (residenteId, estado) => enA(() => prisma.package.create({
    data: { residenteId, proveedor: 'X', estado, categoriaPeso: 'ESTANDAR', costoServicio: 4500, pin: '123456' },
  }));
  await mkPkg(ctx.ana.id, 'EN_RECEPCION');
  await mkPkg(ctx.ana.id, 'PROGRAMADO');
  await mkPkg(ctx.ana.id, 'PREALERTADO');
  await mkPkg(ctx.ana.id, 'ENTREGADO');

  server = await new Promise((resolve) => { const s = createApp().listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  ctx.tOp = await login('op@rb-a.local');
  ctx.tRes = await login('ana@rb-a.local');
});

test('formatos de apartamento', { skip }, async () => {
  for (const q of ['T2 304', 't2-304', '2-304', '2 304', 'Torre 2 apto 304', '2/304']) {
    const { status, body } = await buscar(q);
    assert.equal(status, 200, q);
    assert.deepEqual(body.map((r) => r.id), [ctx.ana.id], q);
  }
});

test('solo apto devuelve todas las torres, y el formato de respuesta no expone contacto', { skip }, async () => {
  const { body } = await buscar('304');
  assert.deepEqual(body.map((r) => r.id).sort(), [ctx.ana.id, ctx.luis.id].sort());
  assert.deepEqual(body.map((r) => r.etiqueta), ['T1 · 304', 'T2 · 304']);
  for (const r of body) {
    assert.deepEqual(Object.keys(r).sort(), ['apto', 'etiqueta', 'id', 'nombre', 'pendientes', 'torre']);
  }
});

test('torre guardada como "T3" también coincide con "3 301"', { skip }, async () => {
  const { body } = await buscar('3 301');
  assert.deepEqual(body.map((r) => r.id), [ctx.t1.id]);
  assert.equal(body[0].etiqueta, 'T3 · 301');
});

test('nombre con y sin tildes, mayúsculas y parcial', { skip }, async () => {
  for (const q of ['gomez', 'GÓMEZ', 'ana', 'Ana Gó', 'ana gomez']) {
    const { body } = await buscar(q);
    assert.deepEqual(body.map((r) => r.id), [ctx.ana.id], q);
  }
  assert.deepEqual((await buscar('zzzz')).body, []);
});

test('prefijo numérico: "30" encuentra 301 y 304; exacto va primero', { skip }, async () => {
  const { body } = await buscar('30');
  assert.deepEqual(body.map((r) => r.apto).sort(), ['301', '304', '304']);
  const exacto = await buscar('301');
  assert.equal(exacto.body[0].apto, '301');
});

test('máximo 5 resultados', { skip }, async () => {
  const { body } = await buscar('Torre 5');
  assert.equal(body.length, 5);
  const todos = await buscar('masivo');
  assert.equal(todos.body.length, 5);
});

test('pendientes cuenta solo EN_RECEPCION y PROGRAMADO', { skip }, async () => {
  const { body } = await buscar('T2 304');
  assert.equal(body[0].pendientes, 2);
  assert.equal((await buscar('T1 304')).body[0].pendientes, 0);
});

test('un residente de otro conjunto nunca aparece', { skip }, async () => {
  for (const q of ['304', 'ana', '2 304']) {
    const { body } = await buscar(q);
    assert.ok(body.every((r) => [ctx.ana.id, ctx.luis.id].includes(r.id)), q);
  }
  assert.equal((await buscar('ana')).body.length, 1);
});

test('q vacío o ausente -> 400 DATOS_INVALIDOS', { skip }, async () => {
  for (const url of ['/api/residentes/buscar', '/api/residentes/buscar?q=', '/api/residentes/buscar?q=%20%20']) {
    const r = await api(url, { token: ctx.tOp });
    assert.equal(r.status, 400, url);
    assert.equal((await r.json()).code, 'DATOS_INVALIDOS');
  }
});

test('un RESIDENT recibe 403 y sin sesión 401', { skip }, async () => {
  const r = await api('/api/residentes/buscar?q=304', { token: ctx.tRes });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, 'PROHIBIDO');
  const s = await api('/api/residentes/buscar?q=304');
  assert.equal(s.status, 401);
});

test('teardown', { skip }, async () => {
  await new Promise((resolve) => server.close(resolve));
  await limpiar();
});
