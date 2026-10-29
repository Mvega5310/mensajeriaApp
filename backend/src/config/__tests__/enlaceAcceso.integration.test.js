// Integración de T3.2 contra Postgres real: acceso por enlace mágico de un solo
// uso (POST /api/auth/enlace y /enlace/canjear). Notificador fake.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { purgarEventos } from '../../../test-support/purgarEventos.js';
import { crearUsuarioDeContexto } from '../../../test-support/usuarios.js';

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
if (omitir) console.warn(`[enlaceAcceso.integration] OMITIDA: ${razonSkip}`);
if (!omitir && !process.env.JWT_SECRET) process.env.JWT_SECRET = 'itest-secret';
if (!omitir) process.env.FRONTEND_URL = 'https://app.itest.local/';

let prisma, runWithTenant, createApp, crearNotificadorFake, jwt, server, base, notificador;
const SLUG = 'itesta-acceso';
const PWD = 'Password1';
const MSG = 'Si el correo está registrado, te llegará un enlace para entrar. Revisa tu bandeja.';
const ctx = {};
const skip = omitir && razonSkip;
const espera = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

async function limpiar() {
  const c = await prisma.conjunto.findUnique({ where: { slug: SLUG } });
  if (!c) return;
  await purgarEventos(prisma, c.id);
  const users = await runWithTenant({ conjuntoId: c.id, role: 'OPERATOR' }, () => prisma.user.findMany({ where: { conjuntoId: c.id }, select: { id: true } }));
  await prisma.passwordResetToken.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await runWithTenant({ conjuntoId: c.id, role: 'OPERATOR' }, async () => {
    await prisma.package.deleteMany({});
    await prisma.domicilio.deleteMany({});
    await prisma.user.deleteMany({ where: { conjuntoId: c.id } });
  });
  await prisma.conjunto.deleteMany({ where: { slug: SLUG } });
}

function api(path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const pedir = (email) => api('/api/auth/enlace', { method: 'POST', body: { email } });
const canjear = (token) => api('/api/auth/enlace/canjear', { method: 'POST', body: { token } });
// Extrae el token del último correo enviado (html con &amp;).
function tokenDelCorreo(mensaje) {
  const html = mensaje.html.replace(/&amp;/g, '&');
  const m = html.match(/https:\/\/app\.itest\.local\/acceso\/([0-9a-f]{64})/);
  assert.ok(m, `URL /acceso/ en el correo: ${html}`);
  return m[1];
}
// Token directo en BD (para propósito/vencimiento controlados).
async function sembrar({ userId, proposito, expiresAt = new Date(Date.now() + 60_000) }) {
  const raw = crypto.randomBytes(32).toString('hex');
  await prisma.passwordResetToken.create({ data: { userId, tokenHash: hash(raw), proposito, expiresAt } });
  return raw;
}

test('setup', { skip }, async () => {
  ({ prisma } = await import('../db.js'));
  ({ runWithTenant } = await import('../tenantContext.js'));
  ({ createApp } = await import('../../app.js'));
  ({ crearNotificadorFake } = await import('../../services/notificador/fake.js'));
  jwt = (await import('jsonwebtoken')).default;
  const bcrypt = (await import('bcryptjs')).default;
  await limpiar();
  const c = await prisma.conjunto.create({
    data: {
      nombre: 'Conjunto Acceso', slug: SLUG, codigoInvitacion: `${SLUG}-cod`, operadorNombre: 'Op',
      operadorWhatsapp: '573000000000', operadorDomicilio: 'Dir', puntoRecepcion: 'Recepción',
    },
  });
  ctx.A = c.id;
  const passwordHash = await bcrypt.hash(PWD, 10);
  ctx.res = await runWithTenant({ conjuntoId: ctx.A, role: 'OPERATOR' }, () => crearUsuarioDeContexto(prisma, {
    data: { email: 'ana@acceso.local', passwordHash, role: 'RESIDENT', nombre: 'Ana', telefono: '3001112233', torre: 'T1', apto: '101', termsAcceptedAt: new Date() },
  }));
  ctx.op = await runWithTenant({ conjuntoId: ctx.A, role: 'OPERATOR' }, () => crearUsuarioDeContexto(prisma, {
    data: { email: 'op@acceso.local', passwordHash, role: 'OPERATOR', nombre: 'Operador', telefono: '3001110000', termsAcceptedAt: new Date() },
  }));
  notificador = crearNotificadorFake();
  const app = createApp({ notificador });
  await new Promise((resolve) => {
    server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
});

test('email existente: 200 genérico y 1 correo con URL /acceso/<token>', { skip }, async () => {
  notificador.limpiar();
  const r = await pedir('ana@acceso.local');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { message: MSG });
  await espera();
  const env = notificador.obtenerEnviados();
  assert.equal(env.length, 1);
  assert.equal(env[0].para, 'ana@acceso.local');
  ctx.token = tokenDelCorreo(env[0]);
  // En BD solo vive el hash, con propósito ACCESO y ~15 min.
  const fila = await prisma.passwordResetToken.findFirst({ where: { tokenHash: hash(ctx.token) } });
  assert.equal(fila.proposito, 'ACCESO');
  assert.equal(await prisma.passwordResetToken.count({ where: { tokenHash: ctx.token } }), 0);
  const ms = fila.expiresAt.getTime() - Date.now();
  assert.ok(ms > 14 * 60_000 && ms <= 15 * 60_000, `vence en ~15 min (${ms})`);
});

test('email inexistente: 200 idéntico y 0 correos', { skip }, async () => {
  notificador.limpiar();
  const r = await pedir('nadie@acceso.local');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { message: MSG });
  const vacio = await api('/api/auth/enlace', { method: 'POST', body: {} });
  assert.equal(vacio.status, 200);
  assert.deepEqual(await vacio.json(), { message: MSG });
  await espera();
  assert.equal(notificador.obtenerEnviados().length, 0);
});

test('M4: un operador recibe el mismo 200 genérico pero NO se le envía enlace ni se crea token', { skip }, async () => {
  notificador.limpiar();
  const r = await pedir('op@acceso.local');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { message: MSG });
  await espera();
  assert.equal(notificador.obtenerEnviados().length, 0);
  assert.equal(await prisma.passwordResetToken.count({ where: { userId: ctx.op.id, proposito: 'ACCESO' } }), 0);
});

test('canjear: JWT normal (sin scope) que funciona en /me y en rutas de residente', { skip }, async () => {
  const r = await canjear(ctx.token);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(body.user, { id: ctx.res.id, nombre: 'Ana', role: 'RESIDENT' });
  const dec = jwt.verify(body.token, process.env.JWT_SECRET);
  assert.equal(dec.sub, ctx.res.id);
  assert.equal(dec.scope, undefined);
  const me = await api('/api/auth/me', { token: body.token });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).email, 'ana@acceso.local');
  const mine = await api('/api/packages/mine', { token: body.token });
  assert.equal(mine.status, 200);
});

test('segundo canje del mismo token: 400 ENLACE_INVALIDO', { skip }, async () => {
  const r = await canjear(ctx.token);
  assert.equal(r.status, 400);
  const b = await r.json();
  assert.equal(b.code, 'ENLACE_INVALIDO');
  assert.equal(b.error ?? b.message, 'El enlace ya no sirve. Pide uno nuevo.');
});

test('token vencido, basura y ausente: 400', { skip }, async () => {
  const venc = await sembrar({ userId: ctx.res.id, proposito: 'ACCESO', expiresAt: new Date(Date.now() - 1000) });
  assert.equal((await canjear(venc)).status, 400);
  assert.equal((await canjear('basura')).status, 400);
  assert.equal((await api('/api/auth/enlace/canjear', { method: 'POST', body: {} })).status, 400);
});

test('un token de RESET no canjea acceso, y el reset no acepta tokens de ACCESO', { skip }, async () => {
  const reset = await sembrar({ userId: ctx.res.id, proposito: 'RESET' });
  assert.equal((await canjear(reset)).status, 400);
  const sinUsar = await prisma.passwordResetToken.findFirst({ where: { tokenHash: hash(reset) } });
  assert.equal(sinUsar.usedAt, null, 'el canje fallido no consumió el token de reset');

  const acceso = await sembrar({ userId: ctx.res.id, proposito: 'ACCESO' });
  const r = await api('/api/auth/reset-password', { method: 'POST', body: { token: acceso, password: 'Nueva1234' } });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, 'ENLACE_INVALIDO');
  // El de acceso sigue vivo y canjeable.
  assert.equal((await canjear(acceso)).status, 200);
});

test('flujo forgot/reset existente sigue funcionando (y no lo bloquea un token de acceso)', { skip }, async () => {
  // El cooldown de 1 min de forgot ve el token RESET sembrado arriba: se limpia.
  await prisma.passwordResetToken.deleteMany({ where: { userId: ctx.res.id, proposito: 'RESET' } });
  notificador.limpiar();
  const f = await api('/api/auth/forgot-password', { method: 'POST', body: { email: 'ana@acceso.local' } });
  assert.equal(f.status, 200);
  await espera();
  const env = notificador.obtenerEnviados();
  assert.equal(env.length, 1, 'correo de recuperación pese a haber tokens de acceso recientes');
  const raw = env[0].html.replace(/&amp;/g, '&').match(/restablecer\?token=([0-9a-f]{64})/)[1];
  const r = await api('/api/auth/reset-password', { method: 'POST', body: { token: raw, password: 'Nueva1234' } });
  assert.equal(r.status, 200);
  const l = await api('/api/auth/login', { method: 'POST', body: { email: 'ana@acceso.local', password: 'Nueva1234' } });
  assert.equal(l.status, 200);
});

test('carrera de dos canjes: uno 200 y otro 400', { skip }, async () => {
  const raw = await sembrar({ userId: ctx.res.id, proposito: 'ACCESO' });
  const rs = await Promise.all([canjear(raw), canjear(raw), canjear(raw)]);
  const estados = rs.map((r) => r.status).sort();
  assert.deepEqual(estados, [200, 400, 400]);
});

test('6.ª solicitud en la ventana: 200 genérico pero sin correo nuevo', { skip }, async () => {
  // Limitador propio: la clave es correo+IP y las pruebas previas ya gastaron cupo.
  const email = 'ana@acceso.local';
  const n2 = crearNotificadorFake();
  const app2 = createApp({ notificador: n2 });
  const srv = await new Promise((resolve) => { const s = app2.listen(0, () => resolve(s)); });
  const url = `http://127.0.0.1:${srv.address().port}/api/auth/enlace`;
  try {
    for (let i = 1; i <= 6; i++) {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { message: MSG });
      await espera(60);
      assert.equal(n2.obtenerEnviados().length, Math.min(i, 5), `tras la solicitud ${i}`);
    }
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

test('teardown', { skip }, async () => {
  await new Promise((r) => server.close(r));
  await limpiar();
  await prisma.$disconnect();
});
