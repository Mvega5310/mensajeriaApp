// Integración de T1.3 contra Postgres real: máquina de estados aplicada en los
// controladores, bitácora PaqueteEvento (solo inserción, con tenant) y bono
// atómico. Mismo patrón de skip/guarda de localhost que las demás integraciones.

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
if (omitir) console.warn(`[paquete.integration] OMITIDA: ${razonSkip}`);
if (!omitir && !process.env.JWT_SECRET) process.env.JWT_SECRET = 'itest-secret';

let prisma, runWithTenant, createApp, server, base;
const SLUG_A = 'itestp-alfa';
const SLUG_B = 'itestp-beta';
const PWD = 'Password1';
const ctx = {};

const enA = (fn) => runWithTenant({ conjuntoId: ctx.A, role: 'OPERATOR' }, fn);
const enB = (fn) => runWithTenant({ conjuntoId: ctx.B, role: 'OPERATOR' }, fn);

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

function api(path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
async function login(email) {
  const r = await api('/api/auth/login', { method: 'POST', body: { email, password: PWD } });
  return (await r.json()).token;
}

// Pre-alerta vía HTTP (deja el evento PREALERTAR) y devuelve el paquete.
async function prealertar(token, proveedor) {
  const r = await api('/api/packages', { method: 'POST', token, body: { proveedor, categoriaPeso: 'ESTANDAR' } });
  assert.equal(r.status, 201);
  return r.json();
}
const checkin = (token, id) =>
  api(`/api/packages/${id}/checkin`, { method: 'PATCH', token, body: { categoriaPeso: 'ESTANDAR' } });
const eventosDe = (id) => enA(() => prisma.paqueteEvento.findMany({ where: { paqueteId: id }, orderBy: { creadoEn: 'asc' } }));

test('setup', { skip: omitir && razonSkip }, async () => {
  ({ prisma } = await import('../db.js'));
  ({ runWithTenant } = await import('../tenantContext.js'));
  ({ createApp } = await import('../../app.js'));
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(PWD, 10);

  await limpiar();
  const mk = (slug, bonos) => prisma.conjunto.create({
    data: {
      nombre: slug, slug, codigoInvitacion: `${slug}-cod`, operadorNombre: 'Op', operadorWhatsapp: '573000000000',
      operadorDomicilio: 'Dir', puntoRecepcion: 'Recepción', bonosHabilitados: bonos,
    },
  });
  ctx.A = (await mk(SLUG_A, true)).id;
  ctx.B = (await mk(SLUG_B, false)).id;
  const user = (conjuntoId, email, role, apto) => runWithTenant({ conjuntoId, role: 'OPERATOR' }, () =>
    prisma.user.create({ data: { email, passwordHash: hash, role, nombre: email, telefono: '1', torre: 'T1', apto, termsAcceptedAt: new Date() } }));
  ctx.opA = await user(ctx.A, 'op@pa.local', 'OPERATOR', null);
  ctx.resA = await user(ctx.A, 'res@pa.local', 'RESIDENT', '101');
  ctx.opB = await user(ctx.B, 'op@pb.local', 'OPERATOR', null);
  ctx.resB = await user(ctx.B, 'res@pb.local', 'RESIDENT', '101');

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
  ctx.tOpA = await login('op@pa.local');
  ctx.tResA = await login('res@pa.local');
  ctx.tOpB = await login('op@pb.local');
  ctx.tResB = await login('res@pb.local');

  // Paquete base: absorbe la cortesía de primera entrega del apto 101 de Alfa
  // para que los siguientes puedan consumir bono / cobrar tarifa.
  ctx.base = await prealertar(ctx.tResA, 'base');
});

test('flujo completo: un evento por cambio con de/a correctos y actor', { skip: omitir && razonSkip }, async () => {
  const p = await prealertar(ctx.tResA, 'flujo');
  assert.equal((await checkin(ctx.tOpA, p.id)).status, 200);
  const sch = await api(`/api/packages/${p.id}/schedule`, { method: 'PATCH', token: ctx.tResA, body: { franjaHoraria: 'MAÑANA', metodoPagoServicio: 'EFECTIVO' } });
  assert.equal(sch.status, 200);
  assert.equal((await sch.json()).estado, 'PROGRAMADO');
  const pin = (await enA(() => prisma.package.findUnique({ where: { id: p.id } }))).pin;
  const ok = await api(`/api/packages/${p.id}/confirm-delivery`, { method: 'POST', token: ctx.tOpA, body: { pin } });
  assert.equal(ok.status, 200);

  const ev = await eventosDe(p.id);
  assert.deepEqual(
    ev.map((e) => [e.tipo, e.deEstado, e.aEstado]),
    [
      ['PREALERTAR', null, 'PREALERTADO'],
      ['RECIBIR', 'PREALERTADO', 'EN_RECEPCION'],
      ['PROGRAMAR', 'EN_RECEPCION', 'PROGRAMADO'],
      ['ENTREGAR', 'PROGRAMADO', 'ENTREGADO'],
    ],
  );
  assert.deepEqual(ev.map((e) => e.actorId), [ctx.resA.id, ctx.opA.id, ctx.resA.id, ctx.opA.id]);
  assert.ok(ev.every((e) => e.conjuntoId === ctx.A));
});

test('no se puede recibir un paquete ENTREGADO (409) y no deja evento extra', { skip: omitir && razonSkip }, async () => {
  const p = await prealertar(ctx.tResA, 'entregado');
  await checkin(ctx.tOpA, p.id);
  const pin = (await enA(() => prisma.package.findUnique({ where: { id: p.id } }))).pin;
  await api(`/api/packages/${p.id}/confirm-delivery`, { method: 'POST', token: ctx.tOpA, body: { pin } });
  const r = await checkin(ctx.tOpA, p.id);
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, 'TRANSICION_INVALIDA');
  assert.equal((await eventosDe(p.id)).length, 3);
  // Tampoco se puede programar un ENTREGADO.
  const s = await api(`/api/packages/${p.id}/schedule`, { method: 'PATCH', token: ctx.tResA, body: { franjaHoraria: 'X' } });
  assert.equal(s.status, 409);
});

test('no se puede entregar un PREALERTADO (409), ni con PIN equivocado (no gasta intento)', { skip: omitir && razonSkip }, async () => {
  const p = await prealertar(ctx.tResA, 'prealertado');
  const real = (await enA(() => prisma.package.findUnique({ where: { id: p.id } }))).pin;
  const conReal = await api(`/api/packages/${p.id}/confirm-delivery`, { method: 'POST', token: ctx.tOpA, body: { pin: real } });
  assert.equal(conReal.status, 409);
  assert.equal((await conReal.json()).code, 'TRANSICION_INVALIDA');
  const malo = await api(`/api/packages/${p.id}/confirm-delivery`, { method: 'POST', token: ctx.tOpA, body: { pin: real === '0000' ? '1111' : '0000' } });
  assert.equal(malo.status, 409, 'la transición se valida ANTES que el PIN');
  // Residente tampoco puede programar un PREALERTADO.
  const s = await api(`/api/packages/${p.id}/schedule`, { method: 'PATCH', token: ctx.tResA, body: { franjaHoraria: 'X' } });
  assert.equal(s.status, 409);
  assert.equal((await eventosDe(p.id)).length, 1);
});

async function crearBono(cantidadTotal) {
  return enA(() => prisma.bono.create({
    data: { residenteId: ctx.resA.id, categoriaPeso: 'ESTANDAR', cantidadTotal, precioPagado: 1000 },
  }));
}
const bonoActual = (id) => enA(() => prisma.bono.findUnique({ where: { id } }));

test('re-checkin no descuenta el bono dos veces', { skip: omitir && razonSkip }, async () => {
  const bono = await crearBono(3);
  const p = await prealertar(ctx.tResA, 'recheck');
  const r1 = await checkin(ctx.tOpA, p.id);
  assert.equal(r1.status, 200);
  const j1 = await r1.json();
  assert.equal(j1.costoServicio, 0);
  assert.deepEqual(j1.bonoAplicado, { id: bono.id, quedan: 2 });
  assert.equal((await checkin(ctx.tOpA, p.id)).status, 409);
  assert.equal((await bonoActual(bono.id)).cantidadUsada, 1);
  await enA(() => prisma.package.updateMany({ where: { bonoId: bono.id }, data: { bonoId: null } }));
  await enA(() => prisma.bono.delete({ where: { id: bono.id } }));
});

test('dos checkins concurrentes con un único crédito: solo uno consume el bono', { skip: omitir && razonSkip }, async () => {
  const bono = await crearBono(1);
  const [p1, p2] = [await prealertar(ctx.tResA, 'conc1'), await prealertar(ctx.tResA, 'conc2')];
  const [r1, r2] = await Promise.all([checkin(ctx.tOpA, p1.id), checkin(ctx.tOpA, p2.id)]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  const [j1, j2] = [await r1.json(), await r2.json()];
  const conBono = [j1, j2].filter((j) => j.bonoAplicado);
  assert.equal(conBono.length, 1, 'solo un paquete consume el crédito');
  const sinBono = [j1, j2].find((j) => !j.bonoAplicado);
  assert.equal(sinBono.costoServicio, 4500, 'el que pierde la carrera cobra TARIFA');
  assert.equal(conBono[0].costoServicio, 0);
  assert.equal((await bonoActual(bono.id)).cantidadUsada, 1);
  const evSin = (await eventosDe(sinBono.id)).find((e) => e.tipo === 'RECIBIR');
  assert.equal(evSin.datos.motivoCobro, 'TARIFA');
  await enA(() => prisma.package.updateMany({ where: { bonoId: bono.id }, data: { bonoId: null } }));
  await enA(() => prisma.bono.delete({ where: { id: bono.id } }));
});

test('checkin concurrente del MISMO paquete: uno gana, el otro 409 y el bono se gasta una vez', { skip: omitir && razonSkip }, async () => {
  const bono = await crearBono(5);
  const p = await prealertar(ctx.tResA, 'mismo');
  const rs = await Promise.all([checkin(ctx.tOpA, p.id), checkin(ctx.tOpA, p.id)]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await bonoActual(bono.id)).cantidadUsada, 1);
  assert.equal((await eventosDe(p.id)).filter((e) => e.tipo === 'RECIBIR').length, 1);
  await enA(() => prisma.package.updateMany({ where: { bonoId: bono.id }, data: { bonoId: null } }));
  await enA(() => prisma.bono.delete({ where: { id: bono.id } }));
});

test('PaqueteEvento es de solo inserción: UPDATE y DELETE los rechaza el trigger', { skip: omitir && razonSkip }, async () => {
  const [{ id }] = await eventosDe(ctx.base.id);
  await assert.rejects(
    prisma.$executeRaw`UPDATE "PaqueteEvento" SET "tipo" = 'X' WHERE "id" = ${id}`,
    /solo inserción/,
  );
  await assert.rejects(
    prisma.$executeRaw`DELETE FROM "PaqueteEvento" WHERE "id" = ${id}`,
    /solo inserción/,
  );
  assert.equal((await eventosDe(ctx.base.id)).length, 1);
});

test('aislamiento: un conjunto no ve los eventos de otro', { skip: omitir && razonSkip }, async () => {
  const pB = await enB(() => prisma.package.create({ data: { residenteId: ctx.resB.id, proveedor: 'pb', pin: '1234' } }));
  await enB(() => prisma.paqueteEvento.create({ data: { paqueteId: pB.id, tipo: 'PREALERTAR', deEstado: null, aEstado: 'PREALERTADO' } }));
  const vistosPorA = await enA(() => prisma.paqueteEvento.findMany({ where: { paqueteId: pB.id } }));
  assert.equal(vistosPorA.length, 0);
  const vistosPorB = await enB(() => prisma.paqueteEvento.findMany({}));
  assert.ok(vistosPorB.length === 1 && vistosPorB.every((e) => e.conjuntoId === ctx.B));
  const totalA = await enA(() => prisma.paqueteEvento.count({}));
  assert.ok(totalA > 0);
  // Operador de B no puede operar un paquete de A (404, sin evento nuevo).
  const r = await checkin(ctx.tOpB, ctx.base.id);
  assert.equal(r.status, 404);
});

test('teardown', { skip: omitir && razonSkip }, async () => {
  await limpiar();
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
});
