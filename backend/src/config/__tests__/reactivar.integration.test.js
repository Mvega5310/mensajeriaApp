// Reactivar direcciones desactivadas por error (operador) contra Postgres real.
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
if (omitir) console.warn(`[reactivar.integration] OMITIDA: ${razonSkip}`);
if (!omitir && !process.env.JWT_SECRET) process.env.JWT_SECRET = 'itest-secret';
const skip = omitir && razonSkip;

let prisma, runWithTenant, createApp, crearLimitadorMemoria, crearNotificadorFake, server, base, notificador;
const S = { A: 'itrea-a', B: 'itrea-b' };
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
  await prisma.user.deleteMany({ where: { email: { endsWith: '@itrea.local' } } });
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
  await crearOperador({ conjuntoId: ctx.A, email: 'opa@itrea.local', passwordHash: hash, nombre: 'Operador', telefono: '3000000000' });
  await crearOperador({ conjuntoId: ctx.B, email: 'opb@itrea.local', passwordHash: hash, nombre: 'Operador', telefono: '3000000000' });
  notificador = crearNotificadorFake();
  const app = createApp({ notificador, limitadorConjuntos: crearLimitadorMemoria({ max: 1000, ventanaMs: 60_000 }) });
  await new Promise((resolve) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  ctx.tOpA = await login('opa@itrea.local');
  ctx.tOpB = await login('opb@itrea.local');
});


test('desactivar: el residente deja de verla y el operador no la encuentra; el operador la ve en desactivados (sin email ni teléfono completo)', { skip }, async () => {
  ctx.ana = await registrar({ email: 'ana@itrea.local', nombre: 'Ana Pérez', conjunto: S.A, torre: 'T2', apto: '304', telefono: '3001114567' });
  ctx.tAna = await login('ana@itrea.local');
  ctx.dom = (await domiciliosDe(ctx.tAna))[0];
  assert.equal((await buscar(ctx.tOpA, '304')).length, 1);
  assert.equal((await api(`/api/domicilios/${ctx.dom.id}/desactivar`, { method: 'PATCH', token: ctx.tOpA })).status, 200);
  assert.deepEqual(await domiciliosDe(ctx.tAna), []);
  assert.deepEqual(await buscar(ctx.tOpA, '304'), []);
  // La persona pierde el acceso en ese conjunto.
  const { tieneDomicilioEn } = await import('../../services/domicilio.service.js');
  assert.equal(await tieneDomicilioEn(ctx.ana, ctx.A), false);
  const l = await api('/api/domicilios/desactivados', { token: ctx.tOpA });
  assert.equal(l.status, 200);
  const lista = await l.json();
  assert.equal(lista.length, 1);
  assert.equal(lista[0].domicilioId, ctx.dom.id);
  assert.equal(lista[0].nombre, 'Ana Pérez');
  assert.equal(lista[0].etiqueta, 'T2 · 304');
  assert.equal(lista[0].telefonoFin, '4567');
  assert.ok(lista[0].desactivadoEn);
  const texto = JSON.stringify(lista);
  assert.ok(!texto.includes('@') && !texto.includes('3001114567'));
  assert.equal((await json(api('/api/domicilios/desactivados?q=304', { token: ctx.tOpA }))).length, 1);
  assert.equal((await json(api('/api/domicilios/desactivados?q=999', { token: ctx.tOpA }))).length, 0);
});

test('permisos: el residente no puede desactivar, reactivar ni listar; el operador de otro conjunto: 404 y no la ve', { skip }, async () => {
  for (const [m, p] of [['PATCH', `/api/domicilios/${ctx.dom.id}/desactivar`], ['PATCH', `/api/domicilios/${ctx.dom.id}/reactivar`], ['GET', '/api/domicilios/desactivados']]) {
    assert.equal((await api(p, { method: m, token: ctx.tAna })).status, 403, `${m} ${p}`);
    assert.equal((await api(p, { method: m })).status, 401, `${m} ${p} sin sesión`);
  }
  assert.equal((await api(`/api/domicilios/${ctx.dom.id}/reactivar`, { method: 'PATCH', token: ctx.tOpB })).status, 404);
  assert.equal((await api('/api/domicilios/no-existe/reactivar', { method: 'PATCH', token: ctx.tOpA })).status, 404);
  assert.deepEqual(await json(api('/api/domicilios/desactivados', { token: ctx.tOpB })), []);
  assert.equal((await en(ctx.A, () => prisma.domicilio.findUnique({ where: { id: ctx.dom.id } }))).activo, false, 'sigue inactiva');
});

test('reactivar: vuelve al residente y a la búsqueda, queda el evento REACTIVAR, es idempotente y la persona puede avisar', { skip }, async () => {
  const ok = await api(`/api/domicilios/${ctx.dom.id}/reactivar`, { method: 'PATCH', token: ctx.tOpA });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { id: ctx.dom.id, activo: true });
  assert.equal((await api(`/api/domicilios/${ctx.dom.id}/reactivar`, { method: 'PATCH', token: ctx.tOpA })).status, 200, 'idempotente');
  const eventos = await en(ctx.A, () => prisma.domicilioEvento.findMany({ where: { domicilioId: ctx.dom.id }, orderBy: { creadoEn: 'asc' } }));
  assert.deepEqual(eventos.map((e) => e.tipo), ['DESACTIVAR', 'REACTIVAR'], 'sin evento duplicado');
  assert.ok(eventos[1].actorId);
  assert.equal((await domiciliosDe(ctx.tAna)).length, 1);
  assert.equal((await buscar(ctx.tOpA, '304')).length, 1);
  assert.deepEqual(await json(api('/api/domicilios/desactivados', { token: ctx.tOpA })), []);
  const { tieneDomicilioEn } = await import('../../services/domicilio.service.js');
  assert.equal(await tieneDomicilioEn(ctx.ana, ctx.A), true);
  const pre = await api('/api/packages', { method: 'POST', token: ctx.tAna, body: { proveedor: 'Amazon', domicilioId: ctx.dom.id } });
  assert.equal(pre.status, 201, 'puede avisar con esa dirección');
});

test('tope: reactivar con 10 activas en el conjunto es 409 LIMITE_DIRECCIONES', { skip }, async () => {
  await api(`/api/domicilios/${ctx.dom.id}/desactivar`, { method: 'PATCH', token: ctx.tOpA });
  for (let i = 1; i <= 10; i++) {
    const r = await api('/api/domicilios', { method: 'POST', token: ctx.tAna, body: { conjunto: S.A, torre: 'T1', apto: String(100 + i) } });
    assert.equal(r.status, 201);
  }
  const r = await api(`/api/domicilios/${ctx.dom.id}/reactivar`, { method: 'PATCH', token: ctx.tOpA });
  assert.equal(r.status, 409);
  const j = await r.json();
  assert.equal(j.code, 'LIMITE_DIRECCIONES');
  assert.match(j.message, /Desactiva otra/);
  assert.equal(((await json(api('/api/domicilios/desactivados', { token: ctx.tOpA }))).length), 1, 'sigue desactivada');
  // Con una menos activa, ya se puede.
  const una = (await domiciliosDe(ctx.tAna))[0];
  await api(`/api/domicilios/${una.id}/desactivar`, { method: 'PATCH', token: ctx.tOpA });
  assert.equal((await api(`/api/domicilios/${ctx.dom.id}/reactivar`, { method: 'PATCH', token: ctx.tOpA })).status, 200);
});

test('teardown', { skip }, async () => {
  await new Promise((resolve) => server.close(resolve));
  await limpiar();
});
