// Integración HTTP completa (KAN-8, Fase C — revisión punto 2).
// Levanta el app real con app.listen(0) y usa el fetch nativo de Node. Sin
// dependencias nuevas. Runner: node:test. Ejecutar: npm test (con Postgres local).
//
// Misma GUARDA de localhost que las demás integraciones: crea/borra datos, así
// que solo corre si DATABASE_URL apunta a localhost/127.0.0.1/::1.

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
  console.warn(`[http.integration] OMITIDA: ${razonSkip}`);
}
if (!omitir && !process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'itest-secret';
}

let prisma, runWithTenant, createApp;
let server, base;

const SLUG_A = 'itesth-a';
const SLUG_B = 'itesth-b';
const COD_A = 'itesth-cod-A';
const COD_B = 'itesth-cod-B';
const PWD = 'Password1';
const ctx = {};

async function crearConjunto(slug, codigo) {
  return prisma.conjunto.create({
    data: {
      nombre: `HTTP ${slug}`,
      slug,
      codigoInvitacion: codigo,
      operadorNombre: 'Op',
      operadorWhatsapp: '573000000000',
      operadorDomicilio: 'Dir',
      puntoRecepcion: 'Recepción',
    },
  });
}

async function limpiar() {
  const conjuntos = await prisma.conjunto.findMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } });
  for (const c of conjuntos) {
    await runWithTenant({ conjuntoId: c.id, role: 'OPERATOR' }, async () => {
      await prisma.package.deleteMany({});
      await prisma.user.deleteMany({});
    });
  }
  await prisma.conjunto.deleteMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } });
}

// Helpers HTTP sobre fetch nativo.
function api(path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

test('setup: levantar app en puerto efímero y sembrar datos', { skip: omitir && razonSkip }, async () => {
  ({ prisma } = await import('../db.js'));
  ({ runWithTenant } = await import('../tenantContext.js'));
  ({ createApp } = await import('../../app.js'));

  await limpiar();
  const A = await crearConjunto(SLUG_A, COD_A);
  const B = await crearConjunto(SLUG_B, COD_B);
  ctx.A = A.id;
  ctx.B = B.id;

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address();
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  // Operador de cada conjunto + un paquete de cada uno (sembrados directo en su
  // contexto; register solo crea RESIDENT).
  await runWithTenant({ conjuntoId: A.id, role: 'OPERATOR' }, async () => {
    const opA = await prisma.user.create({
      data: {
        email: 'opa@itesth.local', passwordHash: await bcryptHash(PWD),
        role: 'OPERATOR', nombre: 'OpA', telefono: '1', termsAcceptedAt: new Date(),
      },
    });
    const pA = await prisma.package.create({ data: { residenteId: opA.id, proveedor: 'PA', pin: '1111' } });
    ctx.opAId = opA.id;
    ctx.pA = pA.id;
  });
  await runWithTenant({ conjuntoId: B.id, role: 'OPERATOR' }, async () => {
    const opB = await prisma.user.create({
      data: {
        email: 'opb@itesth.local', passwordHash: await bcryptHash(PWD),
        role: 'OPERATOR', nombre: 'OpB', telefono: '1', termsAcceptedAt: new Date(),
      },
    });
    const pB = await prisma.package.create({ data: { residenteId: opB.id, proveedor: 'PB', pin: '2222' } });
    ctx.opBId = opB.id;
    ctx.pB = pB.id;
  });
});

// bcrypt sin importar en cabecera para no romper el skip sin BD.
async function bcryptHash(pwd) {
  const bcrypt = (await import('bcryptjs')).default;
  return bcrypt.hash(pwd, 10);
}

test('register -> login -> GET /packages/mine con el token (flujo completo)', { skip: omitir && razonSkip }, async () => {
  const r = await api('/api/auth/register', {
    method: 'POST',
    body: { email: 'res-a@itesth.local', password: PWD, nombre: 'ResA', telefono: '1', acceptedTerms: true, codigoInvitacion: COD_A },
  });
  assert.equal(r.status, 201);

  const l = await api('/api/auth/login', { method: 'POST', body: { email: 'res-a@itesth.local', password: PWD } });
  assert.equal(l.status, 200);
  const { token } = await l.json();
  assert.ok(token);

  const mine = await api('/api/packages/mine', { token });
  assert.equal(mine.status, 200);
  const paquetes = await mine.json();
  assert.ok(Array.isArray(paquetes)); // el residente nuevo aún no tiene paquetes
});

test('operador de A no ve por GET /packages los paquetes de B', { skip: omitir && razonSkip }, async () => {
  const l = await api('/api/auth/login', { method: 'POST', body: { email: 'opa@itesth.local', password: PWD } });
  const { token } = await l.json();

  const res = await api('/api/packages', { token });
  assert.equal(res.status, 200);
  const paquetes = await res.json();
  assert.ok(paquetes.every((p) => p.proveedor !== 'PB'), 'A no debe ver el paquete de B');
  // Ninguna respuesta de /packages incluye fotoUrl (patrón invariable).
  assert.ok(paquetes.every((p) => !('fotoUrl' in p)), '/packages nunca expone fotoUrl');
});

test('operador de A no ve por GET /packages/:id/foto un paquete de B (404)', { skip: omitir && razonSkip }, async () => {
  const l = await api('/api/auth/login', { method: 'POST', body: { email: 'opa@itesth.local', password: PWD } });
  const { token } = await l.json();

  // El paquete pB es de B: para el operador de A, la extensión lo filtra y
  // findUnique devuelve null -> 404.
  const res = await api(`/api/packages/${ctx.pB}/foto`, { token });
  assert.equal(res.status, 404);

  // Control positivo: su propio paquete (pA) sí responde 200.
  const propio = await api(`/api/packages/${ctx.pA}/foto`, { token });
  assert.equal(propio.status, 200);
});

test('request SIN token a ruta protegida -> 401', { skip: omitir && razonSkip }, async () => {
  const res = await api('/api/packages');
  assert.equal(res.status, 401);
  const mine = await api('/api/packages/mine');
  assert.equal(mine.status, 401);
});

test('teardown: cerrar server y limpiar', { skip: omitir && razonSkip }, async () => {
  await limpiar();
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
});
