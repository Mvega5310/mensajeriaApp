// Integración de las correcciones de la revisión F2 contra Postgres real:
// cortesía única por apartamento (escenario del lunes/martes y carrera), clave
// normalizada "T2" = "TORRE 2", PIN fuera de las respuestas al operador, bloqueo
// por paquete en lote y presupuesto de fotos en el JSON.

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
if (omitir) console.warn(`[revisionF2.integration] OMITIDA: ${razonSkip}`);
if (!omitir && !process.env.JWT_SECRET) process.env.JWT_SECRET = 'itest-secret';
const skip = omitir && razonSkip;

let prisma, runWithTenant, createApp, server, base;
const SLUG = 'itestf2-alfa';
const PWD = 'Password1';
const ctx = {};
const enA = (fn) => runWithTenant({ conjuntoId: ctx.A, role: 'OPERATOR' }, fn);
let n = 0;

async function limpiar() {
  const conjuntos = await prisma.conjunto.findMany({ where: { slug: SLUG } });
  for (const c of conjuntos) {
    await purgarEventos(prisma, c.id);
    await runWithTenant({ conjuntoId: c.id, role: 'OPERATOR' }, async () => {
      await prisma.package.deleteMany({});
      await prisma.user.deleteMany({});
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
const recibir = (body) => api('/api/packages/recepcion', { method: 'POST', token: ctx.tOp, body });
const leer = (id) => enA(() => prisma.package.findUnique({ where: { id } }));
const asignar = (id, residenteId) => api(`/api/packages/${id}/asignar`, { method: 'PATCH', token: ctx.tOp, body: { residenteId } });

let hash;
async function residente({ torre, apto, nombre } = {}) {
  n += 1;
  return enA(() => prisma.user.create({
    data: {
      email: `r${n}@itestf2.local`, passwordHash: hash, role: 'RESIDENT', nombre: nombre ?? `Res F2 ${n}`,
      telefono: '3001234567', torre, apto, termsAcceptedAt: new Date(),
    },
  }));
}
const motivo = async (res) => (await res.json()).paquete.motivoCobro;

test('setup', { skip }, async () => {
  ({ prisma } = await import('../db.js'));
  ({ runWithTenant } = await import('../tenantContext.js'));
  ({ createApp } = await import('../../app.js'));
  hash = (await import('bcryptjs')).default.hashSync(PWD, 4);
  await limpiar();
  ctx.A = (await prisma.conjunto.create({
    data: { nombre: SLUG, slug: SLUG, codigoInvitacion: `${SLUG}-cod`, operadorNombre: 'Op', operadorWhatsapp: '573000000000', operadorDomicilio: 'Dir', puntoRecepcion: 'Recepción' },
  })).id;
  await enA(() => prisma.user.create({
    data: { email: 'op@itestf2.local', passwordHash: hash, role: 'OPERATOR', nombre: 'Op', telefono: '3000000000', termsAcceptedAt: new Date() },
  }));
  await new Promise((resolve) => { server = createApp().listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  ctx.tOp = (await (await api('/api/auth/login', { method: 'POST', body: { email: 'op@itestf2.local', password: PWD } })).json()).token;
});

test('escenario de la revisión: SIN_ASIGNAR del lunes asignado DESPUÉS de que el martes se llevó la cortesía => TARIFA', { skip }, async () => {
  const r = await residente({ torre: 'TORRE 3', apto: '301' });
  const lunes = (await (await recibir({ etiquetaNombre: 'Lunes', categoriaPeso: 'ESTANDAR' })).json()).paquete;
  const martes = await (await recibir({ residenteId: r.id, categoriaPeso: 'ESTANDAR' })).json();
  assert.equal(martes.paquete.motivoCobro, 'CORTESIA');
  const a = await (await asignar(lunes.id, r.id)).json();
  assert.equal(a.paquete.motivoCobro, 'TARIFA');
  assert.equal(a.paquete.costo, 4500);
  // El listado marca como "Primera vez" SOLO al del martes.
  const lista = await (await api('/api/packages', { token: ctx.tOp })).json();
  assert.equal(lista.find((p) => p.id === martes.paquete.id).esPrimeraEntrega, true);
  assert.equal(lista.find((p) => p.id === lunes.id).esPrimeraEntrega, false);
  // El CSV es coherente.
  const csv = await (await api('/api/packages/export', { token: ctx.tOp })).text();
  assert.equal((csv.match(/Primera entrega/g) || []).length >= 1, true);
  const filaLunes = csv.split('\r\n').find((l) => l.startsWith(lunes.id));
  assert.ok(!filaLunes.includes('Primera entrega'));
});

test('SIN_ASIGNAR asignado primero (nadie más cobrado) SÍ se lleva la cortesía; el siguiente cobra', { skip }, async () => {
  const r = await residente({ torre: 'TORRE 3', apto: '302' });
  const sin = (await (await recibir({ etiquetaNombre: 'X', categoriaPeso: 'PESADO' })).json()).paquete;
  const a = await (await asignar(sin.id, r.id)).json();
  assert.equal(a.paquete.motivoCobro, 'CORTESIA');
  assert.equal(await motivo(await recibir({ residenteId: r.id, categoriaPeso: 'PESADO' })), 'TARIFA');
});

test('carrera: 5 recepciones paralelas del mismo apto nuevo => exactamente 1 CORTESIA', { skip }, async () => {
  const r = await residente({ torre: 'TORRE 4', apto: '401' });
  const rs = await Promise.all(Array.from({ length: 5 }, () => recibir({ residenteId: r.id, categoriaPeso: 'ESTANDAR' })));
  assert.deepEqual(rs.map((x) => x.status), [201, 201, 201, 201, 201]);
  const motivos = (await Promise.all(rs.map(motivo))).sort();
  assert.deepEqual(motivos, ['CORTESIA', 'TARIFA', 'TARIFA', 'TARIFA', 'TARIFA']);
  const filas = await enA(() => prisma.cortesiaApartamento.findMany({ where: { claveApto: '4|401' } }));
  assert.equal(filas.length, 1);
});

test('carrera entre dos cuentas del mismo apto ("T4" y "TORRE 4") => 1 CORTESIA', { skip }, async () => {
  const a = await residente({ torre: 'TORRE 5', apto: '501' });
  const b = await residente({ torre: 'T5', apto: '501' });
  const rs = await Promise.all([a, b, a, b].map((x) => recibir({ residenteId: x.id, categoriaPeso: 'MANO' })));
  const motivos = (await Promise.all(rs.map(motivo))).sort();
  assert.deepEqual(motivos, ['CORTESIA', 'TARIFA', 'TARIFA', 'TARIFA']);
});

test('TORRE 2/710 y T2/710 comparten cortesía y un solo lote de entrega', { skip }, async () => {
  const a = await residente({ torre: 'TORRE 2', apto: '710', nombre: 'Ana Torre' });
  const b = await residente({ torre: 'T2', apto: '710', nombre: 'Beto Te' });
  assert.equal(await motivo(await recibir({ residenteId: a.id, categoriaPeso: 'ESTANDAR' })), 'CORTESIA');
  assert.equal(await motivo(await recibir({ residenteId: b.id, categoriaPeso: 'ESTANDAR' })), 'TARIFA');
  // Lote: ambos paquetes salen juntos con el PIN de cualquiera.
  const pa = (await enA(() => prisma.package.findMany({ where: { residenteId: a.id } })))[0];
  const v = await (await api('/api/entregas/verificar-pin', { method: 'POST', token: ctx.tOp, body: { pin: pa.pin } })).json();
  assert.equal(v.paquetes.length, 2);
  // Búsqueda: ambos aparecen con la MISMA etiqueta canónica, distinguibles por nombre.
  const bus = await (await api(`/api/residentes/buscar?q=${encodeURIComponent('T2 710')}`, { token: ctx.tOp })).json();
  assert.deepEqual(bus.map((x) => x.etiqueta), ['T2 · 710', 'T2 · 710']);
  assert.deepEqual(bus.map((x) => x.nombre).sort(), ['Ana Torre', 'Beto Te']);
});

test('ninguna respuesta al operador contiene el PIN (recepción, replay, asignar, listado, entrega)', { skip }, async () => {
  const r = await residente({ torre: 'TORRE 6', apto: '601' });
  const clave = 'clave-f2-1';
  const llamar = () => fetch(`${base}/api/packages/recepcion`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ctx.tOp}`, 'Idempotency-Key': clave },
    body: JSON.stringify({ residenteId: r.id, categoriaPeso: 'ESTANDAR' }),
  });
  const r1 = await llamar();
  const j1 = await r1.json();
  const r2 = await llamar();
  assert.equal(r2.headers.get('idempotent-replayed'), 'true');
  const j2 = await r2.json();
  const pin = (await leer(j1.paquete.id)).pin;
  const sin = (await (await recibir({ etiquetaNombre: 'Y', categoriaPeso: 'MANO' })).json()).paquete;
  const asig = await (await asignar(sin.id, r.id)).json();
  const pinAsig = (await leer(sin.id)).pin;
  for (const [j, p] of [[j1, pin], [j2, pin], [asig, pinAsig]]) {
    assert.ok(!('pin' in j.paquete));
    const texto = JSON.stringify(j);
    assert.ok(!texto.includes(`"${p}"`) && !/PIN de entrega es /.test(texto));
    assert.ok(!/"pin"/.test(texto));
  }
  const lista = await (await api('/api/packages', { token: ctx.tOp })).text();
  assert.ok(!/"pin"/.test(lista));
  const v = await api('/api/entregas/verificar-pin', { method: 'POST', token: ctx.tOp, body: { pin } });
  assert.equal(v.status, 200);
  assert.ok(!/"pin"/.test(await v.text()));
});

test('lote: un PIN errado con apartamento indicado cuenta contra el bloqueo por paquete (5 => 423)', { skip }, async () => {
  const r = await residente({ torre: 'TORRE 7', apto: '701' });
  const p = await enA(() => prisma.package.create({
    data: { residenteId: r.id, proveedor: 'Amazon', pin: '7777', estado: 'EN_RECEPCION', costoServicio: 4500, recibidoEn: new Date() },
  }));
  const intento = (pin) => api('/api/entregas/verificar-pin', { method: 'POST', token: ctx.tOp, body: { pin, apto: 'T7 701' } });
  for (let i = 0; i < 4; i++) assert.equal((await intento('1111')).status, 400, `fallo ${i + 1}`);
  assert.equal((await leer(p.id)).intentosPin, 4);
  const quinto = await intento('1111');
  assert.equal(quinto.status, 423);
  assert.equal((await quinto.json()).code, 'PIN_BLOQUEADO');
  assert.equal((await intento('7777')).status, 423, 'bloqueado aunque acierte');
});

// --- Fotos: presupuesto del JSON ---
const foto = (bytes) => `data:image/jpeg;base64,${Buffer.alloc(bytes, 7).toString('base64')}`;

test('3 fotos de ~1,4 MB => 201; una de 2 MB => 413 con mensaje de la foto; 5 fotos que pasan el presupuesto => 413 por total', { skip }, async () => {
  await prisma.conjunto.update({ where: { id: ctx.A }, data: { maxFotos: 6 } });
  try {
    const r = await residente({ torre: 'TORRE 8', apto: '801' });
    const ok = await recibir({ residenteId: r.id, categoriaPeso: 'ESTANDAR', fotos: [foto(1_468_006), foto(1_468_006), foto(1_468_006)] });
    assert.equal(ok.status, 201);
    const grande = await recibir({ residenteId: r.id, categoriaPeso: 'ESTANDAR', fotos: [foto(2 * 1024 * 1024)] });
    assert.equal(grande.status, 413);
    const jg = await grande.json();
    assert.equal(jg.code, 'CARGA_DEMASIADO_GRANDE');
    assert.match(jg.message, /La foto 1 pesa demasiado/);
    const total = await recibir({ residenteId: r.id, categoriaPeso: 'ESTANDAR', fotos: Array.from({ length: 5 }, () => foto(1_300_000)) });
    assert.equal(total.status, 413);
    assert.match((await total.json()).message, /pesan demasiado en total/);
    // Fuera de las rutas con fotos, el límite sigue siendo 1 MB.
    const otra = await api('/api/comments', { method: 'POST', token: ctx.tOp, body: { mensaje: 'x'.repeat(1_200_000) } });
    assert.equal(otra.status, 413);
  } finally { await prisma.conjunto.update({ where: { id: ctx.A }, data: { maxFotos: 3 } }); }
});

test('teardown', { skip }, async () => {
  await new Promise((resolve) => server.close(resolve));
  await limpiar();
  await prisma.$disconnect();
});
