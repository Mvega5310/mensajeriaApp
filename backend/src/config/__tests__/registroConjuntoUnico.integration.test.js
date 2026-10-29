// Integración del registro sin código cuando existe UN SOLO conjunto (hotfix
// tras el corte KAN-8). Levanta el app real (app.listen(0)) + fetch nativo.
// Misma GUARDA de localhost que las demás integraciones.
//
// Depende del estado GLOBAL de la base: el comportamiento cambia según cuántos
// conjuntos existen en total, así que exige empezar con 0 conjuntos (por eso la
// suite corre en serie y cada archivo limpia lo suyo). Si no, falla con un
// mensaje claro en vez de borrar datos ajenos.

import test from 'node:test';
import assert from 'node:assert/strict';

function hostDeDatabaseUrl(url) {
  if (!url) return null;
  try { return new URL(url).hostname; } catch { return null; }
}
const dbUrl = process.env.DATABASE_URL;
const dbHost = hostDeDatabaseUrl(dbUrl);
const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1', '::1']);
const esLocal = !!dbHost && HOSTS_LOCALES.has(dbHost);
const razonSkip = !dbUrl
  ? 'DATABASE_URL no definida'
  : !esLocal
    ? `DATABASE_URL apunta a un host NO local (${dbHost}); esta prueba crea/borra datos y solo corre contra localhost/127.0.0.1`
    : null;
const omitir = razonSkip !== null;
if (omitir) console.warn(`[registroConjuntoUnico.integration] OMITIDA: ${razonSkip}`);
if (!omitir && !process.env.JWT_SECRET) process.env.JWT_SECRET = 'itest-secret';

let prisma, runWithTenant, createApp;
let server, base;

const SLUG_U = 'itestu-unico';
const SLUG_V = 'itestu-otro';
const COD_U = 'itestu-cod-U';
const COD_V = 'itestu-cod-V';
const PWD = 'Password1';
const ctx = {};

async function crearConjunto(slug, codigo) {
  return prisma.conjunto.create({
    data: {
      nombre: `Unico ${slug}`, slug, codigoInvitacion: codigo,
      operadorNombre: `Op ${slug}`, operadorWhatsapp: '573000000000',
      operadorDomicilio: 'Dir', puntoRecepcion: 'Recepción',
    },
  });
}

async function limpiar() {
  const conjuntos = await prisma.conjunto.findMany({ where: { slug: { in: [SLUG_U, SLUG_V] } } });
  for (const c of conjuntos) {
    await runWithTenant({ conjuntoId: c.id, role: 'OPERATOR' }, async () => {
      await prisma.domicilio.deleteMany({});
      await prisma.user.deleteMany({ where: { conjuntoId: c.id } });
    });
  }
  await prisma.conjunto.deleteMany({ where: { slug: { in: [SLUG_U, SLUG_V] } } });
}

async function usuariosEn(conjuntoId) {
  return runWithTenant({ conjuntoId, role: 'OPERATOR' }, () => prisma.user.count());
}

function api(path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}

function cuerpoRegistro(email, extra = {}) {
  return {
    email, password: PWD, nombre: 'Residente Unico', telefono: '3000000000',
    torre: 'Torre 1', apto: '101', acceptedTerms: true, ...extra,
  };
}

// Los 5 presentacionales + `slug` (S3.2: para preseleccionar el conjunto con un ?c= antiguo).
const CAMPOS_PUBLICOS = ['nombre', 'operadorDomicilio', 'operadorNombre', 'operadorWhatsapp', 'puntoRecepcion', 'slug'];

test('setup: exactamente 1 conjunto en toda la base', { skip: omitir && razonSkip }, async () => {
  ({ prisma } = await import('../db.js'));
  ({ runWithTenant } = await import('../tenantContext.js'));
  ({ createApp } = await import('../../app.js'));

  await limpiar();
  const previos = await prisma.conjunto.count();
  assert.equal(previos, 0, `Esta prueba necesita empezar sin conjuntos y hay ${previos}: otra prueba no limpió (¿corriste npm test en serie?)`);
  ctx.U = (await crearConjunto(SLUG_U, COD_U)).id;

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
});

test('1 conjunto: registro SIN código -> 201 y el usuario queda en ese conjunto', { skip: omitir && razonSkip }, async () => {
  const res = await api('/api/auth/register', { method: 'POST', body: cuerpoRegistro('sin-codigo@itestu.local') });
  assert.equal(res.status, 201);
  const login = await api('/api/auth/login', { method: 'POST', body: { email: 'sin-codigo@itestu.local', password: PWD } });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  const me = await (await api('/api/auth/me', { token })).json();
  assert.equal(me.conjuntoId, ctx.U);
  assert.equal(me.role, 'RESIDENT');
});

test('1 conjunto: código válido -> 201; código inexistente -> 400 sin crear nada', { skip: omitir && razonSkip }, async () => {
  const ok = await api('/api/auth/register', { method: 'POST', body: cuerpoRegistro('con-codigo@itestu.local', { codigoInvitacion: COD_U }) });
  assert.equal(ok.status, 201);
  const antes = await usuariosEn(ctx.U);
  const malo = await api('/api/auth/register', { method: 'POST', body: cuerpoRegistro('codigo-malo@itestu.local', { codigoInvitacion: 'itestu-cod-NOEXISTE' }) });
  assert.equal(malo.status, 400);
  assert.equal((await malo.json()).code, 'INVITACION_INVALIDA');
  assert.equal(await usuariosEn(ctx.U), antes);
});

test('1 conjunto: config-publica sin código -> 200 con solo los campos públicos', { skip: omitir && razonSkip }, async () => {
  const res = await api('/api/conjuntos/config-publica');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), CAMPOS_PUBLICOS);
  assert.equal(body.nombre, `Unico ${SLUG_U}`);
});

test('1 conjunto con la invitación inactiva: sin código -> 400 en registro y config-publica', { skip: omitir && razonSkip }, async () => {
  await prisma.conjunto.update({ where: { id: ctx.U }, data: { invitacionActiva: false } });
  try {
    const antes = await usuariosEn(ctx.U);
    const reg = await api('/api/auth/register', { method: 'POST', body: cuerpoRegistro('inactivo@itestu.local') });
    assert.equal(reg.status, 400);
    assert.equal((await reg.json()).code, 'INVITACION_INVALIDA');
    assert.equal(await usuariosEn(ctx.U), antes);
    const cfg = await api('/api/conjuntos/config-publica');
    assert.equal(cfg.status, 400);
  } finally {
    await prisma.conjunto.update({ where: { id: ctx.U }, data: { invitacionActiva: true } });
  }
});

test('2 conjuntos: registro SIN código ni conjunto -> 400 CONJUNTO_REQUERIDO y no crea nada', { skip: omitir && razonSkip }, async () => {
  ctx.V = (await crearConjunto(SLUG_V, COD_V)).id;
  const antesU = await usuariosEn(ctx.U);
  const antesV = await usuariosEn(ctx.V);
  const res = await api('/api/auth/register', { method: 'POST', body: cuerpoRegistro('dos-conjuntos@itestu.local') });
  assert.equal(res.status, 400);
  const cuerpo = await res.json();
  assert.equal(cuerpo.code, 'CONJUNTO_REQUERIDO');
  assert.match(cuerpo.message, /conjunto/i);
  assert.equal(await usuariosEn(ctx.U), antesU);
  assert.equal(await usuariosEn(ctx.V), antesV);
});

test('2 conjuntos: config-publica sin código ni conjunto -> 400; con código o con slug funciona', { skip: omitir && razonSkip }, async () => {
  const sin = await api('/api/conjuntos/config-publica');
  assert.equal(sin.status, 400);
  const cuerpoSin = await sin.json();
  assert.equal(cuerpoSin.code, 'CONJUNTO_REQUERIDO');
  assert.equal(typeof cuerpoSin.message, 'string'); // formato de error del refactor: { code, message }
  assert.equal(cuerpoSin.error, undefined);
  const con = await api(`/api/conjuntos/config-publica?c=${COD_V}`);
  assert.equal(con.status, 200);
  assert.equal((await con.json()).nombre, `Unico ${SLUG_V}`);
  const porSlug = await api(`/api/conjuntos/config-publica?conjunto=${SLUG_V}`);
  assert.equal(porSlug.status, 200);
  assert.equal((await porSlug.json()).nombre, `Unico ${SLUG_V}`);
  const malo = await api('/api/conjuntos/config-publica?conjunto=no-existe');
  assert.equal(malo.status, 400);
  assert.equal((await malo.json()).code, 'CONJUNTO_INVALIDO');
});

test('2 conjuntos: el código decide el conjunto (V), no el "único"', { skip: omitir && razonSkip }, async () => {
  const res = await api('/api/auth/register', { method: 'POST', body: cuerpoRegistro('en-v@itestu.local', { codigoInvitacion: COD_V }) });
  assert.equal(res.status, 201);
  const { token } = await (await api('/api/auth/login', { method: 'POST', body: { email: 'en-v@itestu.local', password: PWD } })).json();
  const me = await (await api('/api/auth/me', { token })).json();
  assert.equal(me.conjuntoId, ctx.V);
});

test('teardown', { skip: omitir && razonSkip }, async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await limpiar();
  await prisma.$disconnect();
});
