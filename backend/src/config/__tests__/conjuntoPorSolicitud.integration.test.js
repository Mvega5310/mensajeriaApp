// Integración de PLAN-conjunto S1.3 contra Postgres real: el conjunto se elige en cada
// solicitud. Cubre las rutas nuevas (GET /conjuntos, GET/POST /domicilios), el contexto por
// solicitud (paquete / ?conjunto= / sesión de enlace / pre-alerta), el escenario "ayudar a
// un amigo" completo y los límites de aislamiento (nada de un conjunto ajeno).
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
if (omitir) console.warn(`[conjuntoPorSolicitud.integration] OMITIDA: ${razonSkip}`);
if (!omitir && !process.env.JWT_SECRET) process.env.JWT_SECRET = 'itest-secret';
const skip = omitir && razonSkip;

let prisma, runWithTenant, createApp, crearNotificadorFake, crearLimitadorMemoria, tokenDeResidente, jwt, server, base, notificador;
const S = { A: 'itests-a', B: 'itests-b', C: 'itests-c', I: 'itests-inactivo' };
const SLUGS = Object.values(S);
const NOMBRES = { A: 'Zeta Conjunto', B: 'Alfa Conjunto', C: 'Gamma Conjunto', I: 'Inactivo Conjunto' };
const PWD = 'Password1';
const ctx = {};
const en = (id, fn) => runWithTenant({ conjuntoId: id, role: 'OPERATOR' }, fn);
const esperar = (ms = 60) => new Promise((r) => setTimeout(r, ms));

async function limpiar() {
  const conjuntos = await prisma.conjunto.findMany({ where: { slug: { in: SLUGS } } });
  for (const c of conjuntos) {
    await purgarEventos(prisma, c.id);
    await runWithTenant({ conjuntoId: c.id, role: 'OPERATOR' }, async () => {
      await prisma.comentario.deleteMany({});
      await prisma.package.deleteMany({});
      await prisma.domicilio.deleteMany({});
    });
    await prisma.usuarioConjunto.deleteMany({ where: { conjuntoId: c.id } });
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: '@itests.local' } } });
  await prisma.conjunto.deleteMany({ where: { slug: { in: SLUGS } } });
}

function api(path, { method = 'GET', token, body, headers: extra } = {}) {
  const headers = { ...(extra ?? {}) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const json = async (p) => (await p).json();
const login = async (email) => (await json(api('/api/auth/login', { method: 'POST', body: { email, password: PWD } }))).token;
const registrar = async (body) => {
  const r = await api('/api/auth/register', {
    method: 'POST',
    body: { password: PWD, telefono: '3001112233', acceptedTerms: true, ...body },
  });
  assert.equal(r.status, 201, JSON.stringify(await r.clone().json()));
  return (await r.json()).id;
};
const mine = async (token) => json(api('/api/packages/mine', { token }));
const lista = async (token) => json(api('/api/packages', { token }));
const emailsA = (para) => notificador.obtenerEnviados().filter((m) => m.para === para);

test('setup: tres conjuntos activos, uno inactivo, operadores y personas (registro por slug)', { skip }, async () => {
  ({ prisma } = await import('../db.js'));
  ({ runWithTenant } = await import('../tenantContext.js'));
  ({ createApp } = await import('../../app.js'));
  ({ crearNotificadorFake } = await import('../../services/notificador/index.js'));
  ({ crearLimitadorMemoria } = await import('../../domain/limitador.js'));
  ({ tokenDeResidente } = await import('../../services/enlace.service.js'));
  jwt = (await import('jsonwebtoken')).default;
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(PWD, 4);
  await limpiar();
  const mk = async (k, extra = {}) => (await prisma.conjunto.create({
    data: {
      nombre: NOMBRES[k], slug: S[k], codigoInvitacion: `${S[k]}-COD`, operadorNombre: `Op ${k}`,
      operadorWhatsapp: '573000000000', operadorDomicilio: 'Dir secreta', puntoRecepcion: 'Recepción', ...extra,
    },
  })).id;
  ctx.A = await mk('A');
  ctx.B = await mk('B');
  ctx.C = await mk('C');
  ctx.I = await mk('I', { invitacionActiva: false });
  const op = async (conj, email) => en(conj, async () => {
    // Los operadores se crean con el servicio real para no depender de helpers de prueba.
    const { crearOperador } = await import('../../services/usuario.service.js');
    return crearOperador({ conjuntoId: conj, email, passwordHash: hash, nombre: 'Operador', telefono: '3000000000' });
  });
  await op(ctx.A, 'opa@itests.local');
  await op(ctx.B, 'opb@itests.local');
  await op(ctx.C, 'opc@itests.local');

  notificador = crearNotificadorFake();
  const app = createApp({ notificador });
  await new Promise((resolve) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); }); });

  // Registro NUEVO: conjunto por slug, sin código de invitación.
  ctx.P = await registrar({ email: 'ana@itests.local', nombre: 'Ana Gómez', conjunto: S.A, torre: 'Torre 2', apto: '304' });
  ctx.Q = await registrar({ email: 'luis@itests.local', nombre: 'Luis Pérez', conjunto: S.A, torre: 'T2', apto: '304' });
  ctx.R = await registrar({ email: 'rosa@itests.local', nombre: 'Rosa Ríos', conjunto: S.C, torre: 'T1', apto: '501' });
  ctx.tOpA = await login('opa@itests.local');
  ctx.tOpB = await login('opb@itests.local');
  ctx.tOpC = await login('opc@itests.local');
  ctx.tP = await login('ana@itests.local');
  ctx.tQ = await login('luis@itests.local');
  ctx.tR = await login('rosa@itests.local');
});

// --- 1. GET /api/conjuntos (público) ---

test('GET /conjuntos: sin sesión, solo { slug, nombre } de los activos, por nombre, con caché corto', { skip }, async () => {
  const r = await api('/api/conjuntos');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('cache-control') ?? '', /max-age=\d+/);
  const todos = await r.json();
  const mios = todos.filter((c) => SLUGS.includes(c.slug));
  assert.deepEqual(mios.map((c) => c.slug), [S.B, S.C, S.A], 'orden por nombre (Alfa, Gamma, Zeta), no por slug; sin el inactivo');
  for (const c of todos) assert.deepEqual(Object.keys(c).sort(), ['nombre', 'slug']);
  const texto = JSON.stringify(todos);
  for (const prohibido of ['codigoInvitacion', '-COD', 'operador', 'Dir secreta', 'tarifa', 'id"']) {
    assert.ok(!texto.includes(prohibido), `no debe exponer ${prohibido}`);
  }
});

test('GET /conjuntos: límite de peticiones por IP (429 + Retry-After)', { skip }, async () => {
  const app = createApp({ notificador, limitadorConjuntos: crearLimitadorMemoria({ max: 2, ventanaMs: 60_000 }) });
  const srv = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    const url = `http://127.0.0.1:${srv.address().port}/api/conjuntos`;
    assert.equal((await fetch(url)).status, 200);
    assert.equal((await fetch(url)).status, 200);
    const tercera = await fetch(url);
    assert.equal(tercera.status, 429);
    assert.ok(Number(tercera.headers.get('retry-after')) > 0);
    assert.equal((await tercera.json()).code, 'DEMASIADOS_INTENTOS');
  } finally {
    await new Promise((resolve) => srv.close(resolve));
  }
});

// --- 4. Registro ---

test('registro por slug: crea su primera dirección en ese conjunto y la deja como la última usada', { skip }, async () => {
  const u = await prisma.user.findUnique({ where: { id: ctx.P } });
  assert.equal(u.conjuntoId, ctx.A);
  const ds = await json(api('/api/domicilios', { token: ctx.tP }));
  assert.equal(ds.length, 1);
  assert.deepEqual(ds[0].conjunto, { slug: S.A, nombre: NOMBRES.A });
  assert.equal(ds[0].etiqueta, 'T2 · 304');
});

test('registro con slug inactivo o inexistente -> 400 CONJUNTO_INVALIDO; con varios activos y sin nada -> CONJUNTO_REQUERIDO', { skip }, async () => {
  for (const conjunto of [S.I, 'no-existe']) {
    const r = await api('/api/auth/register', {
      method: 'POST', body: { email: 'x@itests.local', password: PWD, nombre: 'X', telefono: '3001112233', acceptedTerms: true, conjunto },
    });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).code, 'CONJUNTO_INVALIDO');
  }
  const sin = await api('/api/auth/register', {
    method: 'POST', body: { email: 'x@itests.local', password: PWD, nombre: 'X', telefono: '3001112233', acceptedTerms: true },
  });
  assert.equal(sin.status, 400);
  assert.equal((await sin.json()).code, 'CONJUNTO_REQUERIDO');
  assert.equal(await prisma.user.count({ where: { email: 'x@itests.local' } }), 0);
});

test('registro con el código antiguo (sin slug) sigue sirviendo', { skip }, async () => {
  const id = await registrar({ email: 'codigo@itests.local', nombre: 'Con Código', codigoInvitacion: `${S.B}-COD`, torre: 'T1', apto: '101' });
  const u = await prisma.user.findUnique({ where: { id } });
  assert.equal(u.conjuntoId, ctx.B);
  const tok = await login('codigo@itests.local');
  const ds = await json(api('/api/domicilios', { token: tok }));
  assert.deepEqual(ds.map((d) => d.conjunto.slug), [S.B]);
});

test('config-publica acepta ?conjunto= además de ?c=', { skip }, async () => {
  const porSlug = await api(`/api/conjuntos/config-publica?conjunto=${S.B}`);
  assert.equal(porSlug.status, 200);
  assert.equal((await porSlug.json()).nombre, NOMBRES.B);
  const porCodigo = await api(`/api/conjuntos/config-publica?c=${S.B}-COD`);
  assert.equal((await porCodigo.json()).nombre, NOMBRES.B);
  assert.equal((await api(`/api/conjuntos/config-publica?conjunto=${S.I}`)).status, 400);
  assert.equal((await json(api('/api/conjuntos/config-publica'))).code, 'CONJUNTO_REQUERIDO');
});

// --- 3. /api/domicilios ---

test('POST /domicilios: crea (precarga nombre y teléfono de la cuenta), reutiliza por la forma canónica y actualiza lo que llegue', { skip }, async () => {
  const r = await api('/api/domicilios', { method: 'POST', token: ctx.tP, body: { conjunto: S.B, torre: 'Torre 1', apto: '101' } });
  assert.equal(r.status, 201);
  const d = await r.json();
  ctx.domPB = d.id;
  assert.deepEqual(Object.keys(d).sort(), ['apto', 'conjunto', 'etiqueta', 'id', 'nombreRecibe', 'telefono', 'torre', 'ultimoUsoEn']);
  assert.equal(d.nombreRecibe, 'Ana Gómez');
  assert.equal(d.telefono, '3001112233');
  assert.deepEqual(d.conjunto, { slug: S.B, nombre: NOMBRES.B });
  assert.equal(d.etiqueta, 'T1 · 101');

  const otra = await json(api('/api/domicilios', { method: 'POST', token: ctx.tP, body: { conjunto: S.B, torre: 'T1', apto: '101', nombreRecibe: 'Beto Ríos', telefono: '3009998888' } }));
  assert.equal(otra.id, ctx.domPB, 'misma dirección: se reutiliza');
  assert.equal(otra.nombreRecibe, 'Beto Ríos');
  assert.equal(otra.telefono, '3009998888');
  // Reutilizar sin nombre no pisa el que ya tenía.
  const sin = await json(api('/api/domicilios', { method: 'POST', token: ctx.tP, body: { conjunto: S.B, torre: '1', apto: '101' } }));
  assert.equal(sin.id, ctx.domPB);
  assert.equal(sin.nombreRecibe, 'Beto Ríos');
  // El "último conjunto" de la cuenta pasó a B.
  const u = await prisma.user.findUnique({ where: { id: ctx.P } });
  assert.equal(u.conjuntoId, ctx.B);
});

test('POST /domicilios: slug inactivo/inexistente/ausente -> 400 CONJUNTO_INVALIDO; sin apto -> 400; roles y sesión', { skip }, async () => {
  for (const conjunto of [S.I, 'no-existe', undefined, '', 5]) {
    const r = await api('/api/domicilios', { method: 'POST', token: ctx.tP, body: { conjunto, torre: 'T1', apto: '101' } });
    assert.equal(r.status, 400, `conjunto=${JSON.stringify(conjunto)}`);
    assert.equal((await r.json()).code, 'CONJUNTO_INVALIDO');
  }
  const sinApto = await api('/api/domicilios', { method: 'POST', token: ctx.tP, body: { conjunto: S.B, torre: 'T1' } });
  assert.equal(sinApto.status, 400);
  assert.equal((await sinApto.json()).code, 'DATOS_INVALIDOS');
  assert.equal((await api('/api/domicilios', { method: 'POST', token: ctx.tOpA, body: { conjunto: S.A, apto: '1' } })).status, 403);
  assert.equal((await api('/api/domicilios', { token: ctx.tOpA })).status, 403);
  assert.equal((await api('/api/domicilios')).status, 401);
  // No quedó nada en el conjunto inactivo.
  assert.equal(await prisma.usuarioConjunto.count({ where: { conjuntoId: ctx.I } }), 0);
});

test('GET /domicilios: sus direcciones de TODOS los conjuntos, la última usada primero, y solo las suyas', { skip }, async () => {
  const ds = await json(api('/api/domicilios', { token: ctx.tP }));
  assert.deepEqual(ds.map((d) => d.conjunto.slug), [S.B, S.A], 'B se usó después que A');
  for (const d of ds) assert.deepEqual(Object.keys(d).sort(), ['apto', 'conjunto', 'etiqueta', 'id', 'nombreRecibe', 'telefono', 'torre', 'ultimoUsoEn']);
  assert.ok(new Date(ds[0].ultimoUsoEn) >= new Date(ds[1].ultimoUsoEn));
  const luis = await json(api('/api/domicilios', { token: ctx.tQ }));
  assert.deepEqual(luis.map((d) => d.conjunto.slug), [S.A]);
  assert.ok(!JSON.stringify(luis).includes('Ana'), 'no ve las direcciones de otra persona');
  const rosa = await json(api('/api/domicilios', { token: ctx.tR }));
  assert.deepEqual(rosa.map((d) => d.conjunto.slug), [S.C]);
});

// --- 5. Pre-alerta y escenario "ayudar a un amigo" ---

test('ayudar a un amigo: pre-alerta de una persona de A en B -> paquete en B, correo al operador de B, /mine con conjunto B, el operador de A no ve nada', { skip }, async () => {
  // Ana vive en A (su último conjunto, tras el registro) y avisa un paquete para un amigo en B.
  await prisma.user.update({ where: { id: ctx.P }, data: { conjuntoId: ctx.A } });
  notificador.limpiar();
  const r = await api('/api/packages', {
    method: 'POST', token: ctx.tP,
    body: { conjunto: S.B, torre: 'Torre 1', apto: '101', nombreRecibe: 'Beto Ríos', telefono: '3009998888', proveedor: 'Amazon', guia: 'G-AMIGO' },
  });
  assert.equal(r.status, 201, JSON.stringify(await r.clone().json()));
  const pkg = await r.json();
  ctx.pAmigo = pkg.id;
  assert.equal(pkg.conjuntoId, ctx.B);
  assert.equal(pkg.domicilioId, ctx.domPB);
  await esperar();
  // Correo al operador de B (no al de A); el residente recibe su confirmación.
  assert.equal(emailsA('opb@itests.local').filter((m) => m.tipo === 'nuevaPrealerta').length, 1);
  assert.equal(emailsA('opa@itests.local').length, 0);
  assert.equal(emailsA('ana@itests.local').filter((m) => m.tipo === 'prealerta').length, 1);
  const correoB = emailsA('opb@itests.local')[0];
  assert.ok(correoB.html.includes('Beto'), 'el operador ve el nombre de quien recibe en SU conjunto');
  assert.ok(!correoB.html.includes('ana@itests.local'), 'nunca el correo de la cuenta');
  // El operador de B lo ve; el de A no ve nada de B.
  assert.deepEqual((await lista(ctx.tOpB)).map((p) => p.id), [pkg.id]);
  assert.deepEqual(await lista(ctx.tOpA), []);
  // Ana lo ve en /mine con el conjunto B; su "último conjunto" pasó a B.
  const m = await mine(ctx.tP);
  const suyo = m.find((p) => p.id === pkg.id);
  assert.deepEqual(suyo.conjunto, { slug: S.B, nombre: NOMBRES.B });
  assert.equal((await prisma.user.findUnique({ where: { id: ctx.P } })).conjuntoId, ctx.B);
});

test('ayudar a un amigo (cont.): el operador de B busca, recibe por domicilioId con la pre-alerta, Ana pide la entrega desde A y se entrega con PIN', { skip }, async () => {
  // El operador de B busca "101": ve la dirección del amigo (nombre que puso Ana), sin cuentas.
  const hallados = await json(api('/api/residentes/buscar?q=101', { token: ctx.tOpB }));
  const h = hallados.find((x) => x.domicilioId === ctx.domPB);
  assert.ok(h, 'la dirección aparece en la búsqueda del operador de B');
  assert.equal(h.nombre, 'Beto Ríos');
  // El operador de A no la ve.
  assert.deepEqual(await json(api('/api/residentes/buscar?q=101', { token: ctx.tOpA })), []);

  // Recepción por domicilioId: se vincula con la pre-alerta (misma guía) y pasa a EN_RECEPCION.
  const rec = await api('/api/packages/recepcion', {
    method: 'POST', token: ctx.tOpB, body: { domicilioId: ctx.domPB, categoriaPeso: 'ESTANDAR', guia: 'G-AMIGO' },
  });
  assert.equal(rec.status, 201, JSON.stringify(await rec.clone().json()));
  const { paquete } = await rec.json();
  assert.equal(paquete.id, ctx.pAmigo, 'reutiliza la pre-alerta');
  assert.equal(paquete.estado, 'EN_RECEPCION');
  assert.equal(paquete.domicilioId, ctx.domPB);
  assert.ok(!('pin' in paquete), 'el operador no recibe el PIN');
  await esperar();
  assert.equal(emailsA('ana@itests.local').filter((m) => m.tipo === 'llegada').length, 1, 'aviso de llegada a la cuenta de quien lo pidió');

  // Ana crea otra pre-alerta en A (su último conjunto vuelve a ser A)...
  const enA = await api('/api/packages', { method: 'POST', token: ctx.tP, body: { proveedor: 'Rappi', domicilioId: (await json(api('/api/domicilios', { token: ctx.tP }))).find((d) => d.conjunto.slug === S.A).id } });
  assert.equal(enA.status, 201);
  ctx.pEnA = (await enA.json()).id;
  assert.equal((await prisma.user.findUnique({ where: { id: ctx.P } })).conjuntoId, ctx.A);

  // ...y desde ahí programa la entrega del paquete de B: el contexto es el conjunto DEL paquete.
  const sch = await api(`/api/packages/${ctx.pAmigo}/schedule`, { method: 'PATCH', token: ctx.tP, body: { modalidad: 'RECOGER' } });
  assert.equal(sch.status, 200, JSON.stringify(await sch.clone().json()));
  const prog = await sch.json();
  assert.equal(prog.estado, 'PROGRAMADO');
  assert.equal(prog.conjuntoId, ctx.B);
  // También sus fotos (vacías) en el conjunto del paquete.
  const foto = await api(`/api/packages/${ctx.pAmigo}/foto`, { token: ctx.tP });
  assert.equal(foto.status, 200);
  assert.deepEqual((await foto.json()).fotos, []);

  // Entrega con PIN por el operador de B (el PIN se lo ve el residente en /mine).
  const pin = (await mine(ctx.tP)).find((p) => p.id === ctx.pAmigo).pin;
  assert.match(pin, /^\d{4}$/);
  const mal = await api(`/api/packages/${ctx.pAmigo}/confirm-delivery`, { method: 'POST', token: ctx.tOpA, body: { pin } });
  assert.equal(mal.status, 404, 'el operador de A no puede entregar un paquete de B');
  const ok = await api(`/api/packages/${ctx.pAmigo}/confirm-delivery`, { method: 'POST', token: ctx.tOpB, body: { pin } });
  assert.equal(ok.status, 200, JSON.stringify(await ok.clone().json()));
  assert.equal((await ok.json()).estado, 'ENTREGADO');

  // /mine de Ana: el paquete de B (entregado) y el de A, cada uno con su conjunto.
  const m = await mine(ctx.tP);
  const porId = Object.fromEntries(m.map((p) => [p.id, p]));
  assert.equal(porId[ctx.pAmigo].estado, 'ENTREGADO');
  assert.equal(porId[ctx.pAmigo].conjunto.slug, S.B);
  assert.equal(porId[ctx.pEnA].conjunto.slug, S.A);
});

test('pre-alerta sin nada usa la dirección más reciente (0 campos) en SU conjunto y avisa a SU operador', { skip }, async () => {
  // La más reciente de Ana es la de A (la última usada).
  notificador.limpiar();
  const r = await api('/api/packages', { method: 'POST', token: ctx.tP, body: { proveedor: 'MercadoLibre' } });
  assert.equal(r.status, 201);
  assert.equal((await r.json()).conjuntoId, ctx.A);
  await esperar();
  assert.equal(emailsA('opa@itests.local').filter((m) => m.tipo === 'nuevaPrealerta').length, 1);
  assert.equal(emailsA('opb@itests.local').length, 0);
});

test('pre-alerta: domicilioId ajeno -> 404; slug inactivo/inexistente -> 400; domicilioId con otro conjunto -> 400; nueva dirección sin apto -> 400', { skip }, async () => {
  const delQ = (await json(api('/api/domicilios', { token: ctx.tQ })))[0].id;
  const ajeno = await api('/api/packages', { method: 'POST', token: ctx.tP, body: { proveedor: 'X', domicilioId: delQ } });
  assert.equal(ajeno.status, 404);
  for (const conjunto of [S.I, 'no-existe']) {
    const r = await api('/api/packages', { method: 'POST', token: ctx.tP, body: { proveedor: 'X', conjunto, torre: 'T1', apto: '101' } });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).code, 'CONJUNTO_INVALIDO');
  }
  const enB = await api('/api/packages', { method: 'POST', token: ctx.tP, body: { proveedor: 'X', domicilioId: ctx.domPB, conjunto: S.A } });
  assert.equal(enB.status, 400);
  const sinApto = await api('/api/packages', { method: 'POST', token: ctx.tP, body: { proveedor: 'X', conjunto: S.C } });
  assert.equal(sinApto.status, 400);
  assert.equal((await sinApto.json()).code, 'DATOS_INVALIDOS');
  // Nada se creó en el conjunto C ni en el inactivo.
  assert.deepEqual(await lista(ctx.tOpC), []);
  assert.equal(await prisma.usuarioConjunto.count({ where: { usuarioId: ctx.P, conjuntoId: { in: [ctx.C, ctx.I] } } }), 0);
});

test('pre-alerta con una dirección nueva en un conjunto donde no tenía: queda guardada y el conjunto pasa a ser el último', { skip }, async () => {
  const r = await api('/api/packages', { method: 'POST', token: ctx.tR, body: { proveedor: 'X', conjunto: S.B, torre: 'T3', apto: '808' } });
  assert.equal(r.status, 201);
  const ds = await json(api('/api/domicilios', { token: ctx.tR }));
  assert.deepEqual(ds.map((d) => d.conjunto.slug), [S.B, S.C]);
  assert.equal(ds[0].nombreRecibe, 'Rosa Ríos', 'precarga el nombre de la cuenta');
  assert.equal((await prisma.user.findUnique({ where: { id: ctx.R } })).conjuntoId, ctx.B);
});

// --- 2. Contexto por solicitud ---

test('un paquete ajeno en un conjunto donde la persona no tiene domicilio -> 404 (schedule y foto)', { skip }, async () => {
  // Rosa (C) tiene un paquete en C recibido por el operador de C.
  const domRosaC = (await json(api('/api/domicilios', { token: ctx.tR }))).find((d) => d.conjunto.slug === S.C).id;
  const rec = await api('/api/packages/recepcion', { method: 'POST', token: ctx.tOpC, body: { domicilioId: domRosaC, categoriaPeso: 'ESTANDAR', guia: 'GC1' } });
  assert.equal(rec.status, 201);
  ctx.pRosaC = (await rec.json()).paquete.id;
  // Ana no tiene domicilio en C: ni lo programa ni ve sus fotos.
  const sch = await api(`/api/packages/${ctx.pRosaC}/schedule`, { method: 'PATCH', token: ctx.tP, body: { modalidad: 'RECOGER' } });
  assert.equal(sch.status, 404);
  const foto = await api(`/api/packages/${ctx.pRosaC}/foto`, { token: ctx.tP });
  assert.equal(foto.status, 404);
  // El paquete de otra persona en el MISMO conjunto de Ana tampoco (dueño distinto).
  const rq = await api('/api/packages', { method: 'POST', token: ctx.tQ, body: { proveedor: 'X' } });
  const pQ = (await rq.json()).id;
  assert.equal((await api(`/api/packages/${pQ}/schedule`, { method: 'PATCH', token: ctx.tP, body: { modalidad: 'RECOGER' } })).status, 404);
  // Aun si Ana tuviera domicilio en C, un paquete que no es suyo no se resuelve.
  await api('/api/domicilios', { method: 'POST', token: ctx.tP, body: { conjunto: S.C, torre: 'T9', apto: '909' } });
  assert.equal((await api(`/api/packages/${ctx.pRosaC}/schedule`, { method: 'PATCH', token: ctx.tP, body: { modalidad: 'RECOGER' } })).status, 404);
  // (con C como su último conjunto el paquete existe pero no es suyo: 403, nunca 200)
  assert.ok([403, 404].includes((await api(`/api/packages/${ctx.pRosaC}/foto`, { token: ctx.tP })).status));
  // Y Rosa sí puede con el suyo.
  assert.equal((await api(`/api/packages/${ctx.pRosaC}/schedule`, { method: 'PATCH', token: ctx.tR, body: { modalidad: 'RECOGER' } })).status, 200);
});

test('?conjunto=<slug>: /p/paquetes y /conjunto/config en el conjunto elegido; sin domicilio ahí 404; inactivo 400; el operador lo ignora', { skip }, async () => {
  // El último conjunto de Ana es A (su pre-alerta sin nada). Pide los paquetes activos de B.
  await prisma.user.update({ where: { id: ctx.P }, data: { conjuntoId: ctx.A } });
  const enA = await json(api('/api/p/paquetes', { token: ctx.tP }));
  assert.equal(enA.conjunto.nombre, NOMBRES.A);
  const enB = await api(`/api/p/paquetes?conjunto=${S.B}`, { token: ctx.tP });
  assert.equal(enB.status, 200);
  assert.equal((await enB.json()).conjunto.nombre, NOMBRES.B);
  const cfg = await json(api(`/api/conjunto/config?conjunto=${S.B}`, { token: ctx.tP }));
  assert.equal(cfg.nombre, NOMBRES.B);
  // Un conjunto donde Ana tiene domicilio solo desde ahora: 200; donde no: 404.
  assert.equal((await api(`/api/p/paquetes?conjunto=${S.I}`, { token: ctx.tQ })).status, 400);
  assert.equal((await api(`/api/p/paquetes?conjunto=${S.B}`, { token: ctx.tQ })).status, 404, 'Luis no tiene domicilio en B');
  assert.equal((await api(`/api/conjunto/config?conjunto=${S.B}`, { token: ctx.tQ })).status, 404);
  // El operador no elige conjunto: ignora el parámetro.
  const op = await json(api(`/api/conjunto/config?conjunto=${S.B}`, { token: ctx.tOpA }));
  assert.equal(op.nombre, NOMBRES.A);
});

test('comentarios: `conjunto` dirige el comentario al operador de ESE conjunto', { skip }, async () => {
  const r = await api('/api/comments', { method: 'POST', token: ctx.tP, body: { mensaje: 'Hola operador de B', conjunto: S.B } });
  assert.equal(r.status, 201);
  const deB = await json(api('/api/comments', { token: ctx.tOpB }));
  assert.deepEqual(deB.map((c) => c.mensaje), ['Hola operador de B']);
  assert.deepEqual(await json(api('/api/comments', { token: ctx.tOpA })), []);
  const malo = await api('/api/comments', { method: 'POST', token: ctx.tQ, body: { mensaje: 'x', conjunto: S.B } });
  assert.equal(malo.status, 404, 'sin domicilio en B no puede comentar allí');
  assert.equal((await api(`/api/comments/mine?conjunto=${S.B}`, { token: ctx.tP })).status, 200);
});

// --- Sesión de enlace ---

test('enlace: un paquete en B para una persona cuyo "último conjunto" es A -> abre, refresca, programa y ve fotos', { skip }, async () => {
  assert.equal((await prisma.user.findUnique({ where: { id: ctx.P } })).conjuntoId, ctx.A);
  // Paquete en B (recibido por el operador de B contra la dirección de Ana en B).
  const rec = await api('/api/packages/recepcion', { method: 'POST', token: ctx.tOpB, body: { domicilioId: ctx.domPB, categoriaPeso: 'ESTANDAR', guia: 'G-ENLACE' } });
  assert.equal(rec.status, 201);
  const idB = (await rec.json()).paquete.id;
  const abierto = await api('/api/p/abrir', { method: 'POST', body: { token: tokenDeResidente({ residenteId: ctx.P, conjuntoId: ctx.B }) } });
  assert.equal(abierto.status, 200);
  const vista = await abierto.json();
  assert.equal(vista.conjunto.nombre, NOMBRES.B);
  assert.ok(vista.paquetes.some((p) => p.id === idB));
  const sesion = vista.sesion;
  // Refresco con la sesión limitada: el conjunto del token (B), aunque la cuenta diga A.
  const refresco = await api('/api/p/paquetes', { token: sesion });
  assert.equal(refresco.status, 200);
  const rv = await refresco.json();
  assert.equal(rv.conjunto.nombre, NOMBRES.B);
  assert.ok(rv.paquetes.some((p) => p.id === idB));
  // `?conjunto=` no la saca de su conjunto.
  assert.equal((await (await api(`/api/p/paquetes?conjunto=${S.A}`, { token: sesion })).json()).conjunto.nombre, NOMBRES.B);
  // Programa y ve fotos del paquete de B; el paquete de A (otro conjunto) no existe para esta sesión.
  const sch = await api(`/api/packages/${idB}/schedule`, { method: 'PATCH', token: sesion, body: { modalidad: 'RECOGER' } });
  assert.equal(sch.status, 200, JSON.stringify(await sch.clone().json()));
  assert.equal((await api(`/api/packages/${idB}/foto`, { token: sesion })).status, 200);
  assert.equal((await api(`/api/packages/${ctx.pEnA}/schedule`, { method: 'PATCH', token: sesion, body: { modalidad: 'RECOGER' } })).status, 404);
  assert.equal((await api(`/api/packages/${ctx.pEnA}/foto`, { token: sesion })).status, 404);
  // Sigue sin poder usar otras rutas (lista cerrada): ni direcciones ni pre-alertas.
  assert.equal((await api('/api/domicilios', { token: sesion })).status, 403);
  assert.equal((await api('/api/packages', { method: 'POST', token: sesion, body: { proveedor: 'X' } })).status, 403);
});

test('enlace: token de un conjunto donde la persona no tiene domicilio -> no abre; sesión limitada firmada para ese conjunto -> 401', { skip }, async () => {
  const sinDomicilio = await api('/api/p/abrir', { method: 'POST', body: { token: tokenDeResidente({ residenteId: ctx.Q, conjuntoId: ctx.B }) } });
  assert.equal(sinDomicilio.status, 404);
  const falsa = jwt.sign({ sub: ctx.Q, role: 'RESIDENT', conjuntoId: ctx.B, scope: 'enlace' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const r = await api('/api/p/paquetes', { token: falsa });
  assert.equal(r.status, 401, 'la sesión de enlace solo vale en conjuntos donde la persona tiene domicilio');
});

// --- 6. Recepción/asignar por domicilioId ---

test('asignar: el operador asigna un paquete sin dueño con domicilioId; uno de otro conjunto no existe', { skip }, async () => {
  const rec = await api('/api/packages/recepcion', { method: 'POST', token: ctx.tOpB, body: { categoriaPeso: 'ESTANDAR', etiquetaNombre: 'Sra. Ríos', guia: 'G-SD' } });
  assert.equal(rec.status, 201);
  const sd = (await rec.json()).paquete;
  assert.equal(sd.estado, 'SIN_ASIGNAR');
  const delA = (await json(api('/api/domicilios', { token: ctx.tQ })))[0].id;
  assert.equal((await api(`/api/packages/${sd.id}/asignar`, { method: 'PATCH', token: ctx.tOpB, body: { domicilioId: delA } })).status, 404);
  const ok = await api(`/api/packages/${sd.id}/asignar`, { method: 'PATCH', token: ctx.tOpB, body: { domicilioId: ctx.domPB } });
  assert.equal(ok.status, 200, JSON.stringify(await ok.clone().json()));
  const { paquete } = await ok.json();
  assert.equal(paquete.estado, 'EN_RECEPCION');
  assert.equal(paquete.domicilioId, ctx.domPB);
  // `residenteId` sigue aceptándose por compatibilidad.
  const rec2 = await api('/api/packages/recepcion', { method: 'POST', token: ctx.tOpB, body: { categoriaPeso: 'ESTANDAR', etiquetaNombre: 'Otro', guia: 'G-SD2' } });
  const sd2 = (await rec2.json()).paquete;
  const compat = await api(`/api/packages/${sd2.id}/asignar`, { method: 'PATCH', token: ctx.tOpB, body: { residenteId: ctx.P } });
  assert.equal(compat.status, 200);
  assert.equal((await compat.json()).paquete.domicilioId, ctx.domPB, 'residenteId resuelve el domicilio de la persona EN este conjunto');
});

test('teardown', { skip }, async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await limpiar();
  await prisma.$disconnect();
});
