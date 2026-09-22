// Integración de configuración por conjunto (KAN-8, Fase D — D7).
// Levanta el app real (app.listen(0)) + fetch nativo para los endpoints, y usa
// los servicios/controladores bajo contexto para tarifas y bonos.
// Misma GUARDA de localhost que las demás integraciones.

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
if (omitir) console.warn(`[configConjunto.integration] OMITIDA: ${razonSkip}`);
if (!omitir && !process.env.JWT_SECRET) process.env.JWT_SECRET = 'itest-secret';

let prisma, runWithTenant, createApp, costoPara, crearBono;
let server, base;

const SLUG_A = 'itestd-a';
const SLUG_B = 'itestd-b';
const COD_A = 'itestd-cod-A';
const COD_B = 'itestd-cod-B';
const PWD = 'Password1';
const ctx = {};

async function bcryptHash(pwd) {
  const bcrypt = (await import('bcryptjs')).default;
  return bcrypt.hash(pwd, 10);
}

// Conjunto A: tarifa ESTANDAR 4500, bonos OFF. Conjunto B: ESTANDAR 9999, bonos ON.
async function crearConjunto(slug, codigo, extra) {
  return prisma.conjunto.create({
    data: {
      nombre: `Config ${slug}`, slug, codigoInvitacion: codigo,
      operadorNombre: `Op ${slug}`, operadorWhatsapp: '573000000000',
      operadorDomicilio: 'Dir', puntoRecepcion: 'Recepción',
      ...extra,
    },
  });
}

async function limpiar() {
  const conjuntos = await prisma.conjunto.findMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } });
  for (const c of conjuntos) {
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

test('setup', { skip: omitir && razonSkip }, async () => {
  ({ prisma } = await import('../db.js'));
  ({ runWithTenant } = await import('../tenantContext.js'));
  ({ createApp } = await import('../../app.js'));
  ({ costoPara } = await import('../../services/tariff.service.js'));
  ({ create: crearBono } = await import('../../controllers/bonos.controller.js'));

  await limpiar();
  const A = await crearConjunto(SLUG_A, COD_A, { tarifaEstandar: 4500, bonosHabilitados: false });
  const B = await crearConjunto(SLUG_B, COD_B, { tarifaEstandar: 9999, bonosHabilitados: true });
  ctx.A = A.id;
  ctx.B = B.id;

  // Un operador en cada conjunto (para login y /conjunto/config).
  await runWithTenant({ conjuntoId: A.id, role: 'OPERATOR' }, async () => {
    await prisma.user.create({ data: { email: 'opa@itestd.local', passwordHash: await bcryptHash(PWD), role: 'OPERATOR', nombre: 'OpA', telefono: '1', termsAcceptedAt: new Date() } });
  });
  await runWithTenant({ conjuntoId: B.id, role: 'OPERATOR' }, async () => {
    const r = await prisma.user.create({ data: { email: 'resb@itestd.local', passwordHash: await bcryptHash(PWD), role: 'RESIDENT', nombre: 'ResB', telefono: '1', termsAcceptedAt: new Date() } });
    ctx.resB = r.id;
  });

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
});

// --- config-publica ---

test('config-publica con código válido devuelve solo presentacionales', { skip: omitir && razonSkip }, async () => {
  const res = await api(`/api/conjuntos/config-publica?c=${COD_A}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.nombre, 'Config itestd-a');
  assert.ok('operadorWhatsapp' in body && 'operadorDomicilio' in body);
  // No expone tarifas ni flags ni código.
  assert.ok(!('tarifas' in body) && !('bonosHabilitados' in body) && !('codigoInvitacion' in body));
});

test('config-publica con código inexistente -> 400 INVITACION_INVALIDA', { skip: omitir && razonSkip }, async () => {
  const res = await api('/api/conjuntos/config-publica?c=NO-EXISTE');
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'INVITACION_INVALIDA');
});

test('config-publica con conjunto inactivo -> 400 INVITACION_INVALIDA', { skip: omitir && razonSkip }, async () => {
  const inact = await crearConjunto('itestd-inact', 'itestd-cod-INACT', { invitacionActiva: false });
  try {
    const res = await api('/api/conjuntos/config-publica?c=itestd-cod-INACT');
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, 'INVITACION_INVALIDA');
  } finally {
    await prisma.conjunto.deleteMany({ where: { id: inact.id } });
  }
});

// --- /conjunto/config según rol ---

test('/conjunto/config: OPERATOR recibe tarifas, bonos y codigoInvitacion', { skip: omitir && razonSkip }, async () => {
  const l = await api('/api/auth/login', { method: 'POST', body: { email: 'opa@itestd.local', password: PWD } });
  const { token } = await l.json();
  const res = await api('/api/conjunto/config', { token });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.tarifas.ESTANDAR, 4500);
  assert.equal(body.bonosHabilitados, false);
  assert.equal(body.codigoInvitacion, COD_A); // solo operador
});

test('/conjunto/config: RESIDENT NO recibe codigoInvitacion', { skip: omitir && razonSkip }, async () => {
  const l = await api('/api/auth/login', { method: 'POST', body: { email: 'resb@itestd.local', password: PWD } });
  const { token } = await l.json();
  const res = await api('/api/conjunto/config', { token });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.tarifas.ESTANDAR, 9999);
  assert.equal(body.bonosHabilitados, true);
  assert.ok(!('codigoInvitacion' in body), 'el residente no debe recibir codigoInvitacion');
});

// --- tarifas distintas cobran distinto (costoPara bajo contexto) ---

test('dos conjuntos con tarifas distintas: costoPara devuelve distinto', { skip: omitir && razonSkip }, async () => {
  const costoA = await runWithTenant({ conjuntoId: ctx.A, role: 'OPERATOR' }, () => costoPara('ESTANDAR'));
  const costoB = await runWithTenant({ conjuntoId: ctx.B, role: 'OPERATOR' }, () => costoPara('ESTANDAR'));
  assert.equal(costoA, 4500);
  assert.equal(costoB, 9999);
});

// --- bonosHabilitados=false bloquea el uso de bonos ---

test('bonosHabilitados=false (conjunto A) bloquea create de bono con 403', { skip: omitir && razonSkip }, async () => {
  // res fake mínimo
  const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; } };
  await runWithTenant({ conjuntoId: ctx.A, role: 'OPERATOR' }, () =>
    crearBono({ body: { residenteId: 'x', categoriaPeso: 'ESTANDAR', cantidad: 3, precioPagado: 1000 } }, res)
  );
  assert.equal(res.statusCode, 403);
});

test('teardown', { skip: omitir && razonSkip }, async () => {
  await limpiar();
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
});
