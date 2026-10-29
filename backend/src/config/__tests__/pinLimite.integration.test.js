// Integración de T1.4 contra Postgres real: límite de intentos del PIN
// (persistido, concurrente, sobrevive al rollback) y límite de login por IP.

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
if (omitir) console.warn(`[pinLimite.integration] OMITIDA: ${razonSkip}`);
if (!omitir && !process.env.JWT_SECRET) process.env.JWT_SECRET = 'itest-secret';

let prisma, runWithTenant, createApp, server, base;
const SLUG = 'itestl-alfa';
const PWD = 'Password1';
const ctx = {};
const enA = (fn) => runWithTenant({ conjuntoId: ctx.A, role: 'OPERATOR' }, fn);
const skip = omitir && razonSkip;

async function limpiar() {
  const conjuntos = await prisma.conjunto.findMany({ where: { slug: SLUG } });
  for (const c of conjuntos) {
    await purgarEventos(prisma, c.id);
    await runWithTenant({ conjuntoId: c.id, role: 'OPERATOR' }, async () => {
      await prisma.package.deleteMany({});
      await prisma.domicilio.deleteMany({});
      await prisma.user.deleteMany({ where: { conjuntoId: c.id } });
    });
  }
  await prisma.conjunto.deleteMany({ where: { slug: SLUG } });
}
function api(path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const loginHttp = (email, password = PWD) => api('/api/auth/login', { method: 'POST', body: { email, password } });
const entregar = (id, pin) => api(`/api/packages/${id}/confirm-delivery`, { method: 'POST', token: ctx.tOp, body: { pin } });
const leer = (id) => enA(() => prisma.package.findUnique({ where: { id } }));
const malo = (real) => (real === '0000' ? '1111' : '0000');

// Paquete EN_RECEPCION listo para entregar.
async function nuevoPaquete(nombre) {
  const r = await api('/api/packages', { method: 'POST', token: ctx.tRes, body: { proveedor: nombre, categoriaPeso: 'ESTANDAR' } });
  assert.equal(r.status, 201);
  const p = await r.json();
  const c = await api(`/api/packages/${p.id}/checkin`, { method: 'PATCH', token: ctx.tOp, body: { categoriaPeso: 'ESTANDAR' } });
  assert.equal(c.status, 200);
  return { id: p.id, pin: (await leer(p.id)).pin };
}

test('setup', { skip }, async () => {
  ({ prisma } = await import('../db.js'));
  ({ runWithTenant } = await import('../tenantContext.js'));
  ({ createApp } = await import('../../app.js'));
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(PWD, 10);
  await limpiar();
  ctx.A = (await prisma.conjunto.create({
    data: { nombre: SLUG, slug: SLUG, codigoInvitacion: `${SLUG}-cod`, operadorNombre: 'Op', operadorWhatsapp: '573000000000', operadorDomicilio: 'Dir', puntoRecepcion: 'Recepción' },
  })).id;
  const user = (email, role, apto) => enA(() => crearUsuarioDeContexto(prisma, {
    data: { email, passwordHash: hash, role, nombre: email, telefono: '1', torre: 'T1', apto, termsAcceptedAt: new Date() },
  }));
  await user('op@pl.local', 'OPERATOR', null);
  await user('res@pl.local', 'RESIDENT', '101');
  const app = createApp();
  await new Promise((resolve) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  ctx.tOp = (await (await loginHttp('op@pl.local')).json()).token;
  ctx.tRes = (await (await loginHttp('res@pl.local')).json()).token;
});

test('5 fallos bloquean (423) aunque luego llegue el PIN correcto; mensajes y details', { skip }, async () => {
  const p = await nuevoPaquete('bloqueo');
  for (let i = 1; i <= 4; i++) {
    const r = await entregar(p.id, malo(p.pin));
    assert.equal(r.status, 400);
    const b = await r.json();
    assert.equal(b.code, 'PIN_INCORRECTO');
    assert.equal(b.details.intentosRestantes, 5 - i);
    assert.match(b.message, /^PIN incorrecto\. Te quedan \d intentos?\.$/);
  }
  const quinto = await entregar(p.id, malo(p.pin));
  assert.equal(quinto.status, 423);
  const b5 = await quinto.json();
  assert.equal(b5.code, 'PIN_BLOQUEADO');
  assert.equal(b5.details.minutosRestantes, 15);
  assert.equal(b5.message, 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.');

  const conCorrecto = await entregar(p.id, p.pin);
  assert.equal(conCorrecto.status, 423, 'bloqueado incluso con el PIN correcto');
  const fila = await leer(p.id);
  assert.equal(fila.estado, 'EN_RECEPCION');
  assert.equal(fila.intentosPin, 5, 'un intento bloqueado no cuenta');
  assert.ok(fila.pinBloqueadoHasta > new Date());
});

test('tras expirar el bloqueo se puede entregar y el contador queda en 0', { skip }, async () => {
  const p = await nuevoPaquete('expira');
  for (let i = 0; i < 5; i++) await entregar(p.id, malo(p.pin));
  await enA(() => prisma.package.update({ where: { id: p.id }, data: { pinBloqueadoHasta: new Date(Date.now() - 1000) } }));
  const ok = await entregar(p.id, p.pin);
  assert.equal(ok.status, 200);
  const fila = await leer(p.id);
  assert.equal(fila.estado, 'ENTREGADO');
  assert.equal(fila.intentosPin, 0);
  assert.equal(fila.pinBloqueadoHasta, null);
});

test('tras expirar, un fallo arranca la cuenta en 1 (no re-bloquea)', { skip }, async () => {
  const p = await nuevoPaquete('expira-fallo');
  for (let i = 0; i < 5; i++) await entregar(p.id, malo(p.pin));
  await enA(() => prisma.package.update({ where: { id: p.id }, data: { pinBloqueadoHasta: new Date(Date.now() - 1000) } }));
  const r = await entregar(p.id, malo(p.pin));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).details.intentosRestantes, 4);
});

test('acertar resetea los fallos previos', { skip }, async () => {
  const p = await nuevoPaquete('reset');
  for (let i = 0; i < 3; i++) await entregar(p.id, malo(p.pin));
  assert.equal((await leer(p.id)).intentosPin, 3);
  assert.equal((await entregar(p.id, p.pin)).status, 200);
  assert.equal((await leer(p.id)).intentosPin, 0);
});

test('dos fallos concurrentes cuentan 2', { skip }, async () => {
  const p = await nuevoPaquete('concurrente');
  const rs = await Promise.all([entregar(p.id, malo(p.pin)), entregar(p.id, malo(p.pin))]);
  assert.deepEqual(rs.map((r) => r.status), [400, 400]);
  assert.equal((await leer(p.id)).intentosPin, 2);
  // Una ráfaga de 5 concurrentes termina bloqueando exactamente en 5.
  const q = await nuevoPaquete('rafaga');
  await Promise.all(Array.from({ length: 5 }, () => entregar(q.id, malo(q.pin))));
  const f = await leer(q.id);
  assert.equal(f.intentosPin, 5);
  assert.ok(f.pinBloqueadoHasta > new Date());
});

test('el contador persiste aunque la transacción de entrega se revierta', { skip }, async () => {
  const { registrarIntentoPin } = await import('../../services/pin.service.js');
  const p = await nuevoPaquete('rollback');
  // Fallo registrado fuera de la tx; luego una tx que lanza: el fallo sigue.
  await enA(() => registrarIntentoPin(prisma, p.id, false));
  await assert.rejects(() => enA(() => prisma.$transaction(async (tx) => {
    await tx.package.updateMany({ where: { id: p.id }, data: { notas: 'x' } });
    throw new Error('revertir');
  })));
  const f = await leer(p.id);
  assert.equal(f.intentosPin, 1);
  assert.equal(f.notas, null);
  // Por HTTP: el fallo queda guardado aunque la respuesta sea un error.
  const r = await entregar(p.id, malo(p.pin));
  assert.equal(r.status, 400);
  assert.equal((await leer(p.id)).intentosPin, 2);
});

test('login: el 11.º intento fallido desde la misma IP responde 429 DEMASIADOS_INTENTOS', { skip }, async () => {
  const { crearLimitadorMemoria } = await import('../../domain/limitador.js');
  const app2 = createApp({ limitadorLogin: crearLimitadorMemoria({ max: 10, ventanaMs: 15 * 60 * 1000 }) });
  const srv = await new Promise((res) => { const s = app2.listen(0, () => res(s)); });
  try {
    const url = `http://127.0.0.1:${srv.address().port}/api/auth/login`;
    const intentar = (password, extra = {}) => fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json', ...extra },
      body: JSON.stringify({ email: 'op@pl.local', password }),
    });
    for (let i = 0; i < 10; i++) assert.equal((await intentar('mala')).status, 401);
    const r = await intentar('mala');
    assert.equal(r.status, 429);
    const b = await r.json();
    assert.equal(b.code, 'DEMASIADOS_INTENTOS');
    assert.equal(b.details.minutosRestantes, 15);
    assert.ok(r.headers.get('retry-after'));
    // Bloqueado también con la contraseña correcta.
    assert.equal((await intentar(PWD)).status, 429);
    // Un X-Forwarded-For del cliente no sirve para evadirlo (trust proxy off en local).
    assert.equal((await intentar(PWD, { 'x-forwarded-for': '9.9.9.9' })).status, 429);
  } finally {
    await new Promise((res) => srv.close(res));
  }
});

async function conAppLimitada(fn) {
  const { crearLimitadorMemoria } = await import('../../domain/limitador.js');
  const app2 = createApp({ limitadorLogin: crearLimitadorMemoria({ max: 10, ventanaMs: 15 * 60 * 1000 }) });
  const srv = await new Promise((res) => { const s = app2.listen(0, () => res(s)); });
  try { await fn(`http://127.0.0.1:${srv.address().port}/api/auth/login`); }
  finally { await new Promise((res) => srv.close(res)); }
}

test('login: ráfaga paralela de 50 intentos fallidos deja pasar como máximo 10 (el resto 429)', { skip }, async () => {
  await conAppLimitada(async (url) => {
    const rs = await Promise.all(Array.from({ length: 50 }, () => fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'op@pl.local', password: 'mala' }),
    })));
    const estados = rs.map((r) => r.status);
    const noBloqueados = estados.filter((s) => s !== 429).length;
    assert.ok(noBloqueados <= 10, `pasaron ${noBloqueados}`);
    assert.equal(noBloqueados, 10);
    assert.equal(estados.filter((s) => s === 401).length, 10);
  });
});

test('login: ráfaga paralela con la contraseña CORRECTA tampoco supera 10 y los aciertos devuelven su reserva', { skip }, async () => {
  await conAppLimitada(async (url) => {
    const intentar = (password) => fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'op@pl.local', password }),
    });
    const rs = await Promise.all(Array.from({ length: 50 }, () => intentar(PWD)));
    // Con acierto cada reserva se devuelve, así que las peticiones que llegan escalonadas pueden pasar;
    // lo que no puede ocurrir es nada distinto de 200/429.
    assert.ok(rs.every((r) => r.status === 200 || r.status === 429));
    // Los aciertos devolvieron su reserva: el cupo vuelve a estar libre...
    assert.equal((await intentar(PWD)).status, 200);
    // ...pero los fallos siguen contando: 10 fallos secuenciales bloquean aunque haya habido aciertos.
    for (let i = 0; i < 10; i++) assert.equal((await intentar('mala')).status, 401);
    assert.equal((await intentar(PWD)).status, 429);
  });
});

test('doble entrega concurrente con PIN correcto: un 200, un 409 y un solo evento ENTREGAR', { skip }, async () => {
  const p = await nuevoPaquete('doble-entrega');
  const rs = await Promise.all([entregar(p.id, p.pin), entregar(p.id, p.pin)]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  const n = await enA(() => prisma.paqueteEvento.count({ where: { paqueteId: p.id, tipo: 'ENTREGAR' } }));
  assert.equal(n, 1);
  assert.equal((await leer(p.id)).estado, 'ENTREGADO');
});

test('con la bandera de purga activa, un UPDATE sobre PaqueteEvento sigue fallando', { skip }, async () => {
  const p = await nuevoPaquete('purga-update');
  await assert.rejects(() => prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('puertaya.purga_eventos', 'on', true)`,
    prisma.$executeRaw`UPDATE "PaqueteEvento" SET "tipo" = 'X' WHERE "paqueteId" = ${p.id}`,
  ]), /solo inserción/);
  const tipos = (await enA(() => prisma.paqueteEvento.findMany({ where: { paqueteId: p.id } }))).map((e) => e.tipo);
  assert.ok(tipos.length > 0 && !tipos.includes('X'));
});

test('teardown', { skip }, async () => {
  await limpiar();
  await new Promise((res) => server.close(res));
  await prisma.$disconnect();
});
