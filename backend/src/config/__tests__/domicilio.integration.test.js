// Integración de PLAN-conjunto S1.1/S1.2 contra Postgres real: la cuenta es de la
// persona, la dirección de entrega (Domicilio) es de un conjunto, y el aislamiento
// entre conjuntos NO se debilita.
//
//   - una persona con Domicilio en A y en B ve los paquetes de los DOS ("Mis paquetes");
//   - el operador de A no ve nada de B: ni la búsqueda, ni los listados, ni /packages/:id,
//     ni la entrega por PIN, ni el CSV; y el Domicilio de B no le aparece;
//   - de la persona el operador solo ve lo que hay en el Domicilio (nunca email ni otros conjuntos);
//   - un RESIDENT no puede leer la cuenta ni los paquetes de otra persona;
//   - crearOReutilizarDomicilio deduplica por la forma canónica de torre/apto.
// Mismo patrón de skip/guarda de localhost que las demás de integración.

import test from 'node:test';
import assert from 'node:assert/strict';
import { purgarEventos } from '../../../test-support/purgarEventos.js';
import { crearUsuarioDeContexto } from '../../../test-support/usuarios.js';

const dbUrl = process.env.DATABASE_URL;
let dbHost = null;
try { dbHost = dbUrl ? new URL(dbUrl).hostname : null; } catch { dbHost = null; }
const esLocal = !!dbHost && new Set(['localhost', '127.0.0.1', '::1']).has(dbHost);
const razonSkip = !dbUrl
  ? 'DATABASE_URL no definida'
  : !esLocal ? `DATABASE_URL apunta a un host NO local (${dbHost})` : null;
const omitir = razonSkip !== null;
if (omitir) console.warn(`[domicilio.integration] OMITIDA: ${razonSkip}`);
if (!omitir && !process.env.JWT_SECRET) process.env.JWT_SECRET = 'itest-secret';
const skip = omitir && razonSkip;

let prisma, runWithTenant, createApp, server, base, svc;
const SLUGS = ['itestdom-alfa', 'itestdom-beta'];
const PWD = 'Password1';
const ctx = {};
const enA = (fn) => runWithTenant({ conjuntoId: ctx.A, role: 'OPERATOR' }, fn);
const enB = (fn) => runWithTenant({ conjuntoId: ctx.B, role: 'OPERATOR' }, fn);

async function limpiar() {
  const conjuntos = await prisma.conjunto.findMany({ where: { slug: { in: SLUGS } } });
  for (const c of conjuntos) {
    await purgarEventos(prisma, c.id);
    await runWithTenant({ conjuntoId: c.id, role: 'OPERATOR' }, async () => {
      await prisma.package.deleteMany({});
      await prisma.domicilio.deleteMany({});
    });
    // Las cuentas de pruebas de este archivo (también las de otro "último conjunto").
    await prisma.usuarioConjunto.deleteMany({ where: { conjuntoId: c.id } });
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: '@itestdom.local' } } });
  await prisma.conjunto.deleteMany({ where: { slug: { in: SLUGS } } });
}
function api(path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const login = async (email) => (await (await api('/api/auth/login', { method: 'POST', body: { email, password: PWD } })).json()).token;
const recibir = (token, body) => api('/api/packages/recepcion', { method: 'POST', token, body });
const buscar = async (token, q) => (await api(`/api/residentes/buscar?q=${encodeURIComponent(q)}`, { token })).json();

test('setup', { skip }, async () => {
  ({ prisma } = await import('../db.js'));
  ({ runWithTenant } = await import('../tenantContext.js'));
  ({ createApp } = await import('../../app.js'));
  svc = await import('../../services/domicilio.service.js');
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(PWD, 4);
  await limpiar();
  const mk = (slug) => prisma.conjunto.create({
    data: { nombre: `Conjunto ${slug}`, slug, codigoInvitacion: `${slug}-cod`, operadorNombre: 'Op', operadorWhatsapp: '573000000000', operadorDomicilio: 'Dir', puntoRecepcion: 'Recepción' },
  });
  ctx.A = (await mk(SLUGS[0])).id;
  ctx.B = (await mk(SLUGS[1])).id;
  const user = (run, email, role, extra = {}) => run(() => crearUsuarioDeContexto(prisma, {
    data: { email, passwordHash: hash, role, nombre: extra.nombre ?? email, telefono: extra.telefono ?? '3000000000', torre: extra.torre ?? null, apto: extra.apto ?? null, termsAcceptedAt: new Date() },
  }));
  await user(enA, 'opa@itestdom.local', 'OPERATOR');
  await user(enB, 'opb@itestdom.local', 'OPERATOR');
  // P: Ana, cuenta con Domicilio en A (T2 · 304) y en B (T1 · 101). Su "último conjunto" es A.
  ctx.P = await user(enA, 'ana@itestdom.local', 'RESIDENT', { nombre: 'Ana Gómez', torre: 'TORRE 2', apto: '304', telefono: '3001111111' });
  ctx.domPB = await enB(() => svc.crearOReutilizarDomicilio({ usuarioId: ctx.P.id, torre: 'Torre 1', apto: '101', nombreRecibe: 'Ana en B', telefono: '3002222222' }));
  ctx.domPA = await enA(() => svc.domicilioDePersona(ctx.P.id));
  // Q: Luis, mismo apartamento que Ana en A (C5), solo en A.
  ctx.Q = await user(enA, 'luis@itestdom.local', 'RESIDENT', { nombre: 'Luis Pérez', torre: 'T2', apto: '304', telefono: '3003333333' });
  // R: Rosa, solo en B.
  ctx.R = await user(enB, 'rosa@itestdom.local', 'RESIDENT', { nombre: 'Rosa Ríos', torre: 'T1', apto: '101', telefono: '3004444444' });
  ctx.domQA = await enA(() => svc.domicilioDePersona(ctx.Q.id));
  ctx.domRB = await enB(() => svc.domicilioDePersona(ctx.R.id));

  const app = createApp();
  await new Promise((resolve) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  ctx.tOpA = await login('opa@itestdom.local');
  ctx.tOpB = await login('opb@itestdom.local');
  ctx.tP = await login('ana@itestdom.local');
  ctx.tQ = await login('luis@itestdom.local');
  ctx.tR = await login('rosa@itestdom.local');

  // Paquetes: A para Ana (por domicilioId) y para Luis; B para Ana (por residenteId, compatibilidad) y para Rosa.
  const ok = async (p) => { const r = await p; assert.equal(r.status, 201, JSON.stringify(await r.clone().json())); return (await r.json()).paquete; };
  ctx.pAnaA = await ok(recibir(ctx.tOpA, { domicilioId: ctx.domPA.id, categoriaPeso: 'ESTANDAR', guia: 'GA1' }));
  ctx.pLuisA = await ok(recibir(ctx.tOpA, { domicilioId: ctx.domQA.id, categoriaPeso: 'ESTANDAR', guia: 'GA2' }));
  ctx.pAnaB = await ok(recibir(ctx.tOpB, { residenteId: ctx.P.id, categoriaPeso: 'ESTANDAR', guia: 'GB1' }));
  ctx.pRosaB = await ok(recibir(ctx.tOpB, { domicilioId: ctx.domRB.id, categoriaPeso: 'ESTANDAR', guia: 'GB2' }));
  // PIN conocidos y distintos entre conjuntos.
  await enA(() => prisma.package.updateMany({ where: { id: { in: [ctx.pAnaA.id, ctx.pLuisA.id] } }, data: { pin: '1111' } }));
  await enB(() => prisma.package.updateMany({ where: { id: { in: [ctx.pAnaB.id, ctx.pRosaB.id] } }, data: { pin: '7777' } }));
});

test('la recepción enlaza el paquete con el Domicilio (por domicilioId y por residenteId)', { skip }, async () => {
  const a = await enA(() => prisma.package.findUnique({ where: { id: ctx.pAnaA.id } }));
  assert.equal(a.domicilioId, ctx.domPA.id);
  assert.equal(a.residenteId, ctx.P.id);
  const b = await enB(() => prisma.package.findUnique({ where: { id: ctx.pAnaB.id } }));
  assert.equal(b.domicilioId, ctx.domPB.id, 'con residenteId se usa el domicilio de la persona EN ESTE conjunto');
  assert.equal(ctx.pAnaB.nombre, 'Ana en B');
  assert.equal(ctx.pAnaB.etiquetaApto, 'T1 · 101');
});

test('persona con paquetes en A y B: "Mis paquetes" los ve todos, cada uno con su conjunto', { skip }, async () => {
  const r = await api('/api/packages/mine', { token: ctx.tP });
  assert.equal(r.status, 200);
  const lista = await r.json();
  assert.deepEqual(lista.map((p) => p.id).sort(), [ctx.pAnaA.id, ctx.pAnaB.id].sort());
  const porId = Object.fromEntries(lista.map((p) => [p.id, p]));
  assert.equal(porId[ctx.pAnaA.id].conjunto.slug, SLUGS[0]);
  assert.equal(porId[ctx.pAnaB.id].conjunto.slug, SLUGS[1]);
  assert.equal(porId[ctx.pAnaB.id].pin, '7777', 'el residente ve el PIN de su paquete también en el otro conjunto');
  assert.ok(lista.every((p) => !('fotoUrl' in p)), 'sin fotos en el listado');
  // más reciente primero
  assert.ok(new Date(lista[0].createdAt) >= new Date(lista[1].createdAt));
});

test('cada persona ve solo lo suyo: Luis no ve lo de Ana y Rosa no ve lo de A', { skip }, async () => {
  const luis = await (await api('/api/packages/mine', { token: ctx.tQ })).json();
  assert.deepEqual(luis.map((p) => p.id), [ctx.pLuisA.id]);
  const rosa = await (await api('/api/packages/mine', { token: ctx.tR })).json();
  assert.deepEqual(rosa.map((p) => p.id), [ctx.pRosaB.id]);
});

test('operador de A: listados, CSV y /packages/:id no ven nada de B', { skip }, async () => {
  const lista = await (await api('/api/packages', { token: ctx.tOpA })).json();
  assert.deepEqual(lista.map((p) => p.id).sort(), [ctx.pAnaA.id, ctx.pLuisA.id].sort());
  for (const p of lista) {
    assert.ok(!('domicilio' in p), 'el domicilio anidado no se expone tal cual');
    assert.deepEqual(Object.keys(p.residente).sort(), ['apto', 'nombre', 'telefono', 'torre']);
    assert.ok(!JSON.stringify(p).includes('@itestdom.local'), 'ni correos');
  }
  const ana = lista.find((p) => p.id === ctx.pAnaA.id);
  assert.equal(ana.residente.nombre, 'Ana Gómez');
  assert.equal(ana.residente.torre, '2');
  assert.equal(ana.residente.apto, '304');

  const csv = await (await api('/api/packages/export', { token: ctx.tOpA })).text();
  assert.ok(csv.includes(ctx.pAnaA.id) && csv.includes('GA1'));
  assert.ok(!csv.includes(ctx.pAnaB.id) && !csv.includes('GB1') && !csv.includes('GB2'));
  assert.ok(!csv.includes('Ana en B') && !csv.includes('Rosa'), 'ni nombres ni datos del Domicilio de B');

  for (const id of [ctx.pAnaB.id, ctx.pRosaB.id]) {
    assert.equal((await api(`/api/packages/${id}`, { token: ctx.tOpA })).status, 404);
  }
  assert.equal((await api(`/api/packages/${ctx.pAnaA.id}`, { token: ctx.tOpA })).status, 200);
});

test('búsqueda del operador: solo Domicilios de su conjunto; el de B no aparece; sin correo ni otros conjuntos', { skip }, async () => {
  // "101" es el apartamento de Ana (T1) y de Rosa en B: en A no existe.
  assert.deepEqual(await buscar(ctx.tOpA, '101'), []);
  assert.deepEqual(await buscar(ctx.tOpA, 'rosa'), []);
  assert.deepEqual(await buscar(ctx.tOpA, 'Ana en B'), []);
  // Ana en A: un solo resultado (el domicilio de A), con la forma nueva.
  const porNombre = await buscar(ctx.tOpA, 'ana gomez');
  assert.equal(porNombre.length, 1);
  assert.deepEqual(Object.keys(porNombre[0]).sort(), [
    'apto', 'creadoEn', 'domicilioId', 'entregados', 'esNueva', 'etiqueta', 'id', 'nombre', 'pendientes',
    'posibleDuplicado', 'prealertaCoincide', 'residenteId', 'telefonoFin', 'torre',
  ]);
  assert.equal(porNombre[0].domicilioId, ctx.domPA.id);
  assert.equal(porNombre[0].residenteId, ctx.P.id);
  assert.equal(porNombre[0].etiqueta, 'T2 · 304');
  assert.equal(porNombre[0].pendientes, 1);
  // C5: "T2 304" muestra a TODOS los que tienen domicilio en ese apartamento (Ana y Luis).
  const apto = await buscar(ctx.tOpA, 'T2 304');
  assert.deepEqual(apto.map((r) => r.nombre).sort(), ['Ana Gómez', 'Luis Pérez']);
  // El operador de B ve el suyo (y solo el suyo).
  const enBuscado = await buscar(ctx.tOpB, '101');
  assert.deepEqual(enBuscado.map((r) => r.domicilioId).sort(), [ctx.domPB.id, ctx.domRB.id].sort());
  assert.deepEqual(await buscar(ctx.tOpB, '304'), []);
});

test('el operador de A no puede recibir ni asignar a un Domicilio/persona de B', { skip }, async () => {
  const antes = await enA(() => prisma.package.count());
  for (const body of [{ domicilioId: ctx.domPB.id }, { domicilioId: ctx.domRB.id }, { residenteId: ctx.R.id }]) {
    const r = await recibir(ctx.tOpA, { ...body, categoriaPeso: 'MANO' });
    assert.equal(r.status, 404, JSON.stringify(body));
  }
  assert.equal(await enA(() => prisma.package.count()), antes);
  // Asignar un paquete sin dueño de A a un domicilio de B: 404 y sigue sin asignar.
  const sinDueno = await (await recibir(ctx.tOpA, { etiquetaNombre: 'Sin dueño', categoriaPeso: 'MANO' })).json();
  const r = await api(`/api/packages/${sinDueno.paquete.id}/asignar`, { method: 'PATCH', token: ctx.tOpA, body: { domicilioId: ctx.domRB.id } });
  assert.equal(r.status, 404);
  assert.equal((await enA(() => prisma.package.findUnique({ where: { id: sinDueno.paquete.id } }))).estado, 'SIN_ASIGNAR');
  // Y a un domicilio de A sí (C5: elige quién del apartamento).
  const ok = await api(`/api/packages/${sinDueno.paquete.id}/asignar`, { method: 'PATCH', token: ctx.tOpA, body: { domicilioId: ctx.domQA.id } });
  assert.equal(ok.status, 200);
  const asignado = await enA(() => prisma.package.findUnique({ where: { id: sinDueno.paquete.id } }));
  assert.equal(asignado.domicilioId, ctx.domQA.id);
  assert.equal(asignado.residenteId, ctx.Q.id);
});

test('entrega por PIN: el operador de A no entrega un paquete de B; el de B sí', { skip }, async () => {
  // 7777 es el PIN de los paquetes de B; en A no existe.
  const r = await api('/api/entregas/verificar-pin', { method: 'POST', token: ctx.tOpA, body: { pin: '7777' } });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, 'PIN_INCORRECTO');
  const rApto = await api('/api/entregas/verificar-pin', { method: 'POST', token: ctx.tOpA, body: { pin: '7777', apto: 'T1 101' } });
  assert.equal(rApto.status, 400);
  const okB = await api('/api/entregas/verificar-pin', { method: 'POST', token: ctx.tOpB, body: { pin: '7777', residenteId: ctx.P.id } });
  assert.equal(okB.status, 200);
  const j = await okB.json();
  // El lote es por apartamento físico (Ana y Rosa comparten T1 · 101 en B): los dos de B, ninguno de A.
  assert.deepEqual(j.paquetes.map((p) => p.id).sort(), [ctx.pAnaB.id, ctx.pRosaB.id].sort());
  assert.equal(j.residente.etiquetaApto, 'T1 · 101');
});

test('un RESIDENT no puede leer la cuenta ni los paquetes de otra persona', { skip }, async () => {
  // /auth/me devuelve SOLO la cuenta de la sesión y nunca el hash.
  const me = await (await api('/api/auth/me', { token: ctx.tQ })).json();
  assert.equal(me.id, ctx.Q.id);
  assert.ok(!('passwordHash' in me));
  // No hay ruta de residente que acepte el id de otra cuenta; las de operador son 403.
  assert.equal((await api(`/api/packages/${ctx.pAnaA.id}`, { token: ctx.tQ })).status, 403);
  // La foto del paquete de otra persona es 404 (un 403 confirmaría que el id existe).
  assert.equal((await api(`/api/packages/${ctx.pAnaA.id}/foto`, { token: ctx.tQ })).status, 404);
  assert.equal((await api(`/api/residentes/buscar?q=ana`, { token: ctx.tQ })).status, 403);
  assert.equal((await api(`/api/bonos/residente/${ctx.P.id}`, { token: ctx.tQ })).status, 403);
  // Una pre-alerta con el domicilioId de OTRA persona no sirve (404): solo se usan los propios.
  const r = await api('/api/packages', { method: 'POST', token: ctx.tQ, body: { proveedor: 'X', domicilioId: ctx.domPA.id } });
  assert.equal(r.status, 404);
});

test('operador de A: de la persona solo lee el Domicilio de A (nunca el de B ni su correo)', { skip }, async () => {
  const filas = await enA(() => prisma.domicilio.findMany({}));
  assert.ok(filas.every((d) => d.conjuntoId === ctx.A));
  assert.ok(!filas.some((d) => d.id === ctx.domPB.id || d.id === ctx.domRB.id));
  assert.ok(filas.every((d) => !('email' in d)));
  assert.equal(await enA(() => prisma.domicilio.findUnique({ where: { id: ctx.domPB.id } })), null);
  // El operador de A tampoco puede volver a crear el domicilio de B con un where cruzado.
  await assert.rejects(enA(() => prisma.domicilio.update({ where: { id: ctx.domPB.id, conjuntoId: ctx.B }, data: { activo: false } })), /Aislamiento de tenant/);
  // El índice persona -> conjunto solo da ids (sin datos personales).
  assert.deepEqual((await svc.conjuntosDePersona(ctx.P.id)).sort(), [ctx.A, ctx.B].sort());
  assert.deepEqual(await svc.conjuntosDePersona(ctx.Q.id), [ctx.A]);
});

test('crearOReutilizarDomicilio: la dirección se pide UNA vez (forma canónica de torre/apto)', { skip }, async () => {
  const antes = await enA(() => prisma.domicilio.count({ where: { usuarioId: ctx.P.id } }));
  const mismas = [
    { torre: 'TORRE 2', apto: '304' }, { torre: 't2', apto: 'Apto 304' }, { torre: '2', apto: 'apto-304' }, { torre: ' Torre 02 ', apto: '304' },
  ];
  const ids = new Set();
  for (const d of mismas) {
    const r = await enA(() => svc.crearOReutilizarDomicilio({ usuarioId: ctx.P.id, ...d, nombreRecibe: 'Ana Gómez', telefono: '3001111111' }));
    ids.add(r.id);
    assert.equal(r.torre, '2');
    assert.equal(r.apto, '304');
  }
  assert.deepEqual([...ids], [ctx.domPA.id], 'todas son el mismo Domicilio');
  assert.equal(await enA(() => prisma.domicilio.count({ where: { usuarioId: ctx.P.id } })), antes);
  // Otra dirección sí crea otro Domicilio (para un amigo del mismo conjunto).
  const otra = await enA(() => svc.crearOReutilizarDomicilio({ usuarioId: ctx.P.id, torre: 'Torre 3', apto: '502', nombreRecibe: 'Amiga', telefono: '3005555555' }));
  assert.notEqual(otra.id, ctx.domPA.id);
  assert.equal(otra.torre, '3');
  // La última usada es la que viene puesta.
  assert.equal((await enA(() => svc.domicilioDePersona(ctx.P.id))).id, otra.id);
  // Sin torre ni apto: forma canónica sin NULL.
  const vacia = await enA(() => svc.crearOReutilizarDomicilio({ usuarioId: ctx.Q.id, torre: null, apto: undefined, nombreRecibe: 'Luis', telefono: '1' }));
  assert.deepEqual([vacia.torre, vacia.apto], ['', '']);
  assert.equal((await enA(() => svc.crearOReutilizarDomicilio({ usuarioId: ctx.Q.id, torre: '', apto: '', nombreRecibe: 'Luis', telefono: '1' }))).id, vacia.id);
});

test('una pre-alerta usa el domicilio más reciente de la persona y queda enlazada', { skip }, async () => {
  // Rosa (solo B, ctx de sus requests = B) crea una pre-alerta: va a su Domicilio de B.
  const r = await api('/api/packages', { method: 'POST', token: ctx.tR, body: { proveedor: 'Amazon' } });
  assert.equal(r.status, 201);
  const pkg = await r.json();
  assert.equal(pkg.domicilioId, ctx.domRB.id);
  assert.equal(pkg.residenteId, ctx.R.id);
});

test('teardown', { skip }, async () => {
  await limpiar();
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
});
