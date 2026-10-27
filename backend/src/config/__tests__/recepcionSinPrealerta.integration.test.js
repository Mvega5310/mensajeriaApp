// Integración de T2.1 contra Postgres real: Package sin residente (SIN_ASIGNAR /
// recepción directa), campos nuevos, config del conjunto con defaults y
// aislamiento. Mismo patrón de skip/guarda de localhost que las demás.

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
if (omitir) console.warn(`[recepcionSinPrealerta.integration] OMITIDA: ${razonSkip}`);
if (!omitir && !process.env.JWT_SECRET) process.env.JWT_SECRET = 'itest-secret';

let prisma, runWithTenant, createApp, crearConEvento, EVENTOS, server, base;
const SLUG_A = 'itestr-alfa';
const SLUG_B = 'itestr-beta';
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

// Paquete sin residente creado por el servicio de dominio (como hará T2.3).
const sinResidente = (evento, extra = {}) => enA(() => prisma.$transaction((tx) => crearConEvento(tx, evento, {
  actorId: ctx.opA.id,
  data: {
    proveedor: 'Servientrega', categoriaPeso: 'ESTANDAR', costoServicio: 4500, pin: '123456',
    etiquetaNombre: 'Sra. Gómez', transportadora: 'Servientrega', recibidoEn: new Date(), ...extra,
  },
})));

test('setup', { skip: omitir && razonSkip }, async () => {
  ({ prisma } = await import('../db.js'));
  ({ runWithTenant } = await import('../tenantContext.js'));
  ({ createApp } = await import('../../app.js'));
  ({ crearConEvento } = await import('../../services/paquete.service.js'));
  ({ EVENTOS } = await import('../../domain/paquete.machine.js'));
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(PWD, 10);

  await limpiar();
  const mk = (slug, extra) => prisma.conjunto.create({
    data: {
      nombre: slug, slug, codigoInvitacion: `${slug}-cod`, operadorNombre: 'Op', operadorWhatsapp: '573000000000',
      operadorDomicilio: 'Dir', puntoRecepcion: 'Recepción', ...extra,
    },
  });
  ctx.A = (await mk(SLUG_A)).id;
  ctx.B = (await mk(SLUG_B, { prefijoPais: '52', maxFotos: 5, custodiaMaxDias: 10, franjasEntrega: ['8:00 - 10:00'] })).id;
  const user = (conjuntoId, email, role, apto) => runWithTenant({ conjuntoId, role: 'OPERATOR' }, () =>
    prisma.user.create({ data: { email, passwordHash: hash, role, nombre: email, telefono: '1', torre: 'T1', apto, termsAcceptedAt: new Date() } }));
  ctx.opA = await user(ctx.A, 'op@ra.local', 'OPERATOR', null);
  ctx.resA = await user(ctx.A, 'res@ra.local', 'RESIDENT', '101');
  ctx.opB = await user(ctx.B, 'op@rb.local', 'OPERATOR', null);

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
  ctx.tOpA = await login('op@ra.local');
  ctx.tResA = await login('res@ra.local');
  ctx.tOpB = await login('op@rb.local');
});

test('un paquete SIN_ASIGNAR sin residente se crea con los campos nuevos', { skip: omitir && razonSkip }, async () => {
  const p = await sinResidente(EVENTOS.RECIBIR_SIN_DUENO);
  assert.equal(p.estado, 'SIN_ASIGNAR');
  assert.equal(p.residenteId, null);
  assert.equal(p.etiquetaNombre, 'Sra. Gómez');
  assert.equal(p.transportadora, 'Servientrega');
  assert.equal(p.guia, 'Sin Guía'); // guia reutilizada: default intacto
  assert.ok(p.recibidoEn instanceof Date);
  assert.equal(p.metodoPago, null);
  ctx.sinDueno = p;
});

test('listAll y exportCsv muestran etiquetaNombre cuando no hay residente', { skip: omitir && razonSkip }, async () => {
  const r = await api('/api/packages', { token: ctx.tOpA });
  assert.equal(r.status, 200);
  const lista = await r.json();
  const p = lista.find((x) => x.id === ctx.sinDueno.id);
  assert.ok(p);
  assert.equal(p.residente, null);
  assert.equal(p.etiquetaNombre, 'Sra. Gómez');
  assert.equal(p.esPrimeraEntrega, false);
  assert.equal(p.pin, undefined);

  const csv = await api('/api/packages/export', { token: ctx.tOpA });
  assert.equal(csv.status, 200);
  const texto = await csv.text();
  assert.match(texto, /Sra\. Gómez/);
  assert.ok(texto.includes(ctx.sinDueno.id));
});

test('el residente no ve paquetes sin dueño y el conjunto B tampoco', { skip: omitir && razonSkip }, async () => {
  const mine = await (await api('/api/packages/mine', { token: ctx.tResA })).json();
  assert.ok(!mine.some((x) => x.id === ctx.sinDueno.id));
  const deB = await (await api('/api/packages', { token: ctx.tOpB })).json();
  assert.ok(!deB.some((x) => x.id === ctx.sinDueno.id));
  assert.equal(await enB(() => prisma.package.count({ where: { residenteId: null } })), 0);
});

test('checkin/entrega sobre un SIN_ASIGNAR responden 409, no 500', { skip: omitir && razonSkip }, async () => {
  const c = await api(`/api/packages/${ctx.sinDueno.id}/checkin`, { method: 'PATCH', token: ctx.tOpA, body: { categoriaPeso: 'ESTANDAR' } });
  assert.equal(c.status, 409);
  const e = await api(`/api/packages/${ctx.sinDueno.id}/confirm-delivery`, { method: 'POST', token: ctx.tOpA, body: { pin: '123456' } });
  assert.equal(e.status, 409);
});

test('checkin tolera residente null: cobra TARIFA sin cortesía ni bono', { skip: omitir && razonSkip }, async () => {
  const p = await sinResidente(EVENTOS.PREALERTAR);
  const r = await api(`/api/packages/${p.id}/checkin`, { method: 'PATCH', token: ctx.tOpA, body: { categoriaPeso: 'ESTANDAR' } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.estado, 'EN_RECEPCION');
  assert.equal(j.costoServicio, 4500);
  assert.equal(j.esPrimeraEntrega, false);
  assert.equal(j.bonoAplicado, null);
});

test('confirmDelivery tolera residente null (EN_RECEPCION directo) y fija fechaEntrega', { skip: omitir && razonSkip }, async () => {
  const p = await sinResidente(EVENTOS.RECIBIR);
  assert.equal(p.estado, 'EN_RECEPCION');
  const r = await api(`/api/packages/${p.id}/confirm-delivery`, { method: 'POST', token: ctx.tOpA, body: { pin: '123456' } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.estado, 'ENTREGADO');
  assert.ok(j.fechaEntrega);
});

test('la config del conjunto devuelve los defaults nuevos y los propios', { skip: omitir && razonSkip }, async () => {
  const a = await (await api('/api/conjunto/config', { token: ctx.tOpA })).json();
  assert.equal(a.prefijoPais, '57');
  assert.equal(a.maxFotos, 3);
  assert.equal(a.custodiaMaxDias, 30);
  assert.deepEqual(a.franjasEntrega, ['9:00 a.m. - 12:00 m.', '6:00 p.m. - 9:00 p.m.']);
  assert.deepEqual(a.metodosPago, ['EFECTIVO', 'TRANSFERENCIA']);
  const b = await (await api('/api/conjunto/config', { token: ctx.tOpB })).json();
  assert.equal(b.prefijoPais, '52');
  assert.equal(b.maxFotos, 5);
  assert.equal(b.custodiaMaxDias, 10);
  assert.deepEqual(b.franjasEntrega, ['8:00 - 10:00']);
});

test('teardown', { skip: omitir && razonSkip }, async () => {
  await new Promise((resolve) => server.close(resolve));
  await limpiar();
  await prisma.$disconnect();
});
