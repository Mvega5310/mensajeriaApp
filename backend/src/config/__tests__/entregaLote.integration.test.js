// Integración de T2.5 contra Postgres real: POST /entregas/verificar-pin y /confirmar.

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
if (omitir) console.warn(`[entregaLote.integration] OMITIDA: ${razonSkip}`);
if (!omitir && !process.env.JWT_SECRET) process.env.JWT_SECRET = 'itest-secret';
const skip = omitir && razonSkip;

let prisma, runWithTenant, createApp, crearNotificadorFake, notificador, server, base;
const SLUGS = ['iteste-alfa', 'iteste-beta'];
const PWD = 'Password1';
const ctx = {};
const enA = (fn) => runWithTenant({ conjuntoId: ctx.A, role: 'OPERATOR' }, fn);
const enB = (fn) => runWithTenant({ conjuntoId: ctx.B, role: 'OPERATOR' }, fn);
let n = 0;

async function limpiar() {
  const conjuntos = await prisma.conjunto.findMany({ where: { slug: { in: SLUGS } } });
  for (const c of conjuntos) {
    await purgarEventos(prisma, c.id);
    await runWithTenant({ conjuntoId: c.id, role: 'OPERATOR' }, async () => {
      await prisma.package.deleteMany({});
      await prisma.user.deleteMany({});
    });
  }
  await prisma.conjunto.deleteMany({ where: { slug: { in: SLUGS } } });
}
function api(path, { method = 'POST', token, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${base}${path}`, { method, headers, body: JSON.stringify(body ?? {}) });
}
const login = async (email) => (await (await api('/api/auth/login', { body: { email, password: PWD } })).json()).token;
const verificar = (body, token = ctx.tOp) => api('/api/entregas/verificar-pin', { token, body });
const confirmar = (body, token = ctx.tOp) => api('/api/entregas/confirmar', { token, body });
const leer = (id) => enA(() => prisma.package.findUnique({ where: { id } }));
const eventos = (id) => enA(() => prisma.paqueteEvento.findMany({ where: { paqueteId: id }, orderBy: { creadoEn: 'asc' } }));

let hash;
async function residente({ torre = 'TORRE 1', apto, run = enA } = {}) {
  n += 1;
  return run(() => prisma.user.create({
    data: { email: `r${n}@iteste.local`, passwordHash: hash, role: 'RESIDENT', nombre: `Res ${n}`, telefono: '3000000000', torre, apto: apto ?? String(100 + n), termsAcceptedAt: new Date() },
  }));
}
let secuencia = 0;
async function paquete(residenteId, pin, { estado = 'EN_RECEPCION', costo = 4500, run = enA, extra = {} } = {}) {
  secuencia += 1;
  return run(() => prisma.package.create({
    data: {
      residenteId, proveedor: 'Amazon', pin, estado, costoServicio: costo, categoriaPeso: 'ESTANDAR',
      transportadora: 'Servientrega', recibidoEn: new Date(Date.now() - 100000 + secuencia * 1000), ...extra,
    },
  }));
}
// Evita que PINes aleatorios de otras pruebas choquen: cada prueba usa PINes propios.
const nuevoLimitador = () => { server.close(); return arrancar(); };
async function arrancar() {
  const app = createApp({ notificador });
  await new Promise((resolve) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
}

test('setup', { skip }, async () => {
  ({ prisma } = await import('../db.js'));
  ({ runWithTenant } = await import('../tenantContext.js'));
  ({ createApp } = await import('../../app.js'));
  ({ crearNotificadorFake } = await import('../../services/notificador/index.js'));
  notificador = crearNotificadorFake();
  hash = await (await import('bcryptjs')).default.hash(PWD, 4);
  await limpiar();
  const mk = (slug) => prisma.conjunto.create({
    data: { nombre: slug, slug, codigoInvitacion: `${slug}-cod`, operadorNombre: 'Op', operadorWhatsapp: '573000000000', operadorDomicilio: 'Dir', puntoRecepcion: 'Recepción' },
  });
  ctx.A = (await mk(SLUGS[0])).id;
  ctx.B = (await mk(SLUGS[1])).id;
  const op = (run, email, role = 'OPERATOR') => run(() => prisma.user.create({
    data: { email, passwordHash: hash, role, nombre: email, telefono: '3000000000', termsAcceptedAt: new Date() },
  }));
  ctx.opA = await op(enA, 'op@iteste.local');
  await op(enA, 'op2@iteste.local');
  await op(enB, 'opb@iteste.local');
  ctx.resLogin = await residente({ apto: '900' });
  await enA(() => prisma.user.update({ where: { id: ctx.resLogin.id }, data: { email: 'res@iteste.local' } }));
  await arrancar();
  ctx.tOp = await login('op@iteste.local');
  ctx.tOp2 = await login('op2@iteste.local');
  ctx.tOpB = await login('opb@iteste.local');
  ctx.tRes = await login('res@iteste.local');
});

test('PIN correcto: todos los paquetes entregables del apartamento (incl. otro residente del apto y otro PIN)', { skip }, async () => {
  const ana = await residente({ torre: 'TORRE 2', apto: '304' });
  const luis = await residente({ torre: 'torre 2 ', apto: 'Apto 304' });
  const otro = await residente({ torre: 'TORRE 2', apto: '305' });
  const p1 = await paquete(ana.id, '1001', { costo: 0, extra: { categoriaPeso: 'ESTANDAR' } });
  const p2 = await paquete(ana.id, '1002', { estado: 'PROGRAMADO', costo: 5000 });
  const p3 = await paquete(luis.id, '1003');
  await paquete(ana.id, '1001', { estado: 'ENTREGADO' });
  await paquete(ana.id, '1001', { estado: 'PREALERTADO' });
  await paquete(ana.id, '1001', { estado: 'SIN_ASIGNAR' });
  await paquete(otro.id, '1004');
  await enA(() => prisma.paqueteEvento.create({ data: { paqueteId: p1.id, tipo: 'RECIBIR', deEstado: 'PREALERTADO', aEstado: 'EN_RECEPCION', datos: { motivoCobro: 'CORTESIA', monto: 0 } } }));

  const r = await verificar({ pin: '1002' });
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.residente.id, ana.id);
  assert.equal(b.residente.etiquetaApto, 'T2 · 304');
  assert.deepEqual(b.paquetes.map((p) => p.id).sort(), [p1.id, p2.id, p3.id].sort());
  assert.equal(b.total, 0 + 5000 + 4500);
  assert.deepEqual(b.metodosPago, ['EFECTIVO', 'TRANSFERENCIA']);
  assert.ok(b.tokenEntrega);
  assert.equal(b.paquetes.find((p) => p.id === p1.id).motivoCobro, 'CORTESIA');
  assert.equal(b.paquetes.find((p) => p.id === p1.id).transportadora, 'Servientrega');
  assert.equal(b.paquetes.some((p) => 'pin' in p), false);
});

test('residente no puede usar las rutas; sin token 401; PIN con formato inválido 400', { skip }, async () => {
  assert.equal((await verificar({ pin: '1234' }, ctx.tRes)).status, 403);
  assert.equal((await confirmar({}, ctx.tRes)).status, 403);
  assert.equal((await verificar({ pin: '1234' }, null)).status, 401);
  assert.equal((await verificar({ pin: 'abc' })).status, 400);
});

test('colisión de PIN entre aptos: 409 PIN_AMBIGUO y se resuelve con residenteId o apto', { skip }, async () => {
  const a = await residente({ torre: 'TORRE 3', apto: '401' });
  const b = await residente({ torre: 'TORRE 3', apto: '402' });
  const pa = await paquete(a.id, '2001');
  const pb = await paquete(b.id, '2001');
  const r = await verificar({ pin: '2001' });
  assert.equal(r.status, 409);
  const e = await r.json();
  assert.equal(e.code, 'PIN_AMBIGUO');
  assert.deepEqual(e.details.opciones.map((o) => o.etiquetaApto), ['T3 · 401', 'T3 · 402']);
  const ok = await (await verificar({ pin: '2001', residenteId: e.details.opciones[1].residenteId })).json();
  assert.deepEqual(ok.paquetes.map((p) => p.id), [pb.id]);
  const ok2 = await (await verificar({ pin: '2001', apto: 'T3 401' })).json();
  assert.deepEqual(ok2.paquetes.map((p) => p.id), [pa.id]);
  assert.equal((await verificar({ pin: '2001', apto: '999' })).status, 400);
});

test('PIN de bloqueo por paquete: 423 aunque el PIN sea correcto', { skip }, async () => {
  const a = await residente();
  await paquete(a.id, '2501', { extra: { intentosPin: 5, pinBloqueadoHasta: new Date(Date.now() + 10 * 60000) } });
  const r = await verificar({ pin: '2501' });
  assert.equal(r.status, 423);
  assert.equal((await r.json()).code, 'PIN_BLOQUEADO');
});

test('PIN inexistente cuenta fallos por operador: el 21.º es 429; otro operador no se afecta', { skip }, async () => {
  await nuevoLimitador();
  ctx.tOp = await login('op@iteste.local');
  ctx.tOp2 = await login('op2@iteste.local');
  const a = await residente();
  await paquete(a.id, '3001');
  for (let i = 1; i <= 20; i++) {
    const r = await verificar({ pin: '9999' });
    assert.equal(r.status, 400, `fallo ${i}`);
    assert.equal((await r.json()).code, 'PIN_INCORRECTO');
  }
  const r11 = await verificar({ pin: '9999' });
  assert.equal(r11.status, 429);
  const j11 = await r11.json();
  assert.equal(j11.code, 'DEMASIADOS_INTENTOS');
  assert.match(j11.message, /^Muchos PIN incorrectos seguidos\. Espera \d+ minutos? o entrega desde Pendientes\.$/);
  assert.equal((await verificar({ pin: '3001' })).status, 429, 'bloqueado aunque acierte');
  assert.equal((await verificar({ pin: '3001' }, ctx.tOp2)).status, 200, 'otro operador sigue');
  await nuevoLimitador();
  ctx.tOp = await login('op@iteste.local');
  ctx.tOp2 = await login('op2@iteste.local');
  ctx.tOpB = await login('opb@iteste.local');
});

test('los aciertos no gastan el cupo de fallos', { skip }, async () => {
  const a = await residente();
  await paquete(a.id, '3101');
  for (let i = 0; i < 15; i++) assert.equal((await verificar({ pin: '3101' })).status, 200);
});

test('confirmar: entrega todo con un ENTREGAR por paquete y metodoPago', { skip }, async () => {
  const a = await residente({ apto: '601' });
  const p1 = await paquete(a.id, '4001', { costo: 0 });
  const p2 = await paquete(a.id, '4002', { costo: 5000 });
  const v = await (await verificar({ pin: '4001' })).json();
  assert.equal(v.total, 5000);
  const r = await confirmar({ tokenEntrega: v.tokenEntrega, paqueteIds: [p1.id, p2.id], metodoPago: 'EFECTIVO' });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { entregados: 2, total: 5000, metodoPago: 'EFECTIVO' });
  for (const p of [p1, p2]) {
    const f = await leer(p.id);
    assert.equal(f.estado, 'ENTREGADO');
    assert.equal(f.metodoPago, 'EFECTIVO');
    assert.ok(f.fechaEntrega);
    const ev = (await eventos(p.id)).filter((e) => e.tipo === 'ENTREGAR');
    assert.equal(ev.length, 1);
    assert.equal(ev[0].actorId, ctx.opA.id);
  }
});

test('confirmar: un solo correo de agradecimiento con todos los paquetes del lote', { skip }, async () => {
  const a = await residente({ apto: '602' });
  await enA(() => prisma.user.update({ where: { id: a.id }, data: { email: 'lote602@iteste.local' } }));
  const p1 = await paquete(a.id, '4011', { costo: 0 });
  const p2 = await paquete(a.id, '4012', { costo: 3000 });
  const v = await (await verificar({ pin: '4011' })).json();
  notificador.limpiar();
  const r = await confirmar({ tokenEntrega: v.tokenEntrega, paqueteIds: [p1.id, p2.id], metodoPago: 'TRANSFERENCIA' });
  assert.equal(r.status, 200);
  await new Promise((ok) => setTimeout(ok, 50));
  const env = notificador.obtenerEnviados().filter((m) => m.tipo === 'entrega');
  assert.equal(env.length, 1);
  assert.equal(env[0].para, 'lote602@iteste.local');
});

test('confirmar: subconjunto de ids, validaciones de método/ids/token', { skip }, async () => {
  const a = await residente({ apto: '602' });
  const otra = await residente({ apto: '603' });
  const p1 = await paquete(a.id, '4101');
  const p2 = await paquete(a.id, '4102');
  const ajeno = await paquete(otra.id, '4103');
  const v = await (await verificar({ pin: '4101' })).json();
  const t = v.tokenEntrega;
  assert.equal((await confirmar({ tokenEntrega: t, paqueteIds: [p1.id], metodoPago: 'CHEQUE' })).status, 400);
  assert.equal((await confirmar({ tokenEntrega: t, paqueteIds: [], metodoPago: 'EFECTIVO' })).status, 400);
  assert.equal((await confirmar({ tokenEntrega: t, paqueteIds: [p1.id, ajeno.id], metodoPago: 'EFECTIVO' })).status, 403);
  assert.equal((await leer(p1.id)).estado, 'EN_RECEPCION');
  assert.equal((await confirmar({ tokenEntrega: 'basura', paqueteIds: [p1.id], metodoPago: 'EFECTIVO' })).status, 401);
  const alterado = `${t.slice(0, -2)}${t.endsWith('AA') ? 'BB' : 'AA'}`;
  assert.equal((await confirmar({ tokenEntrega: alterado, paqueteIds: [p1.id], metodoPago: 'EFECTIVO' })).status, 401);
  const ok = await confirmar({ tokenEntrega: t, paqueteIds: [p1.id], metodoPago: 'TRANSFERENCIA' });
  assert.deepEqual(await ok.json(), { entregados: 1, total: 4500, metodoPago: 'TRANSFERENCIA' });
  assert.equal((await leer(p2.id)).estado, 'EN_RECEPCION');
});

test('confirmar: token de otro operador 403; de otro conjunto 403; vencido 401', { skip }, async () => {
  const a = await residente({ apto: '604' });
  const p = await paquete(a.id, '4201');
  const v = await (await verificar({ pin: '4201' })).json();
  const body = { tokenEntrega: v.tokenEntrega, paqueteIds: [p.id], metodoPago: 'EFECTIVO' };
  assert.equal((await confirmar(body, ctx.tOp2)).status, 403);
  assert.equal((await confirmar(body, ctx.tOpB)).status, 403);
  // Vencido: se firma con reloj en el pasado.
  const { firmarTokenEntrega } = await import('../../domain/tokenEntrega.js');
  const viejo = firmarTokenEntrega(
    { operadorId: ctx.opA.id, conjuntoId: ctx.A, residenteId: a.id, paqueteIds: [p.id] },
    { secreto: process.env.ENTREGA_SECRET || process.env.JWT_SECRET, ahora: new Date(Date.now() - 11 * 60000) },
  ).token;
  const rv = await confirmar({ ...body, tokenEntrega: viejo });
  assert.equal(rv.status, 401);
  assert.equal((await leer(p.id)).estado, 'EN_RECEPCION');
});

test('carrera: dos confirmaciones del mismo lote -> una 200 y otra 409, sin entregas parciales', { skip }, async () => {
  const a = await residente({ apto: '605' });
  const ps = [];
  for (let i = 0; i < 4; i++) ps.push(await paquete(a.id, '4301'));
  const v = await (await verificar({ pin: '4301' })).json();
  const ids = ps.map((p) => p.id);
  const [x, y] = await Promise.all([
    confirmar({ tokenEntrega: v.tokenEntrega, paqueteIds: ids, metodoPago: 'EFECTIVO' }),
    confirmar({ tokenEntrega: v.tokenEntrega, paqueteIds: [...ids].reverse(), metodoPago: 'TRANSFERENCIA' }),
  ]);
  assert.deepEqual([x.status, y.status].sort(), [200, 409]);
  const ganador = x.status === 200 ? 'EFECTIVO' : 'TRANSFERENCIA';
  for (const p of ps) {
    const f = await leer(p.id);
    assert.equal(f.estado, 'ENTREGADO');
    assert.equal(f.metodoPago, ganador);
    assert.equal((await eventos(p.id)).filter((e) => e.tipo === 'ENTREGAR').length, 1);
  }
});

test('confirmar con un paquete ya entregado por otra vía: 409 y nada cambia', { skip }, async () => {
  const a = await residente({ apto: '606' });
  const p1 = await paquete(a.id, '4401');
  const p2 = await paquete(a.id, '4402');
  const v = await (await verificar({ pin: '4401' })).json();
  await enA(() => prisma.package.update({ where: { id: p2.id }, data: { estado: 'ENTREGADO' } }));
  const r = await confirmar({ tokenEntrega: v.tokenEntrega, paqueteIds: [p1.id, p2.id], metodoPago: 'EFECTIVO' });
  assert.equal(r.status, 409);
  assert.equal((await leer(p1.id)).estado, 'EN_RECEPCION');
  assert.equal((await eventos(p1.id)).filter((e) => e.tipo === 'ENTREGAR').length, 0);
});

test('aislamiento: un PIN de otro conjunto nunca resuelve', { skip }, async () => {
  const rb = await residente({ run: enB, apto: '777' });
  const pb = await paquete(rb.id, '5001', { run: enB });
  const r = await verificar({ pin: '5001' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, 'PIN_INCORRECTO');
  const vb = await (await verificar({ pin: '5001' }, ctx.tOpB)).json();
  assert.deepEqual(vb.paquetes.map((p) => p.id), [pb.id]);
  // Un token de B no entrega paquetes de A.
  const a = await residente({ apto: '607' });
  const pa = await paquete(a.id, '5002');
  const rr = await confirmar({ tokenEntrega: vb.tokenEntrega, paqueteIds: [pa.id], metodoPago: 'EFECTIVO' }, ctx.tOpB);
  assert.equal(rr.status, 403);
  assert.equal((await leer(pa.id)).estado, 'EN_RECEPCION');
});

test('confirm-delivery individual sigue funcionando', { skip }, async () => {
  const a = await residente({ apto: '608' });
  const p = await paquete(a.id, '6001');
  const r = await api(`/api/packages/${p.id}/confirm-delivery`, { token: ctx.tOp, body: { pin: '6001' } });
  assert.equal(r.status, 200);
  assert.equal((await leer(p.id)).estado, 'ENTREGADO');
});

test('teardown', { skip }, async () => {
  await new Promise((r) => server.close(r));
  await limpiar();
  await prisma.$disconnect();
});
