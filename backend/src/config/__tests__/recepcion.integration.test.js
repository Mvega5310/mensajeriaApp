// Integración de T2.3 contra Postgres real: POST /packages/recepcion,
// PATCH /packages/:id/asignar, Idempotency-Key, maxFotos y aislamiento.
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
if (omitir) console.warn(`[recepcion.integration] OMITIDA: ${razonSkip}`);
if (!omitir && !process.env.JWT_SECRET) process.env.JWT_SECRET = 'itest-secret';
const skip = omitir && razonSkip;

let prisma, runWithTenant, createApp, server, base;
const SLUGS = ['itestr-alfa', 'itestr-beta'];
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
      await prisma.bono.deleteMany({});
      await prisma.user.deleteMany({});
    });
  }
  await prisma.conjunto.deleteMany({ where: { slug: { in: SLUGS } } });
}
function api(path, { method = 'GET', token, body, headers: extra } = {}) {
  const headers = { ...(extra ?? {}) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const login = async (email) => (await (await api('/api/auth/login', { method: 'POST', body: { email, password: PWD } })).json()).token;
const recibir = (body, { token = ctx.tOp, clave } = {}) => api('/api/packages/recepcion', {
  method: 'POST', token, body, headers: clave ? { 'Idempotency-Key': clave } : undefined,
});
const leer = (id) => enA(() => prisma.package.findUnique({ where: { id } }));
const eventos = (id) => enA(() => prisma.paqueteEvento.findMany({ where: { paqueteId: id }, orderBy: { creadoEn: 'asc' } }));
const contarPaquetes = () => enA(() => prisma.package.count());
const setConjunto = (data) => prisma.conjunto.update({ where: { id: ctx.A }, data });

// Residente con apartamento propio. `conPrevio` crea un paquete ENTREGADO anterior
// para que el apto YA NO sea primera entrega (cobra tarifa).
async function nuevoResidente({ conPrevio = false, telefono = '3001234567', enConjunto = enA, nombre } = {}) {
  n += 1;
  const bcrypt = (await import('bcryptjs')).default;
  const passwordHash = await bcrypt.hash(PWD, 4);
  const u = await enConjunto(() => prisma.user.create({
    data: {
      email: `r${n}@itestr.local`, passwordHash, role: 'RESIDENT',
      nombre: nombre ?? `Ana Prueba ${n}`, telefono, torre: 'TORRE 1', apto: String(500 + n), termsAcceptedAt: new Date(),
    },
  }));
  if (conPrevio) {
    await enConjunto(() => prisma.package.create({
      data: { residenteId: u.id, proveedor: 'previo', estado: 'ENTREGADO', pin: '0000', createdAt: new Date(Date.now() - 365 * 24 * 3600 * 1000) },
    }));
  }
  return u;
}
// Pre-alerta creada directamente (con createdAt controlado) para el residente.
const prealerta = (residenteId, { guia = 'Sin Guía', createdAt } = {}) => enA(() => prisma.package.create({
  data: { residenteId, proveedor: 'Amazon', guia, pin: '4321', estado: 'PREALERTADO', ...(createdAt ? { createdAt } : {}) },
}));

test('setup', { skip }, async () => {
  ({ prisma } = await import('../db.js'));
  ({ runWithTenant } = await import('../tenantContext.js'));
  ({ createApp } = await import('../../app.js'));
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
  await user(enA, 'op@itestr.local', 'OPERATOR');
  await user(enA, 'op2@itestr.local', 'OPERATOR');
  await user(enA, 'res@itestr.local', 'RESIDENT');
  await user(enB, 'opb@itestr.local', 'OPERATOR');
  ctx.resB = await nuevoResidente({ enConjunto: enB });
  const app = createApp();
  await new Promise((resolve) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  ctx.tOp = await login('op@itestr.local');
  ctx.tOp2 = await login('op2@itestr.local');
  ctx.tRes = await login('res@itestr.local');
});

test('con residente y pre-alerta con la misma guía (normalizada): vincula ESA, no crea otra', { skip }, async () => {
  const r = await nuevoResidente({ conPrevio: true });
  const vieja = await prealerta(r.id, { guia: 'AAA111', createdAt: new Date(Date.now() - 5000) });
  const objetivo = await prealerta(r.id, { guia: 'bb-22 2' });
  const antes = await contarPaquetes();
  const res = await recibir({ residenteId: r.id, categoriaPeso: 'ESTANDAR', guia: 'BB222', transportadora: 'Servientrega', fotos: ['data:image/png;base64,AAA'] });
  assert.equal(res.status, 201);
  const { paquete, aviso } = await res.json();
  assert.equal(paquete.id, objetivo.id);
  assert.equal(paquete.estado, 'EN_RECEPCION');
  assert.equal(paquete.nombre, r.nombre);
  assert.equal(paquete.motivoCobro, 'TARIFA');
  assert.equal(paquete.costo, 4500);
  assert.equal(paquete.pin, '4321'); // conserva el PIN de la pre-alerta
  assert.ok(paquete.recibidoEn);
  assert.ok(aviso.texto.includes('4321'));
  assert.equal(await contarPaquetes(), antes);
  assert.equal((await leer(vieja.id)).estado, 'PREALERTADO');
  const db = await leer(objetivo.id);
  assert.equal(db.transportadora, 'Servientrega');
  assert.equal(db.guia, 'bb-22 2'); // la guía ya existente no se pisa
  assert.deepEqual(JSON.parse(db.fotoUrl), ['data:image/png;base64,AAA']);
  const ev = await eventos(objetivo.id);
  assert.deepEqual(ev.map((e) => [e.tipo, e.deEstado, e.aEstado]), [['RECIBIR', 'PREALERTADO', 'EN_RECEPCION']]);
  assert.equal(ev[0].datos.conPrealerta, true);
});

test('con residente y pre-alerta sin guía coincidente: vincula la más antigua', { skip }, async () => {
  const r = await nuevoResidente({ conPrevio: true });
  const antigua = await prealerta(r.id, { guia: 'XXX', createdAt: new Date(Date.now() - 60000) });
  await prealerta(r.id, { guia: 'YYY' });
  const res = await recibir({ residenteId: r.id, categoriaPeso: 'MANO', guia: 'ZZZ' });
  const { paquete } = await res.json();
  assert.equal(paquete.id, antigua.id);
  assert.equal(paquete.costo, 3000);
  // la guía que trae el operador no pisa una existente, pero sí rellena una "Sin Guía"
  const r2 = await nuevoResidente({ conPrevio: true });
  const sinGuia = await prealerta(r2.id);
  await recibir({ residenteId: r2.id, categoriaPeso: 'MANO', guia: 'NUEVA9' });
  assert.equal((await leer(sinGuia.id)).guia, 'NUEVA9');
});

test('con residente sin pre-alerta: crea EN_RECEPCION (evento RECIBIR con deEstado null) y se entrega luego con su PIN', { skip }, async () => {
  const r = await nuevoResidente({ conPrevio: true });
  const res = await recibir({ residenteId: r.id, categoriaPeso: 'VOLUMEN' });
  assert.equal(res.status, 201);
  const { paquete } = await res.json();
  assert.equal(paquete.estado, 'EN_RECEPCION');
  assert.equal(paquete.costo, 7000);
  assert.match(paquete.pin, /^\d{4}$/);
  const db = await leer(paquete.id);
  assert.equal(db.proveedor, 'Sin especificar');
  assert.equal(db.guia, 'Sin Guía');
  assert.equal(db.pin, paquete.pin);
  assert.equal(db.residenteId, r.id);
  const ev = await eventos(paquete.id);
  assert.deepEqual(ev.map((e) => [e.tipo, e.deEstado, e.aEstado]), [['RECIBIR', null, 'EN_RECEPCION']]);
  // entrega con el PIN
  const mal = await api(`/api/packages/${paquete.id}/confirm-delivery`, { method: 'POST', token: ctx.tOp, body: { pin: paquete.pin === '0000' ? '1111' : '0000' } });
  assert.equal(mal.status, 400);
  const ok = await api(`/api/packages/${paquete.id}/confirm-delivery`, { method: 'POST', token: ctx.tOp, body: { pin: paquete.pin } });
  assert.equal(ok.status, 200);
  assert.equal((await leer(paquete.id)).estado, 'ENTREGADO');
});

test('cortesía de primera entrega del apto se aplica en recepción directa (y no en la segunda)', { skip }, async () => {
  const r = await nuevoResidente();
  const a = await (await recibir({ residenteId: r.id, categoriaPeso: 'PESADO' })).json();
  assert.equal(a.paquete.motivoCobro, 'CORTESIA');
  assert.equal(a.paquete.costo, 0);
  const b = await (await recibir({ residenteId: r.id, categoriaPeso: 'PESADO' })).json();
  assert.equal(b.paquete.motivoCobro, 'TARIFA');
  assert.equal(b.paquete.costo, 12000);
});

test('bono: se consume de forma atómica (2 recepciones simultáneas, 1 crédito)', { skip }, async () => {
  const r = await nuevoResidente({ conPrevio: true });
  await enA(() => prisma.bono.create({ data: { residenteId: r.id, categoriaPeso: 'ESTANDAR', cantidadTotal: 1, precioPagado: 4000 } }));
  await setConjunto({ bonosHabilitados: true });
  try {
    const rs = await Promise.all([1, 2].map(() => recibir({ residenteId: r.id, categoriaPeso: 'ESTANDAR' })));
    assert.deepEqual(rs.map((x) => x.status), [201, 201]);
    const motivos = (await Promise.all(rs.map((x) => x.json()))).map((x) => x.paquete.motivoCobro).sort();
    assert.deepEqual(motivos, ['BONO', 'TARIFA']);
    const bono = await enA(() => prisma.bono.findFirst({ where: { residenteId: r.id } }));
    assert.equal(bono.cantidadUsada, 1);
    const conBono = await enA(() => prisma.package.findMany({ where: { residenteId: r.id, bonoId: { not: null } } }));
    assert.equal(conBono.length, 1);
    assert.equal(conBono[0].costoServicio, 0);
  } finally { await setConjunto({ bonosHabilitados: false }); }
});

test('sin residente: SIN_ASIGNAR con etiqueta, sin cobro, PIN guardado pero no devuelto, aviso null', { skip }, async () => {
  const res = await recibir({ etiquetaNombre: '  Carlos Pérez  ', categoriaPeso: 'ESTANDAR', transportadora: 'Coordinadora' });
  assert.equal(res.status, 201);
  const { paquete, aviso } = await res.json();
  assert.equal(paquete.estado, 'SIN_ASIGNAR');
  assert.equal(paquete.nombre, 'Carlos Pérez');
  assert.equal(paquete.etiquetaNombre, 'Carlos Pérez');
  assert.equal(paquete.costo, null);
  assert.equal(paquete.pin, null);
  assert.equal(aviso, null);
  const db = await leer(paquete.id);
  assert.equal(db.residenteId, null);
  assert.equal(db.costoServicio, 0);
  assert.match(db.pin, /^\d{4}$/);
  const ev = await eventos(paquete.id);
  assert.deepEqual(ev.map((e) => [e.tipo, e.deEstado, e.aEstado]), [['RECIBIR_SIN_DUENO', null, 'SIN_ASIGNAR']]);
  // listado filtrado por estado, sin pin ni fotoUrl
  const lista = await (await api('/api/packages?estado=SIN_ASIGNAR', { token: ctx.tOp })).json();
  const fila = lista.find((p) => p.id === paquete.id);
  assert.ok(fila);
  assert.ok(lista.every((p) => p.estado === 'SIN_ASIGNAR'));
  assert.equal(fila.etiquetaNombre, 'Carlos Pérez');
  assert.ok(!('pin' in fila) && !('fotoUrl' in fila));
  assert.equal((await api('/api/packages?estado=NOPE', { token: ctx.tOp })).status, 400);
});

test('sin residente y sin etiquetaNombre: 400; categoría inválida: 400', { skip }, async () => {
  const a = await recibir({ categoriaPeso: 'ESTANDAR' });
  assert.equal(a.status, 400);
  assert.equal((await a.json()).code, 'DATOS_INVALIDOS');
  assert.equal((await recibir({ etiquetaNombre: 'X', categoriaPeso: 'GIGANTE' })).status, 400);
});

test('asignar: SIN_ASIGNAR -> EN_RECEPCION con cobro, evento ASIGNAR y aviso; repetirlo da 409', { skip }, async () => {
  const sin = (await (await recibir({ etiquetaNombre: 'Sin dueño', categoriaPeso: 'ESTANDAR' })).json()).paquete;
  const r = await nuevoResidente({ conPrevio: true });
  const res = await api(`/api/packages/${sin.id}/asignar`, { method: 'PATCH', token: ctx.tOp, body: { residenteId: r.id } });
  assert.equal(res.status, 200);
  const { paquete, aviso } = await res.json();
  assert.equal(paquete.estado, 'EN_RECEPCION');
  assert.equal(paquete.residenteId, r.id);
  assert.equal(paquete.costo, 4500);
  assert.equal(paquete.motivoCobro, 'TARIFA');
  assert.match(paquete.pin, /^\d{4}$/);
  assert.ok(aviso.waUrl.startsWith('https://wa.me/573001234567?text='));
  assert.deepEqual((await eventos(sin.id)).map((e) => e.tipo), ['RECIBIR_SIN_DUENO', 'ASIGNAR']);
  assert.equal((await api(`/api/packages/${sin.id}/asignar`, { method: 'PATCH', token: ctx.tOp, body: { residenteId: r.id } })).status, 409);
  // con cortesía si es la primera del apto
  const sin2 = (await (await recibir({ etiquetaNombre: 'Otro', categoriaPeso: 'PESADO' })).json()).paquete;
  const r2 = await nuevoResidente();
  const a2 = await (await api(`/api/packages/${sin2.id}/asignar`, { method: 'PATCH', token: ctx.tOp, body: { residenteId: r2.id } })).json();
  assert.equal(a2.paquete.motivoCobro, 'CORTESIA');
  assert.equal(a2.paquete.costo, 0);
});

test('asignar: residente de otro conjunto 404, falta residenteId 400, paquete ya recibido 409 sin gastar bono', { skip }, async () => {
  const sin = (await (await recibir({ etiquetaNombre: 'Z', categoriaPeso: 'MANO' })).json()).paquete;
  const otro = await api(`/api/packages/${sin.id}/asignar`, { method: 'PATCH', token: ctx.tOp, body: { residenteId: ctx.resB.id } });
  assert.equal(otro.status, 404);
  assert.equal((await otro.json()).code, 'NO_ENCONTRADO');
  assert.equal((await leer(sin.id)).estado, 'SIN_ASIGNAR');
  assert.equal((await api(`/api/packages/${sin.id}/asignar`, { method: 'PATCH', token: ctx.tOp, body: {} })).status, 400);
  const r = await nuevoResidente({ conPrevio: true });
  const directo = (await (await recibir({ residenteId: r.id, categoriaPeso: 'MANO' })).json()).paquete;
  assert.equal((await api(`/api/packages/${directo.id}/asignar`, { method: 'PATCH', token: ctx.tOp, body: { residenteId: r.id } })).status, 409);
  assert.equal((await api(`/api/packages/no-existe/asignar`, { method: 'PATCH', token: ctx.tOp, body: { residenteId: r.id } })).status, 404);
});

test('idempotencia: misma clave -> mismo paquete y 1 sola fila; otra clave u otro operador -> otro', { skip }, async () => {
  const r = await nuevoResidente({ conPrevio: true });
  const body = { residenteId: r.id, categoriaPeso: 'ESTANDAR' };
  const antes = await contarPaquetes();
  const a = await recibir(body, { clave: 'clave-uno' });
  const b = await recibir(body, { clave: 'clave-uno' });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(b.headers.get('idempotent-replayed'), 'true');
  assert.equal(a.headers.get('idempotent-replayed'), null);
  const ja = await a.json();
  const jb = await b.json();
  assert.deepEqual(jb, ja);
  assert.equal(await contarPaquetes(), antes + 1);
  const c = await (await recibir(body, { clave: 'clave-dos' })).json();
  assert.notEqual(c.paquete.id, ja.paquete.id);
  const d = await (await recibir(body, { clave: 'clave-uno', token: ctx.tOp2 })).json();
  assert.notEqual(d.paquete.id, ja.paquete.id);
  assert.equal(await contarPaquetes(), antes + 3);
  assert.equal((await recibir(body, { clave: 'x'.repeat(129) })).status, 400);
});

test('idempotencia: reintentos simultáneos crean un solo paquete (y el bono se gasta una vez)', { skip }, async () => {
  const r = await nuevoResidente({ conPrevio: true });
  await enA(() => prisma.bono.create({ data: { residenteId: r.id, categoriaPeso: 'ESTANDAR', cantidadTotal: 3, precioPagado: 1 } }));
  await setConjunto({ bonosHabilitados: true });
  try {
    const antes = await contarPaquetes();
    const rs = await Promise.all([1, 2, 3, 4].map(() => recibir({ residenteId: r.id, categoriaPeso: 'ESTANDAR' }, { clave: 'carrera' })));
    assert.ok(rs.every((x) => x.status === 201));
    const ids = new Set((await Promise.all(rs.map((x) => x.json()))).map((x) => x.paquete.id));
    assert.equal(ids.size, 1);
    assert.equal(await contarPaquetes(), antes + 1);
    assert.equal((await enA(() => prisma.bono.findFirst({ where: { residenteId: r.id } }))).cantidadUsada, 1);
  } finally { await setConjunto({ bonosHabilitados: false }); }
});

test('idempotencia: una clave de más de 24 h ya no protege', { skip }, async () => {
  const r = await nuevoResidente({ conPrevio: true });
  const body = { residenteId: r.id, categoriaPeso: 'MANO' };
  const a = (await (await recibir(body, { clave: 'vieja' })).json()).paquete;
  await enA(() => prisma.claveIdempotencia.updateMany({ where: { clave: 'vieja' }, data: { creadoEn: new Date(Date.now() - 25 * 3600 * 1000) } }));
  const b = await recibir(body, { clave: 'vieja' });
  assert.equal(b.status, 201);
  assert.notEqual((await b.json()).paquete.id, a.id);
});

test('aislamiento y roles: residente de otro conjunto 404; RESIDENT 403; sin token 401', { skip }, async () => {
  const otro = await recibir({ residenteId: ctx.resB.id, categoriaPeso: 'MANO' });
  assert.equal(otro.status, 404);
  assert.equal((await otro.json()).code, 'NO_ENCONTRADO');
  assert.equal(await enB(() => prisma.package.count()), 0);
  // un id de OPERATOR del conjunto tampoco sirve como residente
  const op = await enA(() => prisma.user.findFirst({ where: { role: 'OPERATOR' } }));
  assert.equal((await recibir({ residenteId: op.id, categoriaPeso: 'MANO' })).status, 404);
  assert.equal((await recibir({ etiquetaNombre: 'x', categoriaPeso: 'MANO' }, { token: ctx.tRes })).status, 403);
  assert.equal((await api('/api/packages/recepcion', { method: 'POST', body: {} })).status, 401);
  assert.equal((await api('/api/packages/x/asignar', { method: 'PATCH', token: ctx.tRes, body: { residenteId: 'y' } })).status, 403);
  // las claves de idempotencia están aisladas por conjunto (modelo con tenant)
  assert.equal(await enB(() => prisma.claveIdempotencia.count()), 0);
});

test('maxFotos del conjunto se respeta en recepción y en checkin', { skip }, async () => {
  const r = await nuevoResidente({ conPrevio: true });
  const foto = 'data:image/png;base64,AAA';
  await setConjunto({ maxFotos: 1 });
  try {
    const dos = await recibir({ residenteId: r.id, categoriaPeso: 'MANO', fotos: [foto, foto] });
    assert.equal(dos.status, 400);
    assert.equal((await dos.json()).message, 'Puedes adjuntar hasta 1 foto. Quita las que sobren e intenta de nuevo.');
    assert.equal((await recibir({ residenteId: r.id, categoriaPeso: 'MANO', fotos: [foto] })).status, 201);
    const pre = await prealerta(r.id);
    const ck = (f) => api(`/api/packages/${pre.id}/checkin`, { method: 'PATCH', token: ctx.tOp, body: { categoriaPeso: 'MANO', fotos: f } });
    assert.equal((await ck([foto, foto])).status, 400);
    assert.equal((await ck([foto])).status, 200);
  } finally { await setConjunto({ maxFotos: 3 }); }
  // con 3 (default), 4 fotos fallan y 3 pasan
  const f4 = Array(4).fill(foto);
  assert.equal((await recibir({ residenteId: r.id, categoriaPeso: 'MANO', fotos: f4 })).status, 400);
  assert.equal((await recibir({ residenteId: r.id, categoriaPeso: 'MANO', fotos: f4.slice(0, 3) })).status, 201);
  const pre2 = await prealerta(r.id);
  const ck4 = await api(`/api/packages/${pre2.id}/checkin`, { method: 'PATCH', token: ctx.tOp, body: { categoriaPeso: 'MANO', fotos: f4 } });
  assert.equal(ck4.status, 400);
  assert.equal((await ck4.json()).message, 'Puedes adjuntar hasta 3 fotos. Quita las que sobren e intenta de nuevo.');
});

test('listados de operador y residente siguen sin fotoUrl', { skip }, async () => {
  const r = await nuevoResidente({ conPrevio: true });
  await recibir({ residenteId: r.id, categoriaPeso: 'MANO', fotos: ['data:image/png;base64,AAA'] });
  const todos = await (await api('/api/packages', { token: ctx.tOp })).json();
  assert.ok(todos.length > 0);
  assert.ok(todos.every((p) => !('fotoUrl' in p) && !('pin' in p)));
});

test('waUrl usa el prefijoPais del conjunto; sin teléfono => waUrl null (el aviso sigue)', { skip }, async () => {
  const r = await nuevoResidente({ conPrevio: true, nombre: 'María José Gómez', telefono: '300 123-4567' });
  await setConjunto({ prefijoPais: '1' });
  try {
    const { paquete, aviso } = await (await recibir({ residenteId: r.id, categoriaPeso: 'ESTANDAR' })).json();
    assert.ok(aviso.waUrl.startsWith('https://wa.me/13001234567?text='));
    const texto = decodeURIComponent(aviso.waUrl.split('?text=')[1]);
    assert.equal(texto, aviso.texto);
    assert.ok(texto.startsWith('Hola María, llegó tu paquete a portería (Paquete estándar).'));
    assert.ok(texto.includes(paquete.pin));
  } finally { await setConjunto({ prefijoPais: '57' }); }
  const sinTel = await nuevoResidente({ conPrevio: true, telefono: '' });
  const { aviso } = await (await recibir({ residenteId: sinTel.id, categoriaPeso: 'ESTANDAR' })).json();
  assert.equal(aviso.waUrl, null);
  assert.ok(aviso.texto.length > 0);
});

test('teardown', { skip }, async () => {
  await new Promise((resolve) => server.close(resolve));
  await limpiar();
  await prisma.$disconnect();
});
