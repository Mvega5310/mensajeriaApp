// Integración de T2.7 contra Postgres real: GET /packages/resumen, GET /packages/:id,
// bitácora filtrable/paginada de GET /packages y búsqueda con torre por prefijo.

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
if (omitir) console.warn(`[contratosOperador.integration] OMITIDA: ${razonSkip}`);
if (!omitir && !process.env.JWT_SECRET) process.env.JWT_SECRET = 'itest-secret';
if (!omitir) process.env.FRONTEND_URL = 'https://app.itest.local';
const skip = omitir && razonSkip;

let prisma, runWithTenant, createApp, server, base;
const SLUGS = ['itestc-alfa', 'itestc-beta'];
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
      await prisma.bono.deleteMany({});
      await prisma.domicilio.deleteMany({});
      await prisma.user.deleteMany({ where: { conjuntoId: c.id } });
    });
  }
  await prisma.conjunto.deleteMany({ where: { slug: { in: SLUGS } } });
}
async function api(path, { token } = {}) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const r = await fetch(`${base}${path}`, { headers });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const login = async (email) => {
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PWD }),
  });
  return (await r.json()).token;
};
const hace = (ms) => new Date(Date.now() - ms);
const H = 3600 * 1000;

test('setup', { skip }, async () => {
  ({ prisma } = await import('../db.js'));
  ({ runWithTenant } = await import('../tenantContext.js'));
  ({ createApp } = await import('../../app.js'));
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(PWD, 4);
  await limpiar();
  const mk = (slug) => prisma.conjunto.create({
    data: {
      nombre: slug, slug, codigoInvitacion: `${slug}-cod`, operadorNombre: 'Op', operadorWhatsapp: '573000000000',
      operadorDomicilio: 'Dir', puntoRecepcion: 'Recepción',
    },
  });
  ctx.A = (await mk(SLUGS[0])).id;
  ctx.B = (await mk(SLUGS[1])).id;
  const user = (conjuntoId, email, role, nombre, torre, apto) => runWithTenant({ conjuntoId, role: 'OPERATOR' }, () =>
    crearUsuarioDeContexto(prisma, {
      data: { email, passwordHash: hash, role, nombre, telefono: '3001112222', torre, apto, termsAcceptedAt: new Date() },
    }));
  ctx.op = await user(ctx.A, 'op@rc-a.local', 'OPERATOR', 'Operador', null, null);
  ctx.opB = await user(ctx.B, 'op@rc-b.local', 'OPERATOR', 'Operador B', null, null);
  ctx.ana = await user(ctx.A, 'ana@rc-a.local', 'RESIDENT', 'Ana Gómez', 'TORRE 2', '304');
  ctx.beto = await user(ctx.A, 'beto@rc-a.local', 'RESIDENT', 'Beto Ruiz', 'TORRE 2', '301');
  ctx.cami = await user(ctx.A, 'cami@rc-a.local', 'RESIDENT', 'Cami Soto', 'TORRE 3', '305');
  ctx.anaB = await user(ctx.B, 'ana@rc-b.local', 'RESIDENT', 'Ana Gómez', 'TORRE 2', '304');

  const pkg = (enC, residenteId, data) => enC(() => prisma.package.create({
    data: { residenteId, proveedor: 'X', pin: '123456', fotoUrl: '["data:image/png;base64,AAAA"]', ...data },
  }));
  // Conjunto A
  ctx.p1 = await pkg(enA, ctx.ana.id, { estado: 'EN_RECEPCION', recibidoEn: new Date(), guia: 'GUIA-111' });
  ctx.p2 = await pkg(enA, ctx.beto.id, { estado: 'PROGRAMADO', recibidoEn: new Date() });
  ctx.p3 = await pkg(enA, ctx.ana.id, {
    estado: 'ENTREGADO', recibidoEn: hace(30 * H), fechaEntrega: new Date(), createdAt: hace(30 * H),
  });
  ctx.p4 = await pkg(enA, null, { estado: 'SIN_ASIGNAR', recibidoEn: new Date(), etiquetaNombre: 'Doña Marta' });
  ctx.p5 = await pkg(enA, ctx.cami.id, { estado: 'PREALERTADO', createdAt: hace(10 * 24 * H) });
  // Entregado ayer (no cuenta en "entregados hoy")
  ctx.p6 = await pkg(enA, ctx.cami.id, {
    estado: 'ENTREGADO', recibidoEn: hace(60 * H), fechaEntrega: hace(40 * H), createdAt: hace(60 * H),
  });
  // Conjunto B: no debe aparecer en nada de A
  await pkg(enB, ctx.anaB.id, { estado: 'EN_RECEPCION', recibidoEn: new Date(), guia: 'GUIA-111' });
  await pkg(enB, null, { estado: 'SIN_ASIGNAR', recibidoEn: new Date() });

  server = await new Promise((resolve) => { const s = createApp().listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  ctx.tOp = await login('op@rc-a.local');
  ctx.tOpB = await login('op@rc-b.local');
  ctx.tRes = await login('ana@rc-a.local');
});

test('resumen: cuentas del día de Bogotá y aislamiento', { skip }, async () => {
  const { status, body } = await api('/api/packages/resumen', { token: ctx.tOp });
  assert.equal(status, 200);
  assert.deepEqual(body, { hoy: { recibidos: 3, entregados: 1 }, porEntregar: 2, sinAsignar: 1 });
  const b = await api('/api/packages/resumen', { token: ctx.tOpB });
  assert.deepEqual(b.body, { hoy: { recibidos: 2, entregados: 0 }, porEntregar: 1, sinAsignar: 1 });
});

test('resumen: el límite del día es la medianoche de Bogotá (05:00 UTC)', { skip }, async () => {
  const { rangoHoyBogota } = await import('../../domain/fechas.js');
  const { inicio } = rangoHoyBogota();
  const antes = await api('/api/packages/resumen', { token: ctx.tOp });
  // 1 minuto antes de la medianoche de Bogotá de HOY queda fuera; 1 minuto después, dentro.
  const ayer = await enA(() => prisma.package.create({
    data: { residenteId: ctx.ana.id, proveedor: 'X', pin: '1', estado: 'EN_RECEPCION', recibidoEn: new Date(inicio.getTime() - 60000) },
  }));
  const hoy = await enA(() => prisma.package.create({
    data: { residenteId: ctx.ana.id, proveedor: 'X', pin: '1', estado: 'EN_RECEPCION', recibidoEn: new Date(inicio.getTime() + 60000) },
  }));
  const despues = await api('/api/packages/resumen', { token: ctx.tOp });
  assert.equal(despues.body.hoy.recibidos, antes.body.hoy.recibidos + 1);
  assert.equal(despues.body.porEntregar, antes.body.porEntregar + 2);
  await enA(() => prisma.package.deleteMany({ where: { id: { in: [ayer.id, hoy.id] } } }));
});

test('resumen: el residente recibe 403 y sin sesión 401', { skip }, async () => {
  assert.equal((await api('/api/packages/resumen', { token: ctx.tRes })).status, 403);
  assert.equal((await api('/api/packages/resumen')).status, 401);
});

test('GET /packages/:id: operador sí, mismo shape que la recepción, sin pin ni fotos, aviso con /p#', { skip }, async () => {
  const { status, body } = await api(`/api/packages/${ctx.p1.id}`, { token: ctx.tOp });
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body).sort(), ['aviso', 'paquete']);
  assert.equal(body.paquete.id, ctx.p1.id);
  assert.equal(body.paquete.nombre, 'Ana Gómez');
  assert.equal(body.paquete.etiquetaApto, 'T2 · 304');
  assert.equal(body.paquete.guia, 'GUIA-111');
  assert.match(body.aviso.texto, /https:\/\/app\.itest\.local\/p#/);
  assert.match(body.aviso.waUrl, /^https:\/\/wa\.me\//);
  const crudo = JSON.stringify(body);
  assert.ok(!crudo.includes('123456'), 'sin PIN');
  assert.ok(!crudo.includes('base64'), 'sin fotos');
  assert.ok(!('pin' in body.paquete) && !('fotoUrl' in body.paquete));
  assert.equal(body.aviso.enlace, undefined);
});

test('GET /packages/:id: sin dueño no trae aviso; residente 403; otro conjunto y desconocido 404', { skip }, async () => {
  const sd = await api(`/api/packages/${ctx.p4.id}`, { token: ctx.tOp });
  assert.equal(sd.status, 200);
  assert.equal(sd.body.aviso, null);
  assert.equal(sd.body.paquete.etiquetaNombre, 'Doña Marta');
  assert.equal((await api(`/api/packages/${ctx.p1.id}`, { token: ctx.tRes })).status, 403);
  assert.equal((await api(`/api/packages/${ctx.p1.id}`, { token: ctx.tOpB })).status, 404);
  assert.equal((await api('/api/packages/no-existe', { token: ctx.tOp })).status, 404);
});

test('búsqueda con torre por prefijo: "T2 30" -> 301 y 304 de la torre 2', { skip }, async () => {
  const r = await api(`/api/residentes/buscar?q=${encodeURIComponent('T2 30')}`, { token: ctx.tOp });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.map((x) => x.id), [ctx.beto.id, ctx.ana.id]);
  const t3 = await api(`/api/residentes/buscar?q=${encodeURIComponent('T3 30')}`, { token: ctx.tOp });
  assert.deepEqual(t3.body.map((x) => x.id), [ctx.cami.id]);
  const nada = await api(`/api/residentes/buscar?q=${encodeURIComponent('T2 35')}`, { token: ctx.tOp });
  assert.deepEqual(nada.body, []);
});

test('bitácora: sin pagina sigue devolviendo un arreglo, sin pin ni fotos', { skip }, async () => {
  const { status, body } = await api('/api/packages', { token: ctx.tOp });
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
  assert.equal(body.length, 6);
  for (const p of body) assert.ok(!('pin' in p) && !('fotoUrl' in p));
  assert.ok(!JSON.stringify(body).includes('123456'));
});

test('bitácora: paginación { items, total, pagina, porPagina }', { skip }, async () => {
  const p1 = await api('/api/packages?pagina=1&porPagina=4', { token: ctx.tOp });
  assert.equal(p1.status, 200);
  assert.equal(p1.body.total, 6);
  assert.equal(p1.body.pagina, 1);
  assert.equal(p1.body.porPagina, 4);
  assert.equal(p1.body.items.length, 4);
  const p2 = await api('/api/packages?pagina=2&porPagina=4', { token: ctx.tOp });
  assert.equal(p2.body.items.length, 2);
  const ids = [...p1.body.items, ...p2.body.items].map((p) => p.id);
  assert.equal(new Set(ids).size, 6);
  for (const p of ids.length ? [...p1.body.items, ...p2.body.items] : []) assert.ok(!('pin' in p) && !('fotoUrl' in p));
  const def = await api('/api/packages?pagina=1', { token: ctx.tOp });
  assert.equal(def.body.porPagina, 20);
  for (const q of ['pagina=0', 'pagina=x', 'pagina=1&porPagina=101', 'pagina=1&porPagina=0']) {
    assert.equal((await api(`/api/packages?${q}`, { token: ctx.tOp })).status, 400, q);
  }
});

test('bitácora: filtros por estado, fecha (recibidoEn o createdAt) y q', { skip }, async () => {
  const dia = (d) => d.toISOString().slice(0, 10);
  const ids = async (qs) => (await api(`/api/packages?${qs}`, { token: ctx.tOp })).body.map((p) => p.id).sort();
  assert.deepEqual(await ids('estado=SIN_ASIGNAR'), [ctx.p4.id]);
  assert.equal((await api('/api/packages?estado=NOPE', { token: ctx.tOp })).status, 400);
  // Varios estados separados por coma (Pendientes pide solo los abiertos).
  assert.deepEqual((await ids('estado=SIN_ASIGNAR,PREALERTADO')).sort(), [ctx.p4.id, ctx.p5.id].sort());
  assert.equal((await api('/api/packages?estado=SIN_ASIGNAR,NOPE', { token: ctx.tOp })).status, 400);

  // Fecha efectiva: la pre-alerta de hace 10 días entra por createdAt, no los recibidos hoy.
  const hace10 = new Date(Date.now() - 10 * 24 * H);
  assert.deepEqual(await ids(`desde=${dia(hace10)}&hasta=${dia(hace10)}`), [ctx.p5.id]);
  // "hasta" sin "desde" y todo el día incluido: hoy en Bogotá.
  const hoyBogota = new Date(Date.now() - 5 * H);
  const soloHoy = await ids(`desde=${dia(hoyBogota)}&hasta=${dia(hoyBogota)}`);
  assert.deepEqual(soloHoy, [ctx.p1.id, ctx.p2.id, ctx.p4.id].sort());
  assert.equal((await api('/api/packages?desde=ayer', { token: ctx.tOp })).status, 400);

  // q: apto con prefijo, torre+apto, nombre, guía y etiqueta.
  assert.deepEqual(await ids('q=304'), [ctx.p1.id, ctx.p3.id].sort());
  assert.deepEqual(await ids('q=T2%2030'), [ctx.p1.id, ctx.p2.id, ctx.p3.id].sort());
  assert.deepEqual(await ids('q=beto'), [ctx.p2.id]);
  assert.deepEqual(await ids('q=guia-111'), [ctx.p1.id]);
  assert.deepEqual(await ids('q=marta'), [ctx.p4.id]);
  // Combinados + paginado: total refleja el filtro y no se cuela el otro conjunto.
  const c = await api('/api/packages?pagina=1&porPagina=10&q=guia-111&estado=EN_RECEPCION', { token: ctx.tOp });
  assert.equal(c.body.total, 1);
  assert.equal((await api('/api/packages', { token: ctx.tRes })).status, 403);
});

test('teardown', { skip }, async () => {
  await new Promise((r) => server.close(r));
  await limpiar();
  await prisma.$disconnect();
});
