// Integración de la Fase E (KAN-8): demuestra el aislamiento en los flujos de
// negocio contra DOS conjuntos. Levanta el app real (app.listen(0)) + fetch
// nativo para lo HTTP, y usa controladores/servicios bajo contexto donde aplica.
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
if (omitir) console.warn(`[faseE.integration] OMITIDA: ${razonSkip}`);
if (!omitir && !process.env.JWT_SECRET) process.env.JWT_SECRET = 'itest-secret';

let prisma, runWithTenant, createApp;
let server, base;

const SLUG_A = 'iteste-alfa';
const SLUG_B = 'iteste-beta';
const COD_A = 'iteste-cod-ALFA';
const COD_B = 'iteste-cod-BETA';
const PWD = 'Password1';
const ctx = {};

async function bcryptHash(pwd) {
  return (await import('bcryptjs')).default.hash(pwd, 10);
}

async function crearConjunto(slug, codigo, extra) {
  return prisma.conjunto.create({
    data: {
      nombre: `E ${slug}`, slug, codigoInvitacion: codigo,
      operadorNombre: `Op ${slug}`, operadorWhatsapp: '573000000000',
      operadorDomicilio: 'Dir', puntoRecepcion: 'Recepción', ...extra,
    },
  });
}

// Crea un usuario dentro del contexto del conjunto (rol/torre/apto opcionales).
async function crearUsuario(conjuntoId, { email, role = 'RESIDENT', torre = null, apto = null }) {
  return runWithTenant({ conjuntoId, role: 'OPERATOR' }, () =>
    prisma.user.create({
      data: { email, passwordHash: 'x', role, nombre: email, telefono: '1', torre, apto, termsAcceptedAt: new Date() },
    })
  );
}

async function limpiar() {
  const conjuntos = await prisma.conjunto.findMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } });
  for (const c of conjuntos) {
    await runWithTenant({ conjuntoId: c.id, role: 'OPERATOR' }, async () => {
      await prisma.bono.deleteMany({});
      await prisma.comentario.deleteMany({});
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

test('setup', { skip: omitir && razonSkip }, async () => {
  ({ prisma } = await import('../db.js'));
  ({ runWithTenant } = await import('../tenantContext.js'));
  ({ createApp } = await import('../../app.js'));

  await limpiar();
  const A = await crearConjunto(SLUG_A, COD_A, { bonosHabilitados: false });
  const B = await crearConjunto(SLUG_B, COD_B, { bonosHabilitados: true });
  ctx.A = A.id;
  ctx.B = B.id;

  // Operadores con hash real (para login), cada uno en su conjunto.
  await runWithTenant({ conjuntoId: A.id, role: 'OPERATOR' }, async () => {
    await prisma.user.create({ data: { email: 'opa@e.local', passwordHash: await bcryptHash(PWD), role: 'OPERATOR', nombre: 'OpA', telefono: '1', termsAcceptedAt: new Date() } });
  });
  await runWithTenant({ conjuntoId: B.id, role: 'OPERATOR' }, async () => {
    await prisma.user.create({ data: { email: 'opb@e.local', passwordHash: await bcryptHash(PWD), role: 'OPERATOR', nombre: 'OpB', telefono: '1', termsAcceptedAt: new Date() } });
  });

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
});

// ---------- E1: createPrealert notifica al operador del conjunto del residente ----------
// Opción menos invasiva: verificar la RESOLUCIÓN del operador con la misma
// consulta que usa createPrealert (findFirst role OPERATOR) bajo el contexto del
// residente de Beta. La extensión la filtra por conjunto, así que devuelve el
// operador de Beta — sin tocar email.service ni inyectar dobles en el controlador.
test('E1: el operador notificado es el del conjunto del residente (Beta)', { skip: omitir && razonSkip }, async () => {
  const opDeBeta = await runWithTenant({ conjuntoId: ctx.B, role: 'RESIDENT' }, () =>
    prisma.user.findFirst({ where: { role: 'OPERATOR' } })
  );
  assert.ok(opDeBeta, 'debe existir un operador en Beta');
  assert.equal(opDeBeta.email, 'opb@e.local');
  // Y desde Alfa, la misma consulta da el operador de Alfa (no se cruzan).
  const opDeAlfa = await runWithTenant({ conjuntoId: ctx.A, role: 'RESIDENT' }, () =>
    prisma.user.findFirst({ where: { role: 'OPERATOR' } })
  );
  assert.equal(opDeAlfa.email, 'opa@e.local');
});

// ---------- E2: cortesía de primera entrega por apartamento, aislada por conjunto ----------
// Reproduce la lógica de checkin: el primer paquete de un apartamento (torre/apto)
// dentro del conjunto sale en 0; el resto no. Se comprueba que el barrido de
// "primer paquete del apto" queda acotado al conjunto activo.
test('E2: la cortesía por apartamento no cruza conjuntos con misma torre/apto', { skip: omitir && razonSkip }, async () => {
  // Alfa: dos residentes en Torre 1 / 302. Beta: uno en Torre 1 / 302.
  const aptoA1 = await crearUsuario(ctx.A, { email: 'a1@e.local', torre: 'Torre 1', apto: '302' });
  const aptoA2 = await crearUsuario(ctx.A, { email: 'a2@e.local', torre: 'Torre 1', apto: '302' });
  const aptoB1 = await crearUsuario(ctx.B, { email: 'b1@e.local', torre: 'Torre 1', apto: '302' });

  // "primer paquete del apartamento dentro del conjunto": lo consultamos igual
  // que checkin, bajo el contexto de cada conjunto.
  async function esPrimeroDelApto(conjuntoId, residenteIds) {
    return runWithTenant({ conjuntoId, role: 'OPERATOR' }, async () => {
      const previos = await prisma.package.count({ where: { residenteId: { in: residenteIds } } });
      return previos === 0;
    });
  }

  const idsAptoAlfa = [aptoA1.id, aptoA2.id];
  const idsAptoBeta = [aptoB1.id];

  // Alfa: el primer paquete del apto (residente a1) es cortesía.
  assert.equal(await esPrimeroDelApto(ctx.A, idsAptoAlfa), true);
  await runWithTenant({ conjuntoId: ctx.A, role: 'OPERATOR' }, () =>
    prisma.package.create({ data: { residenteId: aptoA1.id, proveedor: 'PA1', pin: '1111', costoServicio: 0 } })
  );

  // Beta, mismo Torre 1/302: su primer paquete TAMBIÉN es cortesía (otro conjunto).
  assert.equal(await esPrimeroDelApto(ctx.B, idsAptoBeta), true);
  await runWithTenant({ conjuntoId: ctx.B, role: 'OPERATOR' }, () =>
    prisma.package.create({ data: { residenteId: aptoB1.id, proveedor: 'PB1', pin: '2222', costoServicio: 0 } })
  );

  // Segundo residente de Alfa en el mismo apto: ya NO es cortesía (el apto de
  // Alfa ya tuvo su primer paquete).
  assert.equal(await esPrimeroDelApto(ctx.A, idsAptoAlfa), false);
});

// ---------- E3: aislamiento HTTP de schedule/checkin/confirm-delivery + sin fotoUrl ----------
test('E3: schedule/checkin/confirm-delivery no cruzan conjuntos; sin fotoUrl', { skip: omitir && razonSkip }, async () => {
  // Un residente de Alfa con un paquete, y un residente de Beta con otro.
  const resA = await crearUsuario(ctx.A, { email: 'resa-e3@e.local', torre: 'Torre 3', apto: '10' });
  const resA2 = await crearUsuario(ctx.A, { email: 'resa2-e3@e.local', torre: 'Torre 3', apto: '11' });
  const resB = await crearUsuario(ctx.B, { email: 'resb-e3@e.local', torre: 'Torre 3', apto: '10' });
  // passwords para login
  await runWithTenant({ conjuntoId: ctx.A, role: 'OPERATOR' }, async () => {
    await prisma.user.update({ where: { id: resA.id }, data: { passwordHash: await bcryptHash(PWD) } });
    await prisma.user.update({ where: { id: resA2.id }, data: { passwordHash: await bcryptHash(PWD) } });
  });
  await runWithTenant({ conjuntoId: ctx.B, role: 'OPERATOR' }, async () => {
    await prisma.user.update({ where: { id: resB.id }, data: { passwordHash: await bcryptHash(PWD) } });
  });
  const pkgA = await runWithTenant({ conjuntoId: ctx.A, role: 'OPERATOR' }, () =>
    prisma.package.create({ data: { residenteId: resA.id, proveedor: 'PA', pin: '1111' } })
  );
  const pkgB = await runWithTenant({ conjuntoId: ctx.B, role: 'OPERATOR' }, () =>
    prisma.package.create({ data: { residenteId: resB.id, proveedor: 'PB', pin: '2222' } })
  );

  const tokenResA = await login('resa-e3@e.local');
  const tokenOpA = await login('opa@e.local');

  // schedule (residente A) sobre el paquete de Beta -> 404.
  const sched = await api(`/api/packages/${pkgB.id}/schedule`, {
    method: 'PATCH', token: tokenResA, body: { franjaHoraria: 'MAÑANA', metodoPagoServicio: 'EFECTIVO' },
  });
  assert.equal(sched.status, 404);

  // checkin (operador A) sobre el paquete de Beta -> 404.
  const chk = await api(`/api/packages/${pkgB.id}/checkin`, { method: 'PATCH', token: tokenOpA, body: { categoriaPeso: 'ESTANDAR' } });
  assert.equal(chk.status, 404);

  // confirm-delivery (operador A) sobre el paquete de Beta -> 404.
  const conf = await api(`/api/packages/${pkgB.id}/confirm-delivery`, { method: 'POST', token: tokenOpA, body: { pin: '2222' } });
  assert.equal(conf.status, 404);

  // El paquete de Beta no cambió.
  const pkgBDespues = await runWithTenant({ conjuntoId: ctx.B, role: 'OPERATOR' }, () =>
    prisma.package.findUnique({ where: { id: pkgB.id } })
  );
  assert.equal(pkgBDespues.estado, 'PREALERTADO');
  assert.equal(pkgBDespues.proveedor, 'PB');

  // Dentro de Alfa: resA2 no puede schedule el paquete de resA -> 404.
  const tokenResA2 = await login('resa2-e3@e.local');
  const schedMismo = await api(`/api/packages/${pkgA.id}/schedule`, {
    method: 'PATCH', token: tokenResA2, body: { franjaHoraria: 'MAÑANA', metodoPagoServicio: 'EFECTIVO' },
  });
  assert.equal(schedMismo.status, 404);

  // listAll (operador) y /packages/mine (residente) NO incluyen fotoUrl.
  const listAll = await (await api('/api/packages', { token: tokenOpA })).json();
  assert.ok(listAll.every((p) => !('fotoUrl' in p)), '/packages no debe incluir fotoUrl');
  const mine = await (await api('/api/packages/mine', { token: tokenResA })).json();
  assert.ok(mine.every((p) => !('fotoUrl' in p)), '/packages/mine no debe incluir fotoUrl');
});

// ---------- E4: bonos por conjunto ----------
test('E4: bonos aislados por conjunto y gate por bonosHabilitados', { skip: omitir && razonSkip }, async () => {
  const resB = await crearUsuario(ctx.B, { email: 'resb-e4@e.local', torre: 'T', apto: '1' });
  const tokenOpA = await login('opa@e.local');

  // GET /bonos/residente/:id con un residente de Beta, pedido por operador de
  // Alfa -> no devuelve nada (findMany filtrado por conjunto = []).
  const res = await api(`/api/bonos/residente/${resB.id}`, { token: tokenOpA });
  assert.equal(res.status, 200);
  const bonos = await res.json();
  assert.deepEqual(bonos, []);

  // create de bono en Alfa (bonosHabilitados=false) -> 403.
  const resCreate = await api('/api/bonos', { method: 'POST', token: tokenOpA, body: { residenteId: 'x', categoriaPeso: 'ESTANDAR', cantidad: 3, precioPagado: 1000 } });
  assert.equal(resCreate.status, 403);
});

// ---------- E5: comentarios por conjunto ----------
test('E5: comentarios aislados por conjunto', { skip: omitir && razonSkip }, async () => {
  const resB = await crearUsuario(ctx.B, { email: 'resb-e5@e.local', torre: 'T', apto: '1' });
  await runWithTenant({ conjuntoId: ctx.B, role: 'OPERATOR' }, async () => {
    await prisma.user.update({ where: { id: resB.id }, data: { passwordHash: await bcryptHash(PWD) } });
  });
  const tokenResB = await login('resb-e5@e.local');
  const tokenOpA = await login('opa@e.local');

  // Residente de Beta crea un comentario.
  const crear = await api('/api/comments', { method: 'POST', token: tokenResB, body: { mensaje: 'hola desde beta' } });
  assert.equal(crear.status, 201);

  // Operador de Alfa lista comentarios -> no ve el de Beta.
  const listaA = await (await api('/api/comments', { token: tokenOpA })).json();
  assert.ok(listaA.every((c) => c.mensaje !== 'hola desde beta'), 'Alfa no debe ver comentarios de Beta');

  // El comentario quedó en Beta.
  const enBeta = await runWithTenant({ conjuntoId: ctx.B, role: 'OPERATOR' }, () =>
    prisma.comentario.findMany({ where: { residenteId: resB.id } })
  );
  assert.ok(enBeta.some((c) => c.mensaje === 'hola desde beta'));
});

test('teardown', { skip: omitir && razonSkip }, async () => {
  await limpiar();
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
});
