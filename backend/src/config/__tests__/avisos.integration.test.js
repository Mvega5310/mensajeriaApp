// Integración de T2.4 contra Postgres real: correo de llegada con notificador fake
// inyectado en createApp({ notificador }). Mismo patrón de skip que las demás.
import test from 'node:test';
import assert from 'node:assert/strict';
import { purgarEventos } from '../../../test-support/purgarEventos.js';

const dbUrl = process.env.DATABASE_URL;
let dbHost = null;
try { dbHost = dbUrl ? new URL(dbUrl).hostname : null; } catch { dbHost = null; }
const esLocal = !!dbHost && new Set(['localhost', '127.0.0.1', '::1']).has(dbHost);
const razonSkip = !dbUrl
  ? 'DATABASE_URL no definida'
  : !esLocal ? `DATABASE_URL apunta a un host NO local (${dbHost})` : null;
const omitir = razonSkip !== null;
if (omitir) console.warn(`[avisos.integration] OMITIDA: ${razonSkip}`);
if (!omitir && !process.env.JWT_SECRET) process.env.JWT_SECRET = 'itest-secret';
const skip = omitir && razonSkip;

let prisma, runWithTenant, createApp, crearNotificadorFake, server, base, notificador;
const SLUG = 'itesta-avisos';
const NOMBRE = 'Conjunto Avisos <b>';
const PWD = 'Password1';
const ctx = {};
const enA = (fn) => runWithTenant({ conjuntoId: ctx.A, role: 'OPERATOR' }, fn);
let n = 0;

async function limpiar() {
  const cs = await prisma.conjunto.findMany({ where: { slug: SLUG } });
  for (const c of cs) {
    await purgarEventos(prisma, c.id);
    await runWithTenant({ conjuntoId: c.id, role: 'OPERATOR' }, async () => {
      await prisma.package.deleteMany({});
      await prisma.user.deleteMany({});
    });
  }
  await prisma.conjunto.deleteMany({ where: { slug: SLUG } });
}
function api(path, { method = 'GET', token, body, headers: extra } = {}) {
  const headers = { ...(extra ?? {}) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const recibir = (body, clave) => api('/api/packages/recepcion', {
  method: 'POST', token: ctx.tOp, body, headers: clave ? { 'Idempotency-Key': clave } : undefined,
});
// El envío es fire-and-forget: se espera un instante a que el fake lo registre.
const esperar = (ms = 50) => new Promise((r) => setTimeout(r, ms));
async function residente({ email, telefono = '3001234567' } = {}) {
  n += 1;
  const bcrypt = (await import('bcryptjs')).default;
  const passwordHash = await bcrypt.hash(PWD, 4);
  return enA(() => prisma.user.create({
    data: {
      email: email === undefined ? `r${n}@itesta.local` : email, passwordHash, role: 'RESIDENT',
      nombre: `Ana Prueba ${n}`, telefono, torre: 'TORRE 1', apto: String(700 + n), termsAcceptedAt: new Date(),
    },
  }));
}

test('setup', { skip }, async () => {
  ({ prisma } = await import('../db.js'));
  ({ runWithTenant } = await import('../tenantContext.js'));
  ({ createApp } = await import('../../app.js'));
  ({ crearNotificadorFake } = await import('../../services/notificador/index.js'));
  const bcrypt = (await import('bcryptjs')).default;
  await limpiar();
  ctx.A = (await prisma.conjunto.create({
    data: { nombre: NOMBRE, slug: SLUG, codigoInvitacion: `${SLUG}-cod`, operadorNombre: 'Op', operadorWhatsapp: '573000000000', operadorDomicilio: 'Dir', puntoRecepcion: 'Recepción' },
  })).id;
  await enA(async () => prisma.user.create({
    data: { email: 'op@itesta.local', passwordHash: await bcrypt.hash(PWD, 4), role: 'OPERATOR', nombre: 'Op', telefono: '3000000000', torre: 'TORRE 9', termsAcceptedAt: new Date() },
  }));
  notificador = crearNotificadorFake();
  const app = createApp({ notificador });
  assert.equal(app.locals.notificador, notificador);
  await new Promise((resolve) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  ctx.tOp = (await (await api('/api/auth/login', { method: 'POST', body: { email: 'op@itesta.local', password: PWD } })).json()).token;
});

test('recepción con residente con correo: 1 correo de llegada, al email correcto, con el nombre del conjunto', { skip }, async () => {
  notificador.limpiar();
  const r = await residente();
  const res = await recibir({ residenteId: r.id, categoriaPeso: 'ESTANDAR', transportadora: 'Amazon' });
  assert.equal(res.status, 201);
  const { aviso } = await res.json();
  await esperar();
  const env = notificador.obtenerEnviados();
  assert.equal(env.length, 1);
  assert.equal(env[0].tipo, 'llegada');
  assert.equal(env[0].para, r.email);
  assert.ok(env[0].asunto.includes('Conjunto Avisos <b>'));
  assert.ok(env[0].html.includes('Conjunto Avisos &lt;b&gt;'), 'el nombre del conjunto va escapado');
  assert.ok(!/ipanema/i.test(env[0].html + env[0].asunto));
  assert.ok(env[0].html.includes('Ana'));
  assert.ok(aviso.waUrl.startsWith('https://wa.me/57'), 'el aviso de WhatsApp sigue siendo manual');
});

test('replay idempotente: 0 correos extra', { skip }, async () => {
  notificador.limpiar();
  const r = await residente();
  const body = { residenteId: r.id, categoriaPeso: 'MANO' };
  assert.equal((await recibir(body, 'clave-avisos-1')).status, 201);
  await esperar();
  assert.equal(notificador.obtenerEnviados().length, 1);
  const again = await recibir(body, 'clave-avisos-1');
  assert.equal(again.headers.get('idempotent-replayed'), 'true');
  await esperar();
  assert.equal(notificador.obtenerEnviados().length, 1);
});

test('residente sin correo: 0 correos y la recepción responde 201', { skip }, async () => {
  notificador.limpiar();
  const r = await residente({ email: '' });
  const res = await recibir({ residenteId: r.id, categoriaPeso: 'MANO' });
  assert.equal(res.status, 201);
  await esperar();
  assert.equal(notificador.obtenerEnviados().length, 0);
});

test('sin dueño: no se envía nada; al asignar: 1 correo al residente', { skip }, async () => {
  notificador.limpiar();
  const sin = await (await recibir({ etiquetaNombre: 'Ana P', categoriaPeso: 'ESTANDAR' })).json();
  await esperar();
  assert.equal(notificador.obtenerEnviados().length, 0);
  const r = await residente();
  const res = await api(`/api/packages/${sin.paquete.id}/asignar`, { method: 'PATCH', token: ctx.tOp, body: { residenteId: r.id } });
  assert.equal(res.status, 200);
  await esperar();
  const env = notificador.obtenerEnviados();
  assert.equal(env.length, 1);
  assert.equal(env[0].para, r.email);
});

test('checkin legado de una pre-alerta: 1 correo de llegada', { skip }, async () => {
  notificador.limpiar();
  const r = await residente();
  const pre = await enA(() => prisma.package.create({ data: { residenteId: r.id, proveedor: 'Amazon', pin: '4321', estado: 'PREALERTADO' } }));
  const res = await api(`/api/packages/${pre.id}/checkin`, { method: 'PATCH', token: ctx.tOp, body: { categoriaPeso: 'ESTANDAR' } });
  assert.equal(res.status, 200);
  await esperar();
  const env = notificador.obtenerEnviados();
  assert.equal(env.length, 1);
  assert.equal(env[0].para, r.email);
  assert.ok(env[0].html.includes('4321'), 'el correo lleva el PIN');
});

test('si el notificador lanza (síncrono o async), la recepción igual responde 201', { skip }, async () => {
  const roto = crearNotificadorFake();
  roto.avisarLlegada = () => { throw new Error('boom a@b.co'); };
  const rotoAsync = crearNotificadorFake();
  rotoAsync.avisarLlegada = async () => { throw new Error('boom async'); };
  const errores = [];
  const original = console.error;
  console.error = (...a) => errores.push(a.join(' '));
  try {
    for (const nt of [roto, rotoAsync]) {
      const app = createApp({ notificador: nt });
      const srv = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
      try {
        const r = await residente();
        const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/packages/recepcion`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${ctx.tOp}` },
          body: JSON.stringify({ residenteId: r.id, categoriaPeso: 'MANO' }),
        });
        assert.equal(res.status, 201);
        await esperar();
      } finally {
        await new Promise((resolve) => srv.close(resolve));
      }
    }
  } finally {
    console.error = original;
  }
  assert.ok(errores.length >= 2);
  assert.ok(errores.every((e) => !e.includes('@') && !e.includes('Ana')), 'el log no lleva datos personales');
});

test('teardown', { skip }, async () => {
  await new Promise((resolve) => server.close(resolve));
  await limpiar();
  await prisma.$disconnect();
});
