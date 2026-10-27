// Integración de T3.1 contra Postgres real: enlace firmado, sesión limitada y
// aviso con URL. Mismo patrón de skip/guarda de localhost que las demás.

import test from 'node:test';
import assert from 'node:assert/strict';
import { purgarEventos } from '../../../test-support/purgarEventos.js';

const dbUrl = process.env.DATABASE_URL;
let dbHost = null;
try { dbHost = dbUrl ? new URL(dbUrl).hostname : null; } catch { dbHost = null; }
const esLocal = !!dbHost && new Set(['localhost', '127.0.0.1', '::1']).has(dbHost);
const razonSkip = !dbUrl
  ? 'DATABASE_URL no definida'
  : !esLocal
    ? `DATABASE_URL apunta a un host NO local (${dbHost}); esta prueba crea/borra datos`
    : null;
const omitir = razonSkip !== null;
if (omitir) console.warn(`[enlace.integration] OMITIDA: ${razonSkip}`);
if (!omitir && !process.env.JWT_SECRET) process.env.JWT_SECRET = 'itest-secret';
if (!omitir) process.env.FRONTEND_URL = 'https://app.itest.local/';

let prisma, runWithTenant, createApp, firmar, tokenDeResidente, secretoEnlace, jwt, server, base;
const SLUG_A = 'itestl-alfa';
const SLUG_B = 'itestl-beta';
const PWD = 'Password1';
const ctx = {};
const skip = omitir && razonSkip;

async function limpiar() {
  const conjuntos = await prisma.conjunto.findMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } });
  for (const c of conjuntos) {
    await purgarEventos(prisma, c.id);
    await runWithTenant({ conjuntoId: c.id, role: 'OPERATOR' }, async () => {
      await prisma.bono.deleteMany({});
      await prisma.package.deleteMany({});
      await prisma.user.deleteMany({});
    });
  }
  await prisma.conjunto.deleteMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } });
}

function api(path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
async function login(email) {
  const r = await api('/api/auth/login', { method: 'POST', body: { email, password: PWD } });
  return (await r.json()).token;
}
const enA = (fn) => runWithTenant({ conjuntoId: ctx.A, role: 'OPERATOR' }, fn);
const enlaceDe = (residenteId, conjuntoId, exp = Date.now() + 3600_000, secreto = secretoEnlace()) =>
  firmar({ residenteId, conjuntoId, exp }, secreto);
const abrir = (token) => api('/api/p/abrir', { method: 'POST', body: { token } });

// --- recorrido de rutas del app real (mismo aplanado que E6) ---
function recolectar(stack, prefijo, out) {
  for (const layer of stack) {
    if (layer.route) {
      const cadena = layer.route.stack.map((s) => s.handle?.name || '');
      for (const m of Object.keys(layer.route.methods)) out.push({ method: m.toUpperCase(), path: prefijo + layer.route.path, cadena });
    } else if (layer.name === 'router' && layer.handle?.stack) {
      let pre = '';
      if (!layer.regexp.fast_slash) {
        pre = layer.regexp.source.replace('^\\/', '/').replace('\\/?(?=\\/|$)', '').replace(/\\\//g, '/');
      }
      // Los router.use(mw) del router cuentan para sus rutas.
      const mws = layer.handle.stack.filter((l) => !l.route && l.name !== 'router' && l.name).map((l) => l.name);
      const sub = [];
      recolectar(layer.handle.stack, prefijo + pre, sub);
      for (const r of sub) out.push({ ...r, cadena: [...mws, ...r.cadena] });
    }
  }
}

test('setup', { skip }, async () => {
  ({ prisma } = await import('../db.js'));
  ({ runWithTenant } = await import('../tenantContext.js'));
  ({ createApp } = await import('../../app.js'));
  ({ firmar } = await import('../../domain/enlace.js'));
  ({ secretoEnlace } = await import('../env.js'));
  ({ tokenDeResidente } = await import('../../services/enlace.service.js'));
  jwt = (await import('jsonwebtoken')).default;
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(PWD, 10);

  await limpiar();
  const mk = (slug) => prisma.conjunto.create({
    data: {
      nombre: `Conjunto ${slug}`, slug, codigoInvitacion: `${slug}-cod`, operadorNombre: 'Op',
      operadorWhatsapp: '573000000000', operadorDomicilio: 'Dir', puntoRecepcion: 'Recepción',
    },
  });
  ctx.A = (await mk(SLUG_A)).id;
  ctx.B = (await mk(SLUG_B)).id;
  const user = (conjuntoId, email, role, apto) => runWithTenant({ conjuntoId, role: 'OPERATOR' }, () =>
    prisma.user.create({
      data: {
        email, passwordHash: hash, role, nombre: `Ana ${apto ?? "Op"}`, telefono: '3001112233', torre: 'T1', apto,
        termsAcceptedAt: new Date(),
      },
    }));
  ctx.opA = await user(ctx.A, 'op@la.local', 'OPERATOR', null);
  ctx.res1 = await user(ctx.A, 'r1@la.local', 'RESIDENT', '101');
  ctx.res2 = await user(ctx.A, 'r2@la.local', 'RESIDENT', '202');
  ctx.resBorrar = await user(ctx.A, 'borrar@la.local', 'RESIDENT', '303');
  ctx.resB = await user(ctx.B, 'r1@lb.local', 'RESIDENT', '101');

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
  ctx.tOp = await login('op@la.local');
  ctx.tRes1 = await login('r1@la.local');

  // Paquetes recibidos por el operador (flujo real): uno de res1, uno de res2.
  const rec = async (residenteId) => (await api('/api/packages/recepcion', {
    method: 'POST', token: ctx.tOp, body: { residenteId, categoriaPeso: 'ESTANDAR', transportadora: 'Servientrega' },
  })).json();
  ctx.recep1 = await rec(ctx.res1.id);
  ctx.recep2 = await rec(ctx.res2.id);
});

test('el aviso de recepción trae la URL firmada /p#<token> (fragmento) y NO el PIN', { skip }, async () => {
  const { aviso, paquete } = ctx.recep1;
  assert.ok(aviso, 'hay aviso');
  const m = aviso.texto.match(/https:\/\/app\.itest\.local\/p#([A-Za-z0-9_.-]+)/);
  assert.ok(m, `la URL está en el texto: ${aviso.texto}`);
  assert.ok(!aviso.texto.includes('local//p'), 'sin doble barra');
  assert.ok(!/\/p\/[A-Za-z0-9_.-]{20,}/.test(aviso.texto), 'el token ya no va en la ruta');
  assert.ok(aviso.waUrl.includes(encodeURIComponent('/p#')), 'el enlace wa.me la lleva codificada');
  assert.ok(!/PIN de entrega es /.test(aviso.texto), 'el texto del aviso no lleva el PIN');
  assert.ok(/PIN de entrega está aquí/.test(aviso.texto));
  assert.ok(!('pin' in paquete), 'la respuesta al operador no trae pin');
  assert.ok(!JSON.stringify(ctx.recep1).includes(`"pin"`));
  ctx.token1 = m[1];
  const r = await abrir(ctx.token1);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.equal((await r.json()).residente.nombre, ctx.res1.nombre);
});

test('POST /api/p/abrir sin token => 400; GET /api/p/:token ya no abre nada', { skip }, async () => {
  const r = await api('/api/p/abrir', { method: 'POST', body: {} });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, 'DATOS_INVALIDOS');
  const viejo = await api(`/api/p/${encodeURIComponent(ctx.token1)}`);
  assert.ok(viejo.status >= 400, 'el token en la ruta ya no se acepta');
  assert.ok(!(await viejo.text()).includes('"paquetes"'));
});

test('token válido: datos del residente y su conjunto, PIN visible, sin email ni teléfono', { skip }, async () => {
  const r = await abrir(ctx.token1);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const j = await r.json();
  assert.equal(j.residente.nombre, ctx.res1.nombre);
  assert.equal(j.residente.etiquetaApto, 'T1 · 101');
  assert.equal(j.conjunto.nombre, `Conjunto ${SLUG_A}`);
  assert.equal(j.paquetes.length, 1);
  const p = j.paquetes[0];
  assert.equal(p.id, ctx.recep1.paquete.id);
  assert.equal(p.estado, 'EN_RECEPCION');
  assert.equal(p.pin, (await enA(() => prisma.package.findUnique({ where: { id: p.id } }))).pin);
  assert.match(p.pin, /^\d{4,6}$/);
  assert.equal(p.transportadora, 'Servientrega');
  assert.ok(p.motivoCobro);
  assert.ok(p.recibidoEn);
  assert.ok(Array.isArray(j.franjasEntrega) && j.franjasEntrega.length > 0);
  assert.deepEqual(j.metodosPago, ['EFECTIVO', 'TRANSFERENCIA']);
  assert.ok(j.sesion);
  const crudo = JSON.stringify(j);
  assert.ok(!crudo.includes('r1@la.local') && !crudo.includes('3001112233'), 'no filtra email ni teléfono');
  assert.ok(!('fotoUrl' in p));
  const claims = jwt.verify(j.sesion, process.env.JWT_SECRET);
  assert.equal(claims.scope, 'enlace');
  assert.equal(claims.sub, ctx.res1.id);
  assert.equal(claims.conjuntoId, ctx.A);
  assert.ok(claims.exp - claims.iat <= 2 * 3600);
  ctx.sesion1 = j.sesion;
});

test('vencido, alterado, basura y secreto ajeno: 401', { skip }, async () => {
  const vencido = await abrir(enlaceDe(ctx.res1.id, ctx.A, Date.now() - 1000));
  assert.equal(vencido.status, 401);
  assert.equal((await vencido.json()).code, 'ENLACE_VENCIDO');

  const [v, , firma] = ctx.token1.split('.');
  const otro = Buffer.from(JSON.stringify({ r: ctx.res2.id, c: ctx.A, e: Date.now() + 3600_000 })).toString('base64url');
  const alterado = await abrir(`${v}.${otro}.${firma}`);
  assert.equal(alterado.status, 401);
  assert.equal((await alterado.json()).code, 'ENLACE_INVALIDO');

  for (const basura of ['basura', 'a.b.c', 'v1..', 'x'.repeat(2000)]) {
    const r = await abrir(basura);
    assert.equal(r.status, 401, basura);
    assert.equal((await r.json()).code, 'ENLACE_INVALIDO');
  }
  const ajeno = await abrir(enlaceDe(ctx.res1.id, ctx.A, Date.now() + 3600_000, 'otro-secreto-'.repeat(4)));
  assert.equal(ajeno.status, 401);
});

test('token con conjuntoId manipulado: re-firmado con otro secreto 401; firmado válido pero de otro conjunto 404 sin fuga', { skip }, async () => {
  const manipulado = await abrir(enlaceDe(ctx.res1.id, ctx.B, Date.now() + 3600_000, 'atacante-'.repeat(6)));
  assert.equal(manipulado.status, 401);

  // Aun con firma legítima, un residente de A no existe dentro del tenant B.
  const cruzado = await abrir(enlaceDe(ctx.res1.id, ctx.B));
  assert.equal(cruzado.status, 404);
  const texto = await cruzado.text();
  assert.ok(!texto.includes(ctx.res1.nombre));
});

test('residente borrado o que no es RESIDENT: 404', { skip }, async () => {
  const tk = enlaceDe(ctx.resBorrar.id, ctx.A);
  assert.equal((await abrir(tk)).status, 200);
  await enA(() => prisma.user.delete({ where: { id: ctx.resBorrar.id } }));
  assert.equal((await abrir(tk)).status, 404);

  const operador = await abrir(enlaceDe(ctx.opA.id, ctx.A));
  assert.equal(operador.status, 404);
});

test('sesión limitada: refresca paquetes con GET /api/p/paquetes', { skip }, async () => {
  const r = await api('/api/p/paquetes', { token: ctx.sesion1 });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.paquetes.length, 1);
  assert.equal(j.sesion, undefined);
  assert.equal(j.paquetes[0].id, ctx.recep1.paquete.id);
});

test('sesión limitada: programa SU paquete; el de otro residente da 404', { skip }, async () => {
  const franja = (await (await abrir(ctx.token1)).json()).franjasEntrega[0];
  const ok = await api(`/api/packages/${ctx.recep1.paquete.id}/schedule`, {
    method: 'PATCH', token: ctx.sesion1, body: { franjaHoraria: franja, metodoPagoServicio: 'EFECTIVO' },
  });
  assert.equal(ok.status, 200);
  const j = await ok.json();
  assert.equal(j.estado, 'PROGRAMADO');
  assert.equal(j.franjaHoraria, franja);

  const ajeno = await api(`/api/packages/${ctx.recep2.paquete.id}/schedule`, {
    method: 'PATCH', token: ctx.sesion1, body: { franjaHoraria: franja, metodoPagoServicio: 'EFECTIVO' },
  });
  assert.equal(ajeno.status, 404);
  const intacto = await enA(() => prisma.package.findUnique({ where: { id: ctx.recep2.paquete.id } }));
  assert.equal(intacto.estado, 'EN_RECEPCION');
});

test('sesión limitada: TODAS las demás rutas del app real responden 403', { skip }, async () => {
  const rutas = [];
  recolectar(createApp()._router.stack, '', rutas);
  assert.ok(rutas.length >= 15, `rutas halladas: ${rutas.length}`);
  const permitidas = new Set(['GET /api/p/paquetes', 'PATCH /api/packages/:id/schedule']);
  let probadas = 0;
  for (const r of rutas) {
    if (!r.cadena.includes('requireAuth')) continue; // públicas: no usan sesión
    const clave = `${r.method} ${r.path.replace(/\/+/g, '/')}`;
    if (permitidas.has(clave)) continue;
    const url = r.path.replace(/:[A-Za-z]+/g, 'x');
    const res = await api(url, { method: r.method, token: ctx.sesion1, body: r.method === 'GET' ? undefined : {} });
    assert.equal(res.status, 403, `${clave} debía rechazar la sesión de enlace (devolvió ${res.status})`);
    probadas += 1;
  }
  assert.ok(probadas >= 12, `rutas autenticadas probadas: ${probadas}`);
  // Mismo método/otra ruta cercana y lectura de foto propia: también 403.
  const foto = await api(`/api/packages/${ctx.recep1.paquete.id}/foto`, { token: ctx.sesion1 });
  assert.equal(foto.status, 403);
  const schedGet = await api(`/api/packages/${ctx.recep1.paquete.id}/schedule`, { token: ctx.sesion1 });
  assert.equal(schedGet.status, 403);
});

test('sesión limitada vencida, o con conjunto que no corresponde: 401', { skip }, async () => {
  const vencida = jwt.sign({ sub: ctx.res1.id, role: 'RESIDENT', conjuntoId: ctx.A, scope: 'enlace' }, process.env.JWT_SECRET, { expiresIn: -10 });
  assert.equal((await api('/api/p/paquetes', { token: vencida })).status, 401);
  const cruzada = jwt.sign({ sub: ctx.res1.id, role: 'RESIDENT', conjuntoId: ctx.B, scope: 'enlace' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  assert.equal((await api('/api/p/paquetes', { token: cruzada })).status, 401);
  const scopeRaro = jwt.sign({ sub: ctx.res1.id, role: 'RESIDENT', conjuntoId: ctx.A, scope: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  assert.equal((await api('/api/p/paquetes', { token: scopeRaro })).status, 403);
});

test('la sesión normal (login) sigue funcionando en las mismas rutas', { skip }, async () => {
  assert.equal((await api('/api/packages/mine', { token: ctx.tRes1 })).status, 200);
  assert.equal((await api('/api/p/paquetes', { token: ctx.tRes1 })).status, 200);
  const tokenSinScope = tokenDeResidente({ residenteId: ctx.res1.id, conjuntoId: ctx.A });
  assert.equal((await abrir(tokenSinScope)).status, 200);
});

test('limpieza', { skip }, async () => {
  server.close();
  await limpiar();
  await prisma.$disconnect();
});
