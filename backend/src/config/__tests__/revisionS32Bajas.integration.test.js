// Integración de las BAJAS de la revisión S3.2 contra Postgres real: registro endurecido,
// config-publica (slug + límite por IP), slug válido + código inválido, y /bonos/mine y
// /comments/mine de todos los conjuntos. (C5, lote y spam: revisionS32.integration.test.js.)
// Mismo patrón de skip/guarda de localhost que las demás de integración.

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
if (omitir) console.warn(`[revisionS32Bajas.integration] OMITIDA: ${razonSkip}`);
if (!omitir && !process.env.JWT_SECRET) process.env.JWT_SECRET = 'itest-secret';
const skip = omitir && razonSkip;

let prisma, runWithTenant, createApp, crearLimitadorMemoria, crearNotificadorFake, server, base, notificador;
const S = { A: 'its32b-a', B: 'its32b-b' };
const SLUGS = Object.values(S);
const PWD = 'Password1';
const ctx = {};
const en = (id, fn) => runWithTenant({ conjuntoId: id, role: 'OPERATOR' }, fn);

async function limpiar() {
  const conjuntos = await prisma.conjunto.findMany({ where: { slug: { in: SLUGS } } });
  for (const c of conjuntos) {
    await purgarEventos(prisma, c.id);
    await runWithTenant({ conjuntoId: c.id, role: 'OPERATOR' }, async () => {
      await prisma.bono.deleteMany({});
      await prisma.comentario.deleteMany({});
      await prisma.package.deleteMany({});
      await prisma.domicilioEvento.deleteMany({});
      await prisma.domicilio.deleteMany({});
    });
    await prisma.usuarioConjunto.deleteMany({ where: { conjuntoId: c.id } });
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: '@its32b.local' } } });
  await prisma.conjunto.deleteMany({ where: { slug: { in: SLUGS } } });
}

function api(path, { method = 'GET', token, body, url = base } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${url}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const json = async (p) => (await p).json();
const login = async (email) => (await json(api('/api/auth/login', { method: 'POST', body: { email, password: PWD } }))).token;
const registrar = async (body) => {
  const r = await api('/api/auth/register', { method: 'POST', body: { password: PWD, telefono: '3001112233', acceptedTerms: true, ...body } });
  assert.equal(r.status, 201, JSON.stringify(await r.clone().json()));
  return (await r.json()).id;
};
const buscar = async (token, q, extra = '') => json(api(`/api/residentes/buscar?q=${encodeURIComponent(q)}${extra}`, { token }));
const domiciliosDe = async (token) => json(api('/api/domicilios', { token }));
// Paquete en portería directo en la base (con PIN conocido), a un Domicilio.
const paquete = (conjuntoId, usuarioId, domicilioId, pin, extra = {}) => en(conjuntoId, () => prisma.package.create({
  data: { residenteId: usuarioId, domicilioId, proveedor: 'X', estado: 'EN_RECEPCION', categoriaPeso: 'ESTANDAR', costoServicio: 4500, pin, ...extra },
}));

test('setup: dos conjuntos, operadores y personas', { skip }, async () => {
  ({ prisma } = await import('../db.js'));
  ({ runWithTenant } = await import('../tenantContext.js'));
  ({ createApp } = await import('../../app.js'));
  ({ crearLimitadorMemoria } = await import('../../domain/limitador.js'));
  ({ crearNotificadorFake } = await import('../../services/notificador/index.js'));
  const { crearOperador } = await import('../../services/usuario.service.js');
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(PWD, 4);
  await limpiar();
  const mk = async (k) => (await prisma.conjunto.create({
    data: {
      nombre: `Conjunto ${k}`, slug: S[k], codigoInvitacion: `${S[k]}-COD`, operadorNombre: `Op ${k}`,
      operadorWhatsapp: '573000000000', operadorDomicilio: 'Dir', puntoRecepcion: 'Recepción', bonosHabilitados: true,
    },
  })).id;
  ctx.A = await mk('A');
  ctx.B = await mk('B');
  await crearOperador({ conjuntoId: ctx.A, email: 'opa@its32b.local', passwordHash: hash, nombre: 'Operador', telefono: '3000000000' });
  await crearOperador({ conjuntoId: ctx.B, email: 'opb@its32b.local', passwordHash: hash, nombre: 'Operador', telefono: '3000000000' });
  notificador = crearNotificadorFake();
  const app = createApp({ notificador, limitadorConjuntos: crearLimitadorMemoria({ max: 1000, ventanaMs: 60_000 }) });
  await new Promise((resolve) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  ctx.tOpA = await login('opa@its32b.local');
  ctx.tOpB = await login('opb@its32b.local');
});

test('setup de personas', { skip }, async () => {
  ctx.carla = await registrar({ email: 'carla@its32b.local', nombre: 'Carla Soto', conjunto: S.A, torre: 'T3', apto: '202' });
  ctx.tCarla = await login('carla@its32b.local');
});

test('baja: el registro valida tipos y largos (nada de 500) y exige el apartamento', { skip }, async () => {
  const intento = (extra, n) => api('/api/auth/register', {
    method: 'POST',
    body: { email: `r${n}@its32b.local`, password: PWD, nombre: 'Z', telefono: '3001112233', acceptedTerms: true, conjunto: S.A, ...extra },
  });
  assert.equal((await intento({ torre: 'x'.repeat(5000), apto: '9'.repeat(5000) }, 1)).status, 400);
  assert.equal((await intento({ torre: 'T1' }, 2)).status, 400, 'sin apartamento');
  const sinApto = await intento({}, 3);
  assert.equal(sinApto.status, 400);
  assert.equal((await sinApto.json()).code, 'DATOS_INVALIDOS');
  assert.equal((await intento({ torre: { a: 1 }, apto: '1' }, 4)).status, 400);
  assert.equal((await intento({ nombre: { a: 1 }, torre: 'T1', apto: '1' }, 5)).status, 400);
  assert.equal((await intento({ telefono: 3001112233, torre: 'T1', apto: '1' }, 6)).status, 400);
  // torre y apto numéricos (JSON con números): 201 y quedan guardados como texto.
  const num = await intento({ torre: 123, apto: 304 }, 7);
  assert.equal(num.status, 201);
  const t = await login('r7@its32b.local');
  const d = (await domiciliosDe(t))[0];
  assert.equal(d.apto, '304');
  assert.equal(d.torre, '123');
});


test('baja: config-publica devuelve el slug y tiene límite por IP', { skip }, async () => {
  const r = await api('/api/conjuntos/config-publica?c=its32b-a-COD');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).slug, S.A);
  const app = createApp({ notificador, limitadorConjuntos: crearLimitadorMemoria({ max: 2, ventanaMs: 60_000 }) });
  const srv = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    const url = `http://127.0.0.1:${srv.address().port}/api/conjuntos/config-publica?conjunto=${S.A}`;
    assert.equal((await fetch(url)).status, 200);
    assert.equal((await fetch(url)).status, 200);
    const tercera = await fetch(url);
    assert.equal(tercera.status, 429);
    assert.ok(tercera.headers.get('retry-after'));
  } finally {
    await new Promise((resolve) => srv.close(resolve));
  }
});


test('registro: con un slug válido un código inválido NO frena (gana el slug); slug A + código VÁLIDO de B sigue siendo 400', { skip }, async () => {
  const cuerpo = (n, extra) => ({
    email: `cod${n}@its32b.local`, password: PWD, nombre: 'Cod', telefono: '3001112233', acceptedTerms: true, torre: 'T1', apto: '7', ...extra,
  });
  const ok = await api('/api/auth/register', { method: 'POST', body: cuerpo(1, { conjunto: S.A, codigoInvitacion: 'codigo-que-no-existe' }) });
  assert.equal(ok.status, 201);
  const d = (await domiciliosDe(await login('cod1@its32b.local')))[0];
  assert.equal(d.conjunto.slug, S.A);
  const cfg = await api(`/api/conjuntos/config-publica?conjunto=${S.A}&c=codigo-que-no-existe`);
  assert.equal(cfg.status, 200);
  // Código válido de OTRO conjunto: sigue siendo 400.
  const mala = await api('/api/auth/register', { method: 'POST', body: cuerpo(2, { conjunto: S.A, codigoInvitacion: 'its32b-b-COD' }) });
  assert.equal(mala.status, 400);
  assert.equal((await mala.json()).code, 'CONJUNTO_INVALIDO');
  // Sin slug, un código inválido sí es error (no hay con qué identificar el conjunto).
  const sinSlug = await api('/api/auth/register', { method: 'POST', body: cuerpo(3, { codigoInvitacion: 'codigo-que-no-existe' }) });
  assert.equal(sinSlug.status, 400);
  assert.equal((await sinSlug.json()).code, 'INVITACION_INVALIDA');
});


test('baja: /bonos/mine y /comments/mine juntan todos los conjuntos de la persona (o uno con ?conjunto=)', { skip }, async () => {
  // Carla ya tiene domicilio en A; agrega B.
  assert.equal((await api('/api/domicilios', { method: 'POST', token: ctx.tCarla, body: { conjunto: S.B, torre: 'T9', apto: '909' } })).status, 201);
  for (const t of [ctx.tOpA, ctx.tOpB]) {
    const r = await api('/api/bonos', { method: 'POST', token: t, body: { residenteId: ctx.carla, categoriaPeso: 'ESTANDAR', cantidad: 3, precioPagado: 10000 } });
    assert.equal(r.status, 201);
  }
  const todos = await json(api('/api/bonos/mine', { token: ctx.tCarla }));
  assert.deepEqual(todos.map((b) => b.conjunto.slug).sort(), [S.A, S.B]);
  const soloB = await json(api(`/api/bonos/mine?conjunto=${S.B}`, { token: ctx.tCarla }));
  assert.equal(soloB.length, 1);
  assert.equal((await api(`/api/bonos/mine?conjunto=${S.B}x`, { token: ctx.tCarla })).status, 400);

  for (const c of [S.A, S.B]) {
    assert.equal((await api('/api/comments', { method: 'POST', token: ctx.tCarla, body: { mensaje: `hola ${c}`, conjunto: c } })).status, 201);
  }
  const mios = await json(api('/api/comments/mine', { token: ctx.tCarla }));
  assert.deepEqual(mios.map((m) => m.conjunto.slug).sort(), [S.A, S.B]);
  const unoSolo = await json(api(`/api/comments/mine?conjunto=${S.A}`, { token: ctx.tCarla }));
  assert.equal(unoSolo.length, 1);
  assert.equal(unoSolo[0].mensaje, `hola ${S.A}`);
});

test('teardown', { skip }, async () => {
  await new Promise((resolve) => server.close(resolve));
  await limpiar();
});
