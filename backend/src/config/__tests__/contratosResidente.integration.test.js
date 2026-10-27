// Integración de T2.8 contra Postgres real: contratos que pidieron las pantallas del
// residente (recoger en portería, transportadora, motivoCobro, bonos propios).

import test from 'node:test';
import assert from 'node:assert/strict';
import { purgarEventos } from '../../../test-support/purgarEventos.js';

const dbUrl = process.env.DATABASE_URL;
let dbHost = null;
try { dbHost = dbUrl ? new URL(dbUrl).hostname : null; } catch { dbHost = null; }
const esLocal = !!dbHost && new Set(['localhost', '127.0.0.1', '::1']).has(dbHost);
const razonSkip = !dbUrl ? 'DATABASE_URL no definida' : !esLocal ? `DATABASE_URL apunta a un host NO local (${dbHost})` : null;
const omitir = razonSkip !== null;
if (omitir) console.warn(`[contratosResidente.integration] OMITIDA: ${razonSkip}`);
if (!omitir && !process.env.JWT_SECRET) process.env.JWT_SECRET = 'itest-secret';
if (!omitir) process.env.FRONTEND_URL = 'https://app.itest.local/';

let prisma, runWithTenant, createApp, server, base;
const SLUG = 'itestr-alfa';
const SLUG_OFF = 'itestr-sinbonos';
const PWD = 'Password1';
const ctx = {};
const skip = omitir && razonSkip;

async function limpiar() {
  const conjuntos = await prisma.conjunto.findMany({ where: { slug: { in: [SLUG, SLUG_OFF] } } });
  for (const c of conjuntos) {
    await purgarEventos(prisma, c.id);
    await runWithTenant({ conjuntoId: c.id, role: 'OPERATOR' }, async () => {
      await prisma.bono.deleteMany({});
      await prisma.package.deleteMany({});
      await prisma.user.deleteMany({});
    });
  }
  await prisma.conjunto.deleteMany({ where: { slug: { in: [SLUG, SLUG_OFF] } } });
}
function api(path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
async function login(email) {
  return (await (await api('/api/auth/login', { method: 'POST', body: { email, password: PWD } })).json()).token;
}
const enA = (fn) => runWithTenant({ conjuntoId: ctx.A, role: 'OPERATOR' }, fn);
const recibir = async (residenteId) => (await api('/api/packages/recepcion', {
  method: 'POST', token: ctx.tOp, body: { residenteId, categoriaPeso: 'ESTANDAR', transportadora: 'Servientrega' },
})).json();

test('setup', { skip }, async () => {
  ({ prisma } = await import('../db.js'));
  ({ runWithTenant } = await import('../tenantContext.js'));
  ({ createApp } = await import('../../app.js'));
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(PWD, 10);
  await limpiar();
  const mk = (slug, bonosHabilitados) => prisma.conjunto.create({
    data: {
      nombre: `Conjunto ${slug}`, slug, codigoInvitacion: `${slug}-cod`, operadorNombre: 'Op',
      operadorWhatsapp: '573000000000', operadorDomicilio: 'Dir', puntoRecepcion: 'Recepción', bonosHabilitados,
    },
  });
  ctx.A = (await mk(SLUG, true)).id;
  ctx.OFF = (await mk(SLUG_OFF, false)).id;
  const user = (conjuntoId, email, role, apto) => runWithTenant({ conjuntoId, role: 'OPERATOR' }, () =>
    prisma.user.create({
      data: { email, passwordHash: hash, role, nombre: `Ana ${apto ?? 'Op'}`, telefono: '3001112233', torre: 'T1', apto, termsAcceptedAt: new Date() },
    }));
  ctx.opA = await user(ctx.A, 'op@ra.local', 'OPERATOR', null);
  ctx.res1 = await user(ctx.A, 'r1@ra.local', 'RESIDENT', '101');
  ctx.res2 = await user(ctx.A, 'r2@ra.local', 'RESIDENT', '202');
  ctx.resOff = await user(ctx.OFF, 'r1@off.local', 'RESIDENT', '101');
  const app = createApp();
  await new Promise((resolve) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  ctx.tOp = await login('op@ra.local');
  ctx.tRes1 = await login('r1@ra.local');
  ctx.tRes2 = await login('r2@ra.local');
  ctx.tOff = await login('r1@off.local');
});

test('pre-alerta con solo transportadora: proveedor "Sin especificar" y transportadora guardada', { skip }, async () => {
  const r = await api('/api/packages', { method: 'POST', token: ctx.tRes1, body: { transportadora: ' Rappi ' } });
  assert.equal(r.status, 201);
  const p = await r.json();
  assert.equal(p.proveedor, 'Sin especificar');
  assert.equal(p.transportadora, 'Rappi');
  const ambos = await (await api('/api/packages', { method: 'POST', token: ctx.tRes1, body: { proveedor: 'Amazon', transportadora: 'Envía' } })).json();
  assert.equal(ambos.proveedor, 'Amazon');
  assert.equal(ambos.transportadora, 'Envía');
  const solo = await (await api('/api/packages', { method: 'POST', token: ctx.tRes1, body: { proveedor: 'Falabella' } })).json();
  assert.equal(solo.transportadora, null);
});

test('pre-alerta sin proveedor ni transportadora, o con transportadora inválida: 400', { skip }, async () => {
  assert.equal((await api('/api/packages', { method: 'POST', token: ctx.tRes1, body: {} })).status, 400);
  assert.equal((await api('/api/packages', { method: 'POST', token: ctx.tRes1, body: { transportadora: '   ' } })).status, 400);
  assert.equal((await api('/api/packages', { method: 'POST', token: ctx.tRes1, body: { proveedor: 'X', transportadora: 5 } })).status, 400);
  assert.equal((await api('/api/packages', { method: 'POST', token: ctx.tRes1, body: { proveedor: 'X', transportadora: 'a'.repeat(61) } })).status, 400);
});

test('schedule con RECOGER: PROGRAMADO, modalidad guardada, franja limpia, evento en bitácora', { skip }, async () => {
  const { paquete } = await recibir(ctx.res1.id);
  const r = await api(`/api/packages/${paquete.id}/schedule`, { method: 'PATCH', token: ctx.tRes1, body: { modalidad: 'RECOGER' } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.estado, 'PROGRAMADO');
  assert.equal(j.modalidadEntrega, 'RECOGER');
  assert.equal(j.franjaHoraria, null);
  const ev = await enA(() => prisma.paqueteEvento.findFirst({ where: { paqueteId: paquete.id, tipo: 'PROGRAMAR' } }));
  assert.equal(ev.datos.modalidad, 'RECOGER');
  // El operador lo ve en el listado (Pendientes) y el residente en /mine y /p/paquetes.
  const lista = await (await api('/api/packages', { token: ctx.tOp })).json();
  assert.equal(lista.find((x) => x.id === paquete.id).modalidadEntrega, 'RECOGER');
  const mine = await (await api('/api/packages/mine', { token: ctx.tRes1 })).json();
  assert.equal(mine.find((x) => x.id === paquete.id).modalidadEntrega, 'RECOGER');
  ctx.pRecoger = paquete.id;
});

test('schedule sin modalidad = DOMICILIO (como siempre); se puede cambiar de RECOGER a DOMICILIO', { skip }, async () => {
  const { paquete } = await recibir(ctx.res1.id);
  const j = await (await api(`/api/packages/${paquete.id}/schedule`, {
    method: 'PATCH', token: ctx.tRes1, body: { franjaHoraria: '6:00 pm - 8:00 pm', metodoPagoServicio: 'EFECTIVO' },
  })).json();
  assert.equal(j.estado, 'PROGRAMADO');
  assert.equal(j.modalidadEntrega, 'DOMICILIO');
  assert.equal(j.franjaHoraria, '6:00 pm - 8:00 pm');
  const vuelta = await (await api(`/api/packages/${ctx.pRecoger}/schedule`, {
    method: 'PATCH', token: ctx.tRes1, body: { modalidad: 'DOMICILIO', franjaHoraria: '6:00 pm - 8:00 pm', metodoPagoServicio: 'EFECTIVO' },
  })).json();
  assert.equal(vuelta.modalidadEntrega, 'DOMICILIO');
  assert.equal(vuelta.franjaHoraria, '6:00 pm - 8:00 pm');
});

test('schedule: modalidad inválida 400; paquete ajeno 404; PREALERTADO 409', { skip }, async () => {
  const { paquete } = await recibir(ctx.res1.id);
  assert.equal((await api(`/api/packages/${paquete.id}/schedule`, { method: 'PATCH', token: ctx.tRes1, body: { modalidad: 'VOLAR' } })).status, 400);
  assert.equal((await api(`/api/packages/${paquete.id}/schedule`, { method: 'PATCH', token: ctx.tRes2, body: { modalidad: 'RECOGER' } })).status, 404);
  const pre = await (await api('/api/packages', { method: 'POST', token: ctx.tRes1, body: { proveedor: 'X' } })).json();
  assert.equal((await api(`/api/packages/${pre.id}/schedule`, { method: 'PATCH', token: ctx.tRes1, body: { modalidad: 'RECOGER' } })).status, 409);
  const intacto = await enA(() => prisma.package.findUnique({ where: { id: paquete.id } }));
  assert.equal(intacto.modalidadEntrega, null);
});

test('RECOGER también funciona con la sesión del enlace, y /api/p/paquetes lo devuelve', { skip }, async () => {
  const { tokenDeResidente } = await import('../../services/enlace.service.js');
  const { paquete } = await recibir(ctx.res2.id);
  const abierto = await (await api('/api/p/abrir', { method: 'POST', body: { token: tokenDeResidente({ residenteId: ctx.res2.id, conjuntoId: ctx.A }) } })).json();
  const r = await api(`/api/packages/${paquete.id}/schedule`, { method: 'PATCH', token: abierto.sesion, body: { modalidad: 'RECOGER' } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).modalidadEntrega, 'RECOGER');
  const vista = await (await api('/api/p/paquetes', { token: abierto.sesion })).json();
  assert.equal(vista.paquetes.find((x) => x.id === paquete.id).modalidadEntrega, 'RECOGER');
});

test('motivoCobro en /mine y /p/paquetes (del evento RECIBIR), null en pre-alertas', { skip }, async () => {
  const mine = await (await api('/api/packages/mine', { token: ctx.tRes1 })).json();
  const recibidos = mine.filter((p) => p.estado !== 'PREALERTADO');
  assert.ok(recibidos.length >= 2);
  assert.ok(recibidos.every((p) => typeof p.motivoCobro === 'string' && p.motivoCobro), JSON.stringify(recibidos.map((p) => p.motivoCobro)));
  assert.ok(mine.filter((p) => p.estado === 'PREALERTADO').every((p) => p.motivoCobro === null));
  assert.ok(mine.every((p) => !('fotoUrl' in p)));
  const cortesia = recibidos.find((p) => p.motivoCobro === 'CORTESIA');
  assert.ok(cortesia, 'el primero del apartamento es cortesía');
  assert.equal(cortesia.costoServicio, 0);
  const vista = await (await api('/api/p/paquetes', { token: ctx.tRes1 })).json();
  assert.ok(vista.paquetes.length >= 2);
  for (const p of vista.paquetes) {
    assert.equal(p.motivoCobro, mine.find((m) => m.id === p.id).motivoCobro);
  }
});

test('GET /api/bonos/mine: el residente ve solo sus bonos (saldo por categoría); el operador no', { skip }, async () => {
  const crear = (residenteId, categoriaPeso) => api('/api/bonos', {
    method: 'POST', token: ctx.tOp, body: { residenteId, categoriaPeso, cantidad: 5, precioPagado: 20000 },
  });
  assert.equal((await crear(ctx.res1.id, 'ESTANDAR')).status, 201);
  assert.equal((await crear(ctx.res2.id, 'ESTANDAR')).status, 201);
  const r = await api('/api/bonos/mine', { token: ctx.tRes1 });
  assert.equal(r.status, 200);
  const bonos = await r.json();
  assert.equal(bonos.length, 1);
  assert.equal(bonos[0].residenteId, ctx.res1.id);
  assert.equal(bonos[0].categoriaPeso, 'ESTANDAR');
  assert.equal(bonos[0].cantidadTotal - bonos[0].cantidadUsada, 5);
  assert.equal((await api('/api/bonos/mine', { token: ctx.tOp })).status, 403);
  assert.equal((await api('/api/bonos/mine')).status, 401);
  // Con la sesión del enlace no se ven bonos (no está en la lista permitida).
  const { tokenDeResidente } = await import('../../services/enlace.service.js');
  const ab = await (await api('/api/p/abrir', { method: 'POST', body: { token: tokenDeResidente({ residenteId: ctx.res1.id, conjuntoId: ctx.A }) } })).json();
  assert.equal((await api('/api/bonos/mine', { token: ab.sesion })).status, 403);
});

test('conjunto sin bonos habilitados: /conjunto/config lo dice y no hay bonos que ver', { skip }, async () => {
  const cfg = await (await api('/api/conjunto/config', { token: ctx.tOff })).json();
  assert.equal(cfg.bonosHabilitados, false);
  assert.deepEqual(await (await api('/api/bonos/mine', { token: ctx.tOff })).json(), []);
  const cfgA = await (await api('/api/conjunto/config', { token: ctx.tRes1 })).json();
  assert.equal(cfgA.bonosHabilitados, true);
});

test('limpieza', { skip }, async () => {
  server.close();
  await limpiar();
  await prisma.$disconnect();
});
