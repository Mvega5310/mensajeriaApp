// Integración de las correcciones de la revisión S3.2 contra Postgres real:
//  C5 (domicilio impostor): discriminador, posibleDuplicado, orden, desactivar dirección;
//  lote que mezcla personas; spam de domicilios (tope, limitador, búsqueda con 3100 de relleno);
//  y las bajas (foto 404, registro endurecido, tieneDomicilioEn real, config-publica, slug + código,
//  /bonos/mine y /comments/mine de todos los conjuntos).
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
if (omitir) console.warn(`[revisionS32.integration] OMITIDA: ${razonSkip}`);
if (!omitir && !process.env.JWT_SECRET) process.env.JWT_SECRET = 'itest-secret';
const skip = omitir && razonSkip;

let prisma, runWithTenant, createApp, crearLimitadorMemoria, crearNotificadorFake, server, base, notificador;
const S = { A: 'its32-a', B: 'its32-b' };
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
  await prisma.user.deleteMany({ where: { email: { endsWith: '@its32.local' } } });
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
  await crearOperador({ conjuntoId: ctx.A, email: 'opa@its32.local', passwordHash: hash, nombre: 'Operador', telefono: '3000000000' });
  await crearOperador({ conjuntoId: ctx.B, email: 'opb@its32.local', passwordHash: hash, nombre: 'Operador', telefono: '3000000000' });
  notificador = crearNotificadorFake();
  const app = createApp({ notificador, limitadorConjuntos: crearLimitadorMemoria({ max: 1000, ventanaMs: 60_000 }) });
  await new Promise((resolve) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  ctx.tOpA = await login('opa@its32.local');
  ctx.tOpB = await login('opb@its32.local');
});

// --- C5: domicilio impostor --------------------------------------------------------------

test('C5: dos personas con el mismo nombre en el mismo apto se distinguen: teléfono, antigüedad, entregas, duplicado', { skip }, async () => {
  ctx.ana = await registrar({ email: 'ana@its32.local', nombre: 'Ana Pérez', conjunto: S.A, torre: 'T2', apto: '304', telefono: '3001110001' });
  ctx.eve = await registrar({ email: 'eve@its32.local', nombre: 'Ana Perez', conjunto: S.A, torre: 'Torre 2', apto: '304', telefono: '3009994567' });
  ctx.carla = await registrar({ email: 'carla@its32.local', nombre: 'Carla Soto', conjunto: S.A, torre: 'T3', apto: '202', telefono: '3005550000' });
  ctx.tAna = await login('ana@its32.local');
  ctx.tEve = await login('eve@its32.local');
  ctx.tCarla = await login('carla@its32.local');
  ctx.domAna = (await domiciliosDe(ctx.tAna))[0];
  ctx.domEve = (await domiciliosDe(ctx.tEve))[0];
  ctx.domCarla = (await domiciliosDe(ctx.tCarla))[0];
  // Eve es la más antigua; Ana tiene una entrega previa.
  await en(ctx.A, () => prisma.domicilio.update({ where: { id: ctx.domEve.id }, data: { creadoEn: new Date('2026-03-01T00:00:00Z') } }));
  await paquete(ctx.A, ctx.ana, ctx.domAna.id, '9001', { estado: 'ENTREGADO' });

  const r = await buscar(ctx.tOpA, '304');
  assert.equal(r.length, 2);
  for (const x of r) {
    assert.equal(x.posibleDuplicado, true, 'mismo nombre normalizado (sin tildes) en el mismo apartamento');
    assert.ok(/^\d{4}$/.test(x.telefonoFin));
  }
  assert.deepEqual(r.map((x) => x.telefonoFin), ['0001', '4567'], 'primero quien tiene entregas previas');
  assert.equal(r[0].entregados, 1);
  assert.equal(r[0].esNueva, true);
  assert.equal(r[1].esNueva, false, 'creada en marzo 2026: no es nueva');
  assert.equal(new Date(r[1].creadoEn).toISOString().slice(0, 7), '2026-03');
  // Nada más de la persona: ni correo ni el teléfono completo.
  const texto = JSON.stringify(r);
  assert.ok(!texto.includes('@') && !texto.includes('3009994567') && !texto.includes('3001110001'));
  // Otro nombre en otro apto: sin aviso de duplicado.
  const c = await buscar(ctx.tOpA, 'carla');
  assert.equal(c[0].posibleDuplicado, false);
});

test('C5: con la guía escrita, el domicilio con la pre-alerta abierta de esa guía sale primero', { skip }, async () => {
  const r = await api('/api/packages', { method: 'POST', token: ctx.tEve, body: { proveedor: 'Amazon', guia: 'GUIA-EVE-77' } });
  assert.equal(r.status, 201);
  const con = await buscar(ctx.tOpA, '304', '&guia=guia-eve-77');
  assert.equal(con[0].telefonoFin, '4567');
  assert.equal(con[0].prealertaCoincide, true);
  assert.equal(con[1].prealertaCoincide, false);
  const sin = await buscar(ctx.tOpA, '304', '&guia=otra');
  assert.equal(sin[0].telefonoFin, '0001');
});

test('C5: el operador desactiva una dirección: auditado, fuera de la búsqueda, sin paquetes nuevos y no se reactiva sola', { skip }, async () => {
  // Un residente no puede, ni el operador de otro conjunto.
  assert.equal((await api(`/api/domicilios/${ctx.domEve.id}/desactivar`, { method: 'PATCH', token: ctx.tEve })).status, 403);
  assert.equal((await api(`/api/domicilios/${ctx.domEve.id}/desactivar`, { method: 'PATCH', token: ctx.tOpB })).status, 404);
  assert.equal((await api('/api/domicilios/no-existe/desactivar', { method: 'PATCH', token: ctx.tOpA })).status, 404);
  assert.equal((await api(`/api/domicilios/${ctx.domEve.id}/desactivar`, { method: 'PATCH' })).status, 401);

  const ok = await api(`/api/domicilios/${ctx.domEve.id}/desactivar`, { method: 'PATCH', token: ctx.tOpA });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { id: ctx.domEve.id, activo: false });
  // Idempotente: no duplica el evento.
  assert.equal((await api(`/api/domicilios/${ctx.domEve.id}/desactivar`, { method: 'PATCH', token: ctx.tOpA })).status, 200);
  const eventos = await en(ctx.A, () => prisma.domicilioEvento.findMany({ where: { domicilioId: ctx.domEve.id } }));
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].tipo, 'DESACTIVAR');
  assert.ok(eventos[0].actorId, 'queda quién lo desactivó');

  // Fuera de la búsqueda (y ya sin aviso de duplicado).
  const r = await buscar(ctx.tOpA, '304');
  assert.deepEqual(r.map((x) => x.telefonoFin), ['0001']);
  assert.equal(r[0].posibleDuplicado, false);
  // No recibe paquetes nuevos (ni por domicilioId ni por residenteId, que ignora los inactivos).
  const rec = await api('/api/packages/recepcion', { method: 'POST', token: ctx.tOpA, body: { domicilioId: ctx.domEve.id, categoriaPeso: 'ESTANDAR' } });
  assert.equal(rec.status, 409);
  assert.equal((await rec.json()).code, 'DIRECCION_DESACTIVADA');
  const rec2 = await api('/api/packages/recepcion', { method: 'POST', token: ctx.tOpA, body: { residenteId: ctx.eve, categoriaPeso: 'ESTANDAR' } });
  assert.equal(rec2.status, 404);
  // El residente la ve desactivada: no sale en su lista, y usarla o volver a crearla dice por qué.
  assert.deepEqual(await domiciliosDe(ctx.tEve), []);
  const pre = await api('/api/packages', { method: 'POST', token: ctx.tEve, body: { proveedor: 'X', domicilioId: ctx.domEve.id } });
  assert.equal(pre.status, 409);
  const preJ = await pre.json();
  assert.equal(preJ.code, 'DIRECCION_DESACTIVADA');
  assert.match(preJ.message, /desactivada por el operador/);
  const otra = await api('/api/domicilios', { method: 'POST', token: ctx.tEve, body: { conjunto: S.A, torre: 'T2', apto: '304' } });
  assert.equal(otra.status, 409, 'crear la misma dirección no la reactiva');
  assert.equal((await otra.json()).code, 'DIRECCION_DESACTIVADA');
  // …pero puede crear OTRA dirección.
  const nueva = await api('/api/domicilios', { method: 'POST', token: ctx.tEve, body: { conjunto: S.A, torre: 'T2', apto: '305' } });
  assert.equal(nueva.status, 201);
});

// --- Lote que mezcla personas -------------------------------------------------------------

test('lote: si mezcla personas, trae nombreRecibe, variasPersonas y solo preselecciona al dueño del PIN; se entrega el subconjunto', { skip }, async () => {
  ctx.bea = await registrar({ email: 'bea@its32.local', nombre: 'Bea Mora', conjunto: S.A, torre: 'T4', apto: '405' });
  ctx.cris = await registrar({ email: 'cris@its32.local', nombre: 'Cris Mora', conjunto: S.A, torre: 'T4', apto: '405' });
  const domBea = (await domiciliosDe(await login('bea@its32.local')))[0];
  const domCris = (await domiciliosDe(await login('cris@its32.local')))[0];
  const pb = await paquete(ctx.A, ctx.bea, domBea.id, '4001');
  const pc = await paquete(ctx.A, ctx.cris, domCris.id, '4002');
  const v = await api('/api/entregas/verificar-pin', { method: 'POST', token: ctx.tOpA, body: { pin: '4001' } });
  assert.equal(v.status, 200);
  const b = await v.json();
  assert.equal(b.variasPersonas, true);
  const porId = Object.fromEntries(b.paquetes.map((p) => [p.id, p]));
  assert.equal(porId[pb.id].nombreRecibe, 'Bea Mora');
  assert.equal(porId[pb.id].seleccionado, true);
  assert.equal(porId[pc.id].nombreRecibe, 'Cris Mora');
  assert.equal(porId[pc.id].seleccionado, false);
  assert.equal(b.total, 4500, 'el total es el de lo preseleccionado');
  // Entrega solo el de Bea; el de Cris queda en portería.
  const c = await api('/api/entregas/confirmar', {
    method: 'POST', token: ctx.tOpA, body: { tokenEntrega: b.tokenEntrega, paqueteIds: [pb.id], metodoPago: 'EFECTIVO' },
  });
  assert.equal(c.status, 200);
  assert.equal((await c.json()).entregados, 1);
  assert.equal((await en(ctx.A, () => prisma.package.findUnique({ where: { id: pc.id } }))).estado, 'EN_RECEPCION');
  // Una sola persona: variasPersonas false y todo preseleccionado.
  const v2 = await json(api('/api/entregas/verificar-pin', { method: 'POST', token: ctx.tOpA, body: { pin: '4002' } }));
  assert.equal(v2.variasPersonas, false);
  assert.ok(v2.paquetes.every((p) => p.seleccionado));
});

// --- Spam de domicilios -------------------------------------------------------------------

test('spam: máximo 10 direcciones activas por persona y conjunto (400 LIMITE_DIRECCIONES)', { skip }, async () => {
  ctx.spam = await registrar({ email: 'spam@its32.local', nombre: 'Spam', conjunto: S.B, torre: 'T1', apto: '1' });
  ctx.tSpam = await login('spam@its32.local');
  for (let i = 2; i <= 10; i += 1) {
    const r = await api('/api/domicilios', { method: 'POST', token: ctx.tSpam, body: { conjunto: S.B, torre: 'T1', apto: String(i) } });
    assert.equal(r.status, 201, `dirección ${i}`);
  }
  const once = await api('/api/domicilios', { method: 'POST', token: ctx.tSpam, body: { conjunto: S.B, torre: 'T1', apto: '11' } });
  assert.equal(once.status, 400);
  const j = await once.json();
  assert.equal(j.code, 'LIMITE_DIRECCIONES');
  assert.match(j.message, /10 direcciones/);
  // Reusar una existente sigue funcionando; la pre-alerta con dirección nueva también topa.
  assert.equal((await api('/api/domicilios', { method: 'POST', token: ctx.tSpam, body: { conjunto: S.B, torre: 'T1', apto: '5' } })).status, 201);
  const pre = await api('/api/packages', { method: 'POST', token: ctx.tSpam, body: { proveedor: 'X', conjunto: S.B, torre: 'T1', apto: '12' } });
  assert.equal(pre.status, 400);
  assert.equal((await pre.json()).code, 'LIMITE_DIRECCIONES');
  // Y en OTRO conjunto tiene su propio cupo.
  assert.equal((await api('/api/domicilios', { method: 'POST', token: ctx.tSpam, body: { conjunto: S.A, torre: 'T1', apto: '1' } })).status, 201);
});

test('spam: límite de altas por hora por cuenta (429)', { skip }, async () => {
  const app = createApp({
    notificador, limitadorConjuntos: crearLimitadorMemoria({ max: 1000, ventanaMs: 60_000 }),
    limitadorDirecciones: crearLimitadorMemoria({ max: 2, ventanaMs: 60_000 }),
  });
  const srv = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    const url = `http://127.0.0.1:${srv.address().port}`;
    const t = await login('carla@its32.local');
    const crear = (apto) => api('/api/domicilios', { method: 'POST', token: t, body: { conjunto: S.A, torre: 'T3', apto }, url });
    assert.equal((await crear('20')).status, 201);
    assert.equal((await crear('21')).status, 201);
    const r = await crear('22');
    assert.equal(r.status, 429);
    assert.ok(r.headers.get('retry-after'));
    assert.equal((await r.json()).code, 'DEMASIADOS_INTENTOS');
  } finally {
    await new Promise((resolve) => srv.close(resolve));
  }
});

test('spam: una ráfaga de 25 altas en paralelo no se salta el tope de 10 (se serializan por persona y conjunto)', { skip }, async () => {
  const app = createApp({
    notificador, limitadorConjuntos: crearLimitadorMemoria({ max: 1000, ventanaMs: 60_000 }),
    limitadorDirecciones: crearLimitadorMemoria({ max: 1000, ventanaMs: 60_000 }),
  });
  const srv = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    const url = `http://127.0.0.1:${srv.address().port}`;
    const id = await registrar({ email: 'rafaga@its32.local', nombre: 'Rafaga', conjunto: S.A, torre: 'T1', apto: '1' });
    const t = await login('rafaga@its32.local');
    const res = await Promise.all(Array.from({ length: 25 }, (_, i) => api('/api/domicilios', {
      method: 'POST', token: t, body: { conjunto: S.A, torre: 'T5', apto: String(100 + i) }, url,
    })));
    const estados = res.map((r) => r.status);
    assert.ok(estados.every((e) => e === 201 || e === 400), `solo 201 o 400: ${estados}`);
    assert.equal(await en(ctx.A, () => prisma.domicilio.count({ where: { usuarioId: id, activo: true } })), 10);
    assert.equal(estados.filter((e) => e === 201).length, 9, 'el registro ya dejó 1: caben 9 más');
  } finally {
    await new Promise((resolve) => srv.close(resolve));
  }
});

test('spam: con 3100 domicilios de relleno, el legítimo aparece por nombre y por apartamento', { skip }, async () => {
  const filas = Array.from({ length: 3100 }, (_, i) => ({
    usuarioId: ctx.spam, torre: String(1 + (i % 9)), apto: String(1000 + i),
    nombreRecibe: `Relleno ${i}`, nombreBusqueda: `relleno ${i}`, telefono: '3001112233',
  }));
  await en(ctx.B, () => prisma.domicilio.createMany({ data: filas }));
  assert.ok((await en(ctx.B, () => prisma.domicilio.count({}))) >= 3100);
  await registrar({ email: 'zeta@its32.local', nombre: 'Zeta Legítimo', conjunto: S.B, torre: 'T1', apto: '101' });
  const porNombre = await buscar(ctx.tOpB, 'zeta');
  assert.deepEqual(porNombre.map((x) => x.nombre), ['Zeta Legítimo']);
  assert.deepEqual((await buscar(ctx.tOpB, 'ZETA LEGITIMO')).map((x) => x.nombre), ['Zeta Legítimo'], 'sin tildes ni mayúsculas');
  const porApto = await buscar(ctx.tOpB, 'T1 101');
  assert.equal(porApto[0].nombre, 'Zeta Legítimo', 'el apto exacto va primero');
  // Resultado determinista: dos consultas iguales dan lo mismo.
  assert.deepEqual((await buscar(ctx.tOpB, '10')).map((x) => x.domicilioId), (await buscar(ctx.tOpB, '10')).map((x) => x.domicilioId));
});

// --- Bajas --------------------------------------------------------------------------------

test('baja: la foto de un paquete de otra persona es 404 (no 403)', { skip }, async () => {
  const p = await paquete(ctx.A, ctx.ana, ctx.domAna.id, '9100');
  assert.equal((await api(`/api/packages/${p.id}/foto`, { token: ctx.tCarla })).status, 404);
  assert.equal((await api(`/api/packages/${p.id}/foto`, { token: ctx.tAna })).status, 200);
});

test('baja: tieneDomicilioEn exige un Domicilio ACTIVO real, no solo la fila del índice', { skip }, async () => {
  const { tieneDomicilioEn } = await import('../../services/domicilio.service.js');
  assert.equal(await tieneDomicilioEn(ctx.ana, ctx.A), true);
  // Fila de índice sin dirección (p. ej. un alta que falló): no cuenta.
  await prisma.usuarioConjunto.upsert({
    where: { usuarioId_conjuntoId: { usuarioId: ctx.ana, conjuntoId: ctx.B } },
    create: { usuarioId: ctx.ana, conjuntoId: ctx.B }, update: {},
  });
  assert.equal(await tieneDomicilioEn(ctx.ana, ctx.B), false);
  const r = await api('/api/comments', { method: 'POST', token: ctx.tAna, body: { mensaje: 'hola', conjunto: S.B } });
  assert.equal(r.status, 404);
  // Eve, con su única dirección en A desactivada, tampoco.
  assert.equal(await tieneDomicilioEn(ctx.eve, ctx.A), true, 'tiene otra dirección activa (T2 · 305)');
});

test('teardown', { skip }, async () => {
  await new Promise((resolve) => server.close(resolve));
  await limpiar();
});
