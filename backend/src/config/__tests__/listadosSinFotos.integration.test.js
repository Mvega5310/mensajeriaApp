// Regresión de la revisión final (T8.1, hallazgo A1 + M1 + M2) contra Postgres real.
//
// CLAUDE.md: "Fotos fuera de los listados". Una foto legada en base64 pesa cientos
// de KB por fila; leerla de la base en cada listado repite la caída de producción
// aunque luego se descarte en JS. Aquí se siembra un paquete con una foto de ~500 KB
// y se comprueba, en TODAS las lecturas de listado:
//   1. ninguna respuesta contiene `fotoUrl` ni `data:image`;
//   2. la CONSULTA no selecciona la columna (se espía `prisma.package.findMany/
//      findUnique/findFirst`, el MISMO objeto que usan los controladores: cada
//      llamada debe llevar `select` explícito sin `fotoUrl`).
// Además: CSV sin inyección de fórmulas (M1) y filtros de fecha válidos (M2).

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
if (omitir) console.warn(`[listadosSinFotos.integration] OMITIDA: ${razonSkip}`);
if (!omitir && !process.env.JWT_SECRET) process.env.JWT_SECRET = 'itest-secret';
if (!omitir) process.env.FRONTEND_URL = 'https://app.itest.local';
const skip = omitir && razonSkip;

let prisma, runWithTenant, createApp, tokenDeResidente, server, base;
const SLUG = 'itestf-fotos';
const PWD = 'Password1';
const ctx = {};
const FOTO = `["data:image/png;base64,${'A'.repeat(500_000)}"]`; // ~500 KB
const enConjunto = (conjuntoId, fn) => runWithTenant({ conjuntoId, role: 'OPERATOR' }, fn);
const enA = (fn) => enConjunto(ctx.A, fn);

async function limpiar() {
  const c = await prisma.conjunto.findUnique({ where: { slug: SLUG } });
  if (!c) return;
  await purgarEventos(prisma, c.id);
  await enConjunto(c.id, async () => {
    await prisma.package.deleteMany({});
    await prisma.user.deleteMany({});
  });
  await prisma.conjunto.deleteMany({ where: { slug: SLUG } });
}

async function api(path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(`${base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* CSV */ }
  return { status: r.status, texto, body: json };
}
const login = async (email) => (await api('/api/auth/login', { method: 'POST', body: { email, password: PWD } })).body.token;

// Espía las lecturas de Package del cliente extendido.
const llamadas = [];
const originales = {};
function espiar() {
  for (const m of ['findMany', 'findUnique', 'findFirst']) {
    originales[m] = prisma.package[m];
    prisma.package[m] = function espia(args) {
      llamadas.push({ m, args });
      return originales[m].call(this, args);
    };
  }
}
function soltar() {
  for (const m of Object.keys(originales)) prisma.package[m] = originales[m];
}
function sinFoto(texto, donde) {
  assert.ok(!texto.includes('data:image'), `${donde}: la respuesta trae una foto`);
  assert.ok(!texto.includes('fotoUrl'), `${donde}: la respuesta trae fotoUrl`);
  assert.ok(texto.length < 100_000, `${donde}: respuesta de ${texto.length} bytes`);
}

test('setup', { skip }, async () => {
  ({ prisma } = await import('../db.js'));
  ({ runWithTenant } = await import('../tenantContext.js'));
  ({ createApp } = await import('../../app.js'));
  ({ tokenDeResidente } = await import('../../services/enlace.service.js'));
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(PWD, 4);
  await limpiar();
  ctx.A = (await prisma.conjunto.create({
    data: {
      nombre: 'Fotos', slug: SLUG, codigoInvitacion: `${SLUG}-cod`, operadorNombre: 'Op', operadorWhatsapp: '573000000000',
      operadorDomicilio: 'Dir', puntoRecepcion: 'Recepción',
    },
  })).id;
  const user = (email, role, nombre, torre, apto) => enA(() => prisma.user.create({
    data: { email, passwordHash: hash, role, nombre, telefono: '3001112222', torre, apto, termsAcceptedAt: new Date() },
  }));
  ctx.op = await user('op@f.local', 'OPERATOR', 'Operador', null, null);
  ctx.ana = await user('ana@f.local', 'RESIDENT', '=HYPERLINK("http://x")', 'TORRE 2', '304');
  ctx.beto = await user('beto@f.local', 'RESIDENT', 'Beto', 'TORRE 2', '304'); // mismo apto que Ana
  const pkg = (residenteId, data) => enA(() => prisma.package.create({
    data: { residenteId, proveedor: 'Tienda', pin: '4321', fotoUrl: FOTO, ...data },
  }));
  ctx.pEnRecepcion = await pkg(ctx.ana.id, { estado: 'EN_RECEPCION', recibidoEn: new Date(), notas: '@cmd|calc' });
  ctx.pBeto = await pkg(ctx.beto.id, { estado: 'PROGRAMADO', recibidoEn: new Date(), pin: '1111' });
  ctx.pEntrega = await pkg(ctx.beto.id, { estado: 'EN_RECEPCION', recibidoEn: new Date(), pin: '9999' });
  ctx.pPrealerta = await pkg(ctx.ana.id, { estado: 'PREALERTADO' });
  ctx.pSinDueno = await pkg(null, { estado: 'SIN_ASIGNAR', recibidoEn: new Date(), etiquetaNombre: 'Doña Marta' });
  server = await new Promise((resolve) => { const s = createApp().listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  ctx.tOp = await login('op@f.local');
  ctx.tAna = await login('ana@f.local');
  const abierto = await api('/api/p/abrir', { method: 'POST', body: { token: tokenDeResidente({ residenteId: ctx.ana.id, conjuntoId: ctx.A }) } });
  ctx.tEnlace = abierto.body.sesion;
});

test('verificar-pin: el lote sigue siendo por apartamento (el PIN de Ana trae también lo de Beto)', { skip }, async () => {
  const r = await api('/api/entregas/verificar-pin', { method: 'POST', token: ctx.tOp, body: { pin: '4321' } });
  assert.equal(r.status, 200, r.texto.slice(0, 200));
  const ids = r.body.paquetes.map((p) => p.id);
  assert.ok(ids.includes(ctx.pEnRecepcion.id));
  assert.ok(ids.includes(ctx.pBeto.id), 'el paquete PROGRAMADO de otra cuenta del mismo apto entra al lote');
  assert.ok(!ids.includes(ctx.pPrealerta.id), 'una pre-alerta no es entregable');
});

test('ningún listado ni lectura devuelve fotoUrl / data:image, y ninguna consulta selecciona la columna', { skip }, async () => {
  // Control: la foto SÍ está en la base (la prueba no pasa en vacío).
  const crudo = await enA(() => prisma.package.findUnique({ where: { id: ctx.pEnRecepcion.id }, select: { fotoUrl: true } }));
  assert.ok(crudo.fotoUrl.length > 400_000);
  espiar();
  const lecturas = [];
  try {
    const rutas = [
      ['GET /packages', () => api('/api/packages', { token: ctx.tOp })],
      ['GET /packages paginado', () => api('/api/packages?pagina=1&porPagina=10', { token: ctx.tOp })],
      ['GET /packages?estado', () => api('/api/packages?estado=EN_RECEPCION', { token: ctx.tOp })],
      ['GET /packages/mine', () => api('/api/packages/mine', { token: ctx.tAna })],
      ['GET /packages/export', () => api('/api/packages/export', { token: ctx.tOp })],
      ['GET /packages/:id', () => api(`/api/packages/${ctx.pEnRecepcion.id}`, { token: ctx.tOp })],
      ['GET /packages/resumen', () => api('/api/packages/resumen', { token: ctx.tOp })],
      ['POST /entregas/verificar-pin', () => api('/api/entregas/verificar-pin', { method: 'POST', token: ctx.tOp, body: { pin: '4321' } })],
      ['verificar-pin con apto', () => api('/api/entregas/verificar-pin', { method: 'POST', token: ctx.tOp, body: { pin: '4321', apto: 'T2 304' } })],
      ['verificar-pin incorrecto con apto', () => api('/api/entregas/verificar-pin', { method: 'POST', token: ctx.tOp, body: { pin: '0000', apto: '304' } })],
      ['GET /p/paquetes (sesión de enlace)', () => api('/api/p/paquetes', { token: ctx.tEnlace })],
      ['POST /p/abrir', () => api('/api/p/abrir', { method: 'POST', body: { token: tokenDeResidente({ residenteId: ctx.ana.id, conjuntoId: ctx.A }) } })],
      ['PATCH /packages/:id/asignar', () => api(`/api/packages/${ctx.pSinDueno.id}/asignar`, { method: 'PATCH', token: ctx.tOp, body: { residenteId: ctx.beto.id } })],
      ['POST /packages/recepcion (vincula la pre-alerta)', () => api('/api/packages/recepcion', {
        method: 'POST', token: ctx.tOp, body: { residenteId: ctx.ana.id, categoriaPeso: 'ESTANDAR' },
      })],
      ['PATCH /packages/:id/schedule', () => api(`/api/packages/${ctx.pEnRecepcion.id}/schedule`, {
        method: 'PATCH', token: ctx.tAna, body: { modalidad: 'RECOGER' },
      })],
      ['POST /packages/:id/confirm-delivery', () => api(`/api/packages/${ctx.pEntrega.id}/confirm-delivery`, {
        method: 'POST', token: ctx.tOp, body: { pin: '9999' },
      })],
    ];
    for (const [nombre, f] of rutas) {
      const r = await f();
      assert.ok(r.status < 500, `${nombre}: ${r.status} ${r.texto.slice(0, 200)}`);
      sinFoto(r.texto, nombre);
      lecturas.push([nombre, r.status]);
    }
  } finally {
    soltar();
  }
  assert.ok(llamadas.length >= 10, `se espiaron ${llamadas.length} consultas`);
  for (const { m, args } of llamadas) {
    const q = JSON.stringify(args)?.slice(0, 200);
    assert.ok(args?.select, `Package.${m} sin select explícito (trae fotoUrl): ${q}`);
    assert.ok(!args.select.fotoUrl, `Package.${m} selecciona fotoUrl: ${q}`);
    assert.equal(args.include, undefined, `Package.${m} con include: ${q}`);
  }
  // listAll en particular: ni fotoUrl ni pin (el operador nunca ve el PIN) en el select.
  const listAll = llamadas.find((c) => c.m === 'findMany' && c.args.select.residente && c.args.select.bono);
  assert.ok(listAll, 'se espió la consulta de listAll');
  assert.equal(listAll.args.select.pin, undefined);
  assert.equal(listAll.args.select.fotoUrl, undefined);
  // La ruta de la foto sigue sirviéndola aparte (única que la lee).
  const foto = await api(`/api/packages/${ctx.pEnRecepcion.id}/foto`, { token: ctx.tOp });
  assert.equal(foto.status, 200);
  assert.ok(foto.texto.includes('data:image'));
});

test('M1: el CSV neutraliza celdas que empiezan por = + - @ tab o CR', { skip }, async () => {
  const csv = (await api('/api/packages/export', { token: ctx.tOp })).texto;
  assert.ok(csv.includes("'=HYPERLINK"), 'nombre con fórmula prefijado con apóstrofo');
  assert.ok(csv.includes("'@cmd|calc"), 'notas con @ prefijadas');
  assert.ok(!/(^|,)=HYPERLINK/m.test(csv), 'ninguna celda arranca con =');
  assert.ok(!csv.includes('data:image'));
  // El escape de comillas se mantiene (el nombre lleva comillas dobles).
  assert.ok(csv.includes('"\'=HYPERLINK(""http://x"")"'), csv.slice(0, 600));
  const { csvEscape } = await import('../../controllers/packages.controller.js');
  for (const peligro of ['=1+1', '+57300', '-2+3', '@SUM(A1)', '\tx', '\rx']) {
    assert.ok(csvEscape(peligro).replace(/^"/, '').startsWith("'"), `${JSON.stringify(peligro)} => ${csvEscape(peligro)}`);
  }
  assert.equal(csvEscape(-5), '-5', 'un número negativo NO es texto');
  assert.equal(csvEscape('hola'), 'hola');
  assert.equal(csvEscape('a,b'), '"a,b"');
  assert.equal(csvEscape(null), '');
});

test('M2: filtros de fecha del CSV con hora de Bogotá; inválidos => 400 DATOS_INVALIDOS', { skip }, async () => {
  for (const q of ['desde=basura', 'hasta=2026-02-31', 'desde=32/13/2026', 'hasta=nunca']) {
    const r = await api(`/api/packages/export?${q}`, { token: ctx.tOp });
    assert.equal(r.status, 400, q);
    assert.equal(r.body.code, 'DATOS_INVALIDOS', JSON.stringify(r.body));
  }
  // Hoy (día de Bogotá) incluye los paquetes sembrados; un día de 2020 no.
  const dia = new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
  const hoy = await api(`/api/packages/export?desde=${dia}&hasta=${dia}`, { token: ctx.tOp });
  assert.equal(hoy.status, 200);
  assert.ok(hoy.texto.includes('Tienda'));
  const viejo = await api('/api/packages/export?desde=2020-01-01&hasta=2020-01-02', { token: ctx.tOp });
  assert.equal(viejo.status, 200);
  assert.ok(!viejo.texto.includes('Tienda'));
});

test('teardown', { skip }, async () => {
  soltar();
  if (server) await new Promise((r) => server.close(r));
  await limpiar();
});
