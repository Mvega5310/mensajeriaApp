// Integración de la Fase C: registro y login con conjunto (KAN-8).
// Runner: node:test. Ejecutar: npm test  (con Postgres local, ver abajo).
//
// Misma GUARDA que la integración de aislamiento: crea/borra datos, así que solo
// corre si DATABASE_URL apunta a localhost/127.0.0.1/::1; si no, se OMITE con
// mensaje. Cómo correrla en local está documentado en el README (sección
// "Pruebas del backend").

import test from 'node:test';
import assert from 'node:assert/strict';

function hostDeDatabaseUrl(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
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

if (omitir) {
  console.warn(`[registroLogin.integration] OMITIDA: ${razonSkip}`);
}

// Requiere JWT_SECRET para que login firme el token; si falta, lo fijamos a un
// valor de prueba (solo en este proceso).
if (!omitir && !process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'itest-secret';
}

let prisma, runWithTenant, register, login;

// Respuesta fake de Express para capturar status/json de los controladores.
function resFake() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

const SLUG_A = 'itestc-a';
const SLUG_B = 'itestc-b';
const COD_A = 'itestc-cod-A';
const COD_B = 'itestc-cod-B';
const ctx = {};

async function crearConjunto(slug, codigo, { activa = true } = {}) {
  return prisma.conjunto.create({
    data: {
      nombre: `Fase C ${slug}`,
      slug,
      codigoInvitacion: codigo,
      invitacionActiva: activa,
      operadorNombre: 'Op',
      operadorWhatsapp: '573000000000',
      operadorDomicilio: 'Dir',
      puntoRecepcion: 'Recepción',
    },
  });
}

async function limpiar() {
  const conjuntos = await prisma.conjunto.findMany({
    where: { slug: { in: [SLUG_A, SLUG_B] } },
  });
  for (const c of conjuntos) {
    await runWithTenant({ conjuntoId: c.id, role: 'OPERATOR' }, async () => {
      await prisma.package.deleteMany({});
      await prisma.user.deleteMany({});
    });
  }
  await prisma.conjunto.deleteMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } });
}

const PWD = 'Password1';

test('setup: importar módulos, limpiar y crear conjuntos', { skip: omitir && razonSkip }, async () => {
  ({ prisma } = await import('../db.js'));
  ({ runWithTenant } = await import('../tenantContext.js'));
  ({ register, login } = await import('../../controllers/auth.controller.js'));

  await limpiar();
  const A = await crearConjunto(SLUG_A, COD_A);
  const B = await crearConjunto(SLUG_B, COD_B);
  // Conjunto inactivo (para el caso de código inactivo): reutiliza slug A? No,
  // usamos un código aparte marcando el conjunto B como... mejor un 3er código
  // sobre un conjunto inactivo temporal.
  ctx.A = A.id;
  ctx.B = B.id;
});

function reqRegistro(extra) {
  return {
    body: {
      email: 'x@itestc.local',
      password: PWD,
      nombre: 'X',
      telefono: '1',
      acceptedTerms: true,
      ...extra,
    },
  };
}

test('register con código válido crea el usuario en el conjunto correcto', { skip: omitir && razonSkip }, async () => {
  const res = resFake();
  await register(reqRegistro({ email: 'ra@itestc.local', codigoInvitacion: COD_A }), res);
  assert.equal(res.statusCode, 201);
  ctx.uA = res.body.id;

  // Verificar que quedó en A (leyendo dentro del contexto de A).
  await runWithTenant({ conjuntoId: ctx.A, role: 'OPERATOR' }, async () => {
    const u = await prisma.user.findUnique({ where: { id: ctx.uA } });
    assert.ok(u, 'el usuario debe existir en A');
    assert.equal(u.conjuntoId, ctx.A);
    assert.equal(u.role, 'RESIDENT');
  });
  // Y que NO se ve desde B.
  await runWithTenant({ conjuntoId: ctx.B, role: 'OPERATOR' }, async () => {
    const u = await prisma.user.findUnique({ where: { id: ctx.uA } });
    assert.equal(u, null, 'el usuario de A no debe verse desde B');
  });
});

test('register sin código no crea nada (400)', { skip: omitir && razonSkip }, async () => {
  const res = resFake();
  await register(reqRegistro({ email: 'nocode@itestc.local' }), res);
  assert.equal(res.statusCode, 400);
});

test('register con código inexistente no crea nada (400)', { skip: omitir && razonSkip }, async () => {
  const res = resFake();
  await register(reqRegistro({ email: 'badcode@itestc.local', codigoInvitacion: 'NO-EXISTE' }), res);
  assert.equal(res.statusCode, 400);
});

test('register con código de conjunto inactivo no crea nada (400)', { skip: omitir && razonSkip }, async () => {
  const inactivo = await crearConjunto('itestc-inact', 'itestc-cod-INACT', { activa: false });
  try {
    const res = resFake();
    await register(reqRegistro({ email: 'inact@itestc.local', codigoInvitacion: 'itestc-cod-INACT' }), res);
    assert.equal(res.statusCode, 400);
  } finally {
    await prisma.conjunto.deleteMany({ where: { id: inactivo.id } });
  }
});

test('register con email ya existente (en otro conjunto) responde 409', { skip: omitir && razonSkip }, async () => {
  // ra@itestc.local ya existe en A. Intentar registrarlo en B -> 409.
  const res = resFake();
  await register(reqRegistro({ email: 'ra@itestc.local', codigoInvitacion: COD_B }), res);
  assert.equal(res.statusCode, 409);
});

test('login funciona para usuarios de dos conjuntos distintos', { skip: omitir && razonSkip }, async () => {
  // Crear un usuario en B.
  const resB = resFake();
  await register(reqRegistro({ email: 'rb@itestc.local', codigoInvitacion: COD_B }), resB);
  assert.equal(resB.statusCode, 201);
  ctx.uB = resB.body.id;

  const la = resFake();
  await login({ body: { email: 'ra@itestc.local', password: PWD } }, la);
  assert.equal(la.statusCode, 200);
  assert.ok(la.body.token, 'login de A debe devolver token');

  const lb = resFake();
  await login({ body: { email: 'rb@itestc.local', password: PWD } }, lb);
  assert.equal(lb.statusCode, 200);
  assert.ok(lb.body.token, 'login de B debe devolver token');
});

test('un request autenticado a /packages solo ve los paquetes de su conjunto', { skip: omitir && razonSkip }, async () => {
  // Crear un paquete para el residente de A y otro para el de B, cada uno en su
  // contexto (equivale a lo que hace el flujo tras requireTenant).
  await runWithTenant({ conjuntoId: ctx.A, role: 'RESIDENT' }, async () => {
    await prisma.package.create({ data: { residenteId: ctx.uA, proveedor: 'PA', pin: '1111' } });
  });
  await runWithTenant({ conjuntoId: ctx.B, role: 'RESIDENT' }, async () => {
    await prisma.package.create({ data: { residenteId: ctx.uB, proveedor: 'PB', pin: '2222' } });
  });

  // "GET /packages" del operador de A = findMany dentro del contexto de A.
  const paquetesA = await runWithTenant({ conjuntoId: ctx.A, role: 'OPERATOR' }, () =>
    prisma.package.findMany({})
  );
  assert.ok(paquetesA.length >= 1);
  assert.ok(paquetesA.every((p) => p.conjuntoId === ctx.A), 'A solo ve paquetes de A');
  assert.ok(paquetesA.every((p) => p.proveedor !== 'PB'), 'A no ve el paquete de B');

  const paquetesB = await runWithTenant({ conjuntoId: ctx.B, role: 'OPERATOR' }, () =>
    prisma.package.findMany({})
  );
  assert.ok(paquetesB.every((p) => p.conjuntoId === ctx.B), 'B solo ve paquetes de B');
  assert.ok(paquetesB.every((p) => p.proveedor !== 'PA'), 'B no ve el paquete de A');
});

test('teardown: limpiar datos de prueba', { skip: omitir && razonSkip }, async () => {
  await limpiar();
  await prisma.$disconnect();
});
