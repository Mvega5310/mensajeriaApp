// Integración de T5.1 contra Postgres real, con el almacén `fake` inyectado:
// recepción/checkin guardan en el almacén + PaqueteFoto, GET /foto devuelve URLs,
// las fotos legadas (fotoUrl base64) se siguen sirviendo, límites y fallos.

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
if (omitir) console.warn(`[fotos.integration] OMITIDA: ${razonSkip}`);
if (!omitir && !process.env.JWT_SECRET) process.env.JWT_SECRET = 'itest-secret';
const skip = omitir && razonSkip;

let prisma, runWithTenant, createApp, crearAlmacenFake, server, base, almacen;
const SLUGS = ['itestf-alfa', 'itestf-beta'];
const PWD = 'Password1';
const ctx = {};
const enA = (fn) => runWithTenant({ conjuntoId: ctx.A, role: 'OPERATOR' }, fn);
const enB = (fn) => runWithTenant({ conjuntoId: ctx.B, role: 'OPERATOR' }, fn);
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
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
function api(path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const login = async (email) => (await (await api('/api/auth/login', { method: 'POST', body: { email, password: PWD } })).json()).token;
const recibir = (body, token = ctx.tOp) => api('/api/packages/recepcion', { method: 'POST', token, body });
const contarPaquetes = () => enA(() => prisma.package.count());
async function nuevoResidente(enConjunto = enA) {
  n += 1;
  const bcrypt = (await import('bcryptjs')).default;
  const passwordHash = await bcrypt.hash(PWD, 4);
  return enConjunto(() => prisma.user.create({
    data: {
      email: `r${n}@itestf.local`, passwordHash, role: 'RESIDENT',
      nombre: `Ana ${n}`, telefono: '3001234567', torre: 'TORRE 1', apto: String(500 + n), termsAcceptedAt: new Date(),
    },
  }));
}

test('setup', { skip }, async () => {
  ({ prisma } = await import('../db.js'));
  ({ runWithTenant } = await import('../tenantContext.js'));
  ({ createApp } = await import('../../app.js'));
  ({ crearAlmacenFake } = await import('../../services/almacen/index.js'));
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(PWD, 4);
  await limpiar();
  const mk = (slug) => prisma.conjunto.create({
    data: { nombre: slug, slug, codigoInvitacion: `${slug}-cod`, operadorNombre: 'Op', operadorWhatsapp: '573000000000', operadorDomicilio: 'Dir', puntoRecepcion: 'Recepción' },
  });
  ctx.A = (await mk(SLUGS[0])).id;
  ctx.B = (await mk(SLUGS[1])).id;
  const user = (run, email, role) => run(() => prisma.user.create({
    data: { email, passwordHash: hash, role, nombre: email, telefono: '3000000000', torre: 'TORRE 9', apto: role === 'OPERATOR' ? null : '900', termsAcceptedAt: new Date() },
  }));
  await user(enA, 'op@itestf.local', 'OPERATOR');
  await user(enB, 'opb@itestf.local', 'OPERATOR');
  await user(enA, 'res@itestf.local', 'RESIDENT'); // residente ajeno a los paquetes de las pruebas
  almacen = crearAlmacenFake();
  const app = createApp({ almacenFotos: almacen });
  await new Promise((resolve) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  ctx.tOp = await login('op@itestf.local');
  ctx.tOpB = await login('opb@itestf.local');
  ctx.tAjeno = await login('res@itestf.local');
});

test('recepción con 2 fotos: 2 filas PaqueteFoto, fotoUrl vacío y GET /foto devuelve 2 URLs', { skip }, async () => {
  const r = await nuevoResidente();
  const res = await recibir({ residenteId: r.id, categoriaPeso: 'MANO', fotos: [PNG, JPG] });
  assert.equal(res.status, 201);
  const { paquete } = await res.json();
  const db = await enA(() => prisma.package.findUnique({ where: { id: paquete.id } }));
  assert.equal(db.fotoUrl, null);
  const filas = await enA(() => prisma.paqueteFoto.findMany({ where: { paqueteId: paquete.id }, orderBy: { orden: 'asc' } }));
  assert.deepEqual(filas.map((f) => [f.orden, f.tipo]), [[0, 'image/png'], [1, 'image/jpeg']]);
  assert.ok(filas.every((f) => f.clave.startsWith(`${ctx.A}/`) && almacen.objetos.has(f.clave)));

  const foto = await api(`/api/packages/${paquete.id}/foto`, { token: ctx.tOp });
  assert.equal(foto.status, 200);
  const { fotos } = await foto.json();
  assert.equal(fotos.length, 2);
  assert.deepEqual(fotos.map((f) => f.orden), [0, 1]);
  assert.ok(fotos[0].url.startsWith('data:image/png;base64,'));

  // el residente dueño la ve; otro residente no; otro conjunto tampoco
  const tDueno = await login(r.email);
  assert.equal((await api(`/api/packages/${paquete.id}/foto`, { token: tDueno })).status, 200);
  assert.equal((await api(`/api/packages/${paquete.id}/foto`, { token: ctx.tAjeno })).status, 403);
  assert.equal((await api(`/api/packages/${paquete.id}/foto`, { token: ctx.tOpB })).status, 404);
});

test('paquete legado con fotoUrl base64 se sigue sirviendo', { skip }, async () => {
  const r = await nuevoResidente();
  const p = await enA(() => prisma.package.create({
    data: { residenteId: r.id, proveedor: 'x', pin: '1111', fotoUrl: JSON.stringify([PNG, JPG]) },
  }));
  const { fotos } = await (await api(`/api/packages/${p.id}/foto`, { token: ctx.tOp })).json();
  assert.deepEqual(fotos, [{ url: PNG, orden: 0 }, { url: JPG, orden: 1 }]);
  const sinFotos = await enA(() => prisma.package.create({ data: { residenteId: r.id, proveedor: 'x', pin: '2222' } }));
  assert.deepEqual((await (await api(`/api/packages/${sinFotos.id}/foto`, { token: ctx.tOp })).json()).fotos, []);
});

test('foto demasiado grande: 413 y no se crea el paquete ni se sube nada', { skip }, async () => {
  const r = await nuevoResidente();
  const antes = await contarPaquetes();
  const objetosAntes = almacen.objetos.size;
  const grande = `data:image/jpeg;base64,${Buffer.alloc(1.6 * 1024 * 1024, 1).toString('base64')}`;
  const res = await recibir({ residenteId: r.id, categoriaPeso: 'MANO', fotos: [PNG, grande] });
  assert.equal(res.status, 413);
  assert.equal((await res.json()).code, 'CARGA_DEMASIADO_GRANDE');
  assert.equal(await contarPaquetes(), antes);
  assert.equal(almacen.objetos.size, objetosAntes);
  // tipo no admitido -> 400
  const gif = await recibir({ residenteId: r.id, categoriaPeso: 'MANO', fotos: ['data:image/gif;base64,R0lGODlh'] });
  assert.equal(gif.status, 400);
});

test('fallo del almacén: 500, sin paquete creado y sin objetos huérfanos', { skip }, async () => {
  const r = await nuevoResidente();
  const antes = await contarPaquetes();
  const objetosAntes = almacen.objetos.size;
  let llamadas = 0;
  const original = almacen.guardar;
  almacen.guardar = async (a) => { llamadas += 1; if (llamadas === 2) throw new Error('almacén caído'); return original(a); };
  try {
    const res = await recibir({ residenteId: r.id, categoriaPeso: 'MANO', fotos: [PNG, JPG] });
    assert.equal(res.status, 500);
  } finally { almacen.guardar = original; }
  assert.equal(await contarPaquetes(), antes);
  assert.equal(almacen.objetos.size, objetosAntes, 'la primera foto subida se borró');
});

test('si la transacción falla tras subir, se borran los objetos (residente inexistente)', { skip }, async () => {
  const antes = await contarPaquetes();
  const objetosAntes = almacen.objetos.size;
  const res = await recibir({ residenteId: 'no-existe', categoriaPeso: 'MANO', fotos: [PNG] });
  assert.equal(res.status, 404);
  assert.equal(await contarPaquetes(), antes);
  assert.equal(almacen.objetos.size, objetosAntes);
});

test('checkin guarda las fotos en el almacén; listados siguen sin fotos', { skip }, async () => {
  const r = await nuevoResidente();
  const pre = await enA(() => prisma.package.create({ data: { residenteId: r.id, proveedor: 'x', pin: '3333', estado: 'PREALERTADO' } }));
  const ck = await api(`/api/packages/${pre.id}/checkin`, { method: 'PATCH', token: ctx.tOp, body: { categoriaPeso: 'MANO', fotos: [PNG] } });
  assert.equal(ck.status, 200);
  assert.equal(await enA(() => prisma.paqueteFoto.count({ where: { paqueteId: pre.id } })), 1);
  assert.equal((await enA(() => prisma.package.findUnique({ where: { id: pre.id } }))).fotoUrl, null);
  const { fotos } = await (await api(`/api/packages/${pre.id}/foto`, { token: ctx.tOp })).json();
  assert.equal(fotos.length, 1);

  const lista = await (await api('/api/packages', { token: ctx.tOp })).json();
  assert.ok(lista.length > 0 && lista.every((p) => !('fotoUrl' in p) && !('fotos' in p)));
  const tDueno = await login(r.email);
  const mias = await (await api('/api/packages/mine', { token: tDueno })).json();
  assert.ok(mias.length > 0 && mias.every((p) => !('fotoUrl' in p) && !('fotos' in p)));
});

test('aislamiento: PaqueteFoto de A no es visible desde B', { skip }, async () => {
  assert.ok(await enA(() => prisma.paqueteFoto.count()) > 0);
  assert.equal(await enB(() => prisma.paqueteFoto.count()), 0);
});

test('almacén legado (producción sin bucket): sigue escribiendo fotoUrl', { skip }, async () => {
  const { crearAlmacenLegado } = await import('../../services/almacen/index.js');
  const app2 = createApp({ almacenFotos: crearAlmacenLegado() });
  const srv = await new Promise((resolve) => { const s = app2.listen(0, () => resolve(s)); });
  try {
    const url = `http://127.0.0.1:${srv.address().port}`;
    const r = await nuevoResidente();
    const res = await fetch(`${url}/api/packages/recepcion`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ctx.tOp}` },
      body: JSON.stringify({ residenteId: r.id, categoriaPeso: 'MANO', fotos: [PNG] }),
    });
    assert.equal(res.status, 201);
    const { paquete } = await res.json();
    const db = await enA(() => prisma.package.findUnique({ where: { id: paquete.id } }));
    assert.deepEqual(JSON.parse(db.fotoUrl), [PNG]);
    assert.equal(await enA(() => prisma.paqueteFoto.count({ where: { paqueteId: paquete.id } })), 0);
    const g = await fetch(`${url}/api/packages/${paquete.id}/foto`, { headers: { authorization: `Bearer ${ctx.tOp}` } });
    assert.deepEqual((await g.json()).fotos, [{ url: PNG, orden: 0 }]);
  } finally { await new Promise((resolve) => srv.close(resolve)); }
});

test('teardown', { skip }, async () => {
  await new Promise((resolve) => server.close(resolve));
  await limpiar();
  await prisma.$disconnect();
});
