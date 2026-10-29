// Auditorías de invariantes como pruebas estáticas (KAN-8, Fase E — E7).
// Autónoma: solo lee archivos de backend/src y backend/prisma, no toca BD ni
// importa @prisma/client. Runner: node:test. Ejecutar: npm test
//
// Falla si:
//  1. se abre el scope GLOBAL_LOOKUP fuera de buscarUsuarioPorEmailSinTenant()
//     (archivo controllers/auth.controller.js);
//  2. aparece una consulta cruda ($queryRaw/$executeRaw/$queryRawUnsafe/
//     $executeRawUnsafe) fuera de la LISTA BLANCA (ver ARCHIVOS_RAW_PERMITIDOS);
//  3. hay más de un `new PrismaClient(` en el código de producción;
//  4. (S1.1) se accede a `User` (`prisma.user`/`tx.user`/`cliente.user`) fuera de
//     services/usuario.service.js (y de buscarUsuarioPorEmailSinTenant en auth.controller.js);
//  5. (S1.2) se accede a `UsuarioConjunto` fuera de services/domicilio.service.js;
//  6. (S1.1) un modelo de schema.prisma con `conjuntoId` no está en MODELOS_CON_TENANT
//     salvo las dos excepciones documentadas (User y UsuarioConjunto), o al revés.
//
// ÁMBITO: se escanea backend/src, backend/prisma Y backend/scripts (Fase F: los
// scripts de alta/backfill también son código de producción que puede escribir).
//
// LISTA BLANCA de consultas crudas (regla 2), explícita y acotada:
//   - config/tenantBootstrap.js        -> resolverConjuntoIdPorUsuario() (bootstrap del tenant)
//   - scripts/lib/asignarConjuntoALegado.js -> backfill de legado (Fase F): necesita SQL
//     crudo porque la extensión no puede ver/filtrar filas con conjuntoId NULL.
//     Nombres de tabla en literales fijos; valores siempre como parámetros.
//
// EXCLUSIONES (documentadas): se excluyen las carpetas __tests__ en las tres
// reglas, porque las pruebas pueden: construir contextos GLOBAL_LOOKUP con fakes,
// nombrar los métodos crudos en aserciones/comentarios, o incluir el literal
// `new PrismaClient(` dentro de un regex de auditoría (como este mismo archivo).
// Ninguno de esos casos es código de producción. Además, en las reglas 1 y 2 se
// ignoran las líneas de comentario que documentan la invariante.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(aqui, '..', '..', '..'); // .../backend
const SRC = join(BACKEND, 'src');
const PRISMA = join(BACKEND, 'prisma');
const SCRIPTS = join(BACKEND, 'scripts');

// Lista blanca de archivos que SÍ pueden usar consultas crudas (regla 2).
// Rutas relativas a backend/, con separador del SO.
const ARCHIVOS_RAW_PERMITIDOS = [
  join('src', 'config', 'tenantBootstrap.js'),
  join('scripts', 'lib', 'asignarConjuntoALegado.js'),
];

function archivosJs(dir, { incluirTests }) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!incluirTests && entry === '__tests__') continue;
      if (entry === 'node_modules') continue;
      out.push(...archivosJs(full, { incluirTests }));
    } else if (/\.(js|mjs|cjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const rel = (f) => relative(BACKEND, f);

// --- Regla 1: GLOBAL_LOOKUP solo en auth.controller.js ---
test('E7.1: GLOBAL_LOOKUP se abre solo en buscarUsuarioPorEmailSinTenant (auth.controller.js)', () => {
  const archivos = [...archivosJs(SRC, { incluirTests: false }), ...archivosJs(PRISMA, { incluirTests: false }), ...archivosJs(SCRIPTS, { incluirTests: false })];
  const ofensores = [];
  for (const f of archivos) {
    const lineas = readFileSync(f, 'utf8').split('\n');
    lineas.forEach((linea, i) => {
      // Ignora líneas de comentario (documentan la invariante).
      const esComentario = /^\s*(\/\/|\*|\/\*)/.test(linea);
      // Una apertura real: contiene '.run(' y 'GLOBAL_LOOKUP' en la misma línea.
      const abre = /\.run\(/.test(linea) && /GLOBAL_LOOKUP/.test(linea);
      if (!esComentario && abre && !f.endsWith(join('controllers', 'auth.controller.js'))) {
        ofensores.push(`${rel(f)}:${i + 1}`);
      }
    });
  }
  assert.deepEqual(ofensores, [], `GLOBAL_LOOKUP abierto fuera de auth.controller.js: ${ofensores.join(', ')}`);
});

// --- Regla 2: consultas crudas solo en tenantBootstrap.js ---
test('E7.2: consultas crudas solo en los archivos de la lista blanca', () => {
  const archivos = [...archivosJs(SRC, { incluirTests: false }), ...archivosJs(PRISMA, { incluirTests: false }), ...archivosJs(SCRIPTS, { incluirTests: false })];
  const CRUDAS = /\$(queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)\b/;
  const permitido = (f) => ARCHIVOS_RAW_PERMITIDOS.some((p) => f.endsWith(p));
  const ofensores = [];
  for (const f of archivos) {
    const lineas = readFileSync(f, 'utf8').split('\n');
    lineas.forEach((linea, i) => {
      // Ignora líneas de comentario (documentan la invariante).
      const esComentario = /^\s*(\/\/|\*|\/\*)/.test(linea);
      if (!esComentario && CRUDAS.test(linea) && !permitido(f)) {
        ofensores.push(`${rel(f)}:${i + 1}`);
      }
    });
  }
  assert.deepEqual(ofensores, [], `consultas crudas fuera de la lista blanca (${ARCHIVOS_RAW_PERMITIDOS.join(', ')}): ${ofensores.join(', ')}`);
});

// --- Regla 3: un único new PrismaClient( en todo el árbol (incl. tests) ---
test('E7.3: existe exactamente un new PrismaClient( (en config/db.js)', () => {
  const archivos = [...archivosJs(SRC, { incluirTests: false }), ...archivosJs(PRISMA, { incluirTests: false }), ...archivosJs(SCRIPTS, { incluirTests: false })];
  const hallazgos = [];
  for (const f of archivos) {
    const lineas = readFileSync(f, 'utf8').split('\n');
    lineas.forEach((linea, i) => {
      const esComentario = /^\s*(\/\/|\*|\/\*)/.test(linea);
      if (!esComentario && /new\s+PrismaClient\(/.test(linea)) {
        hallazgos.push(`${rel(f)}:${i + 1}`);
      }
    });
  }
  assert.equal(hallazgos.length, 1, `se esperaba exactamente 1 new PrismaClient(, hay ${hallazgos.length}: ${hallazgos.join(', ')}`);
  assert.ok(hallazgos[0].includes(join('config', 'db.js')), `el único new PrismaClient debe estar en config/db.js, está en ${hallazgos[0]}`);
});

// --- Regla 4 (S1.1): `User` ya no está bajo la extensión de tenant; todo acceso pasa por
// services/usuario.service.js. Excepciones: buscarUsuarioPorEmailSinTenant (login/forgot,
// auth.controller.js: UNA sola aparición) y los tests. ---
test('E7.4: `prisma.user` solo en usuario.service.js (y una vez en buscarUsuarioPorEmailSinTenant)', () => {
  const archivos = [...archivosJs(SRC, { incluirTests: false }), ...archivosJs(PRISMA, { incluirTests: false }), ...archivosJs(SCRIPTS, { incluirTests: false })];
  const ACCESO_USER = /\b(prisma|tx|cliente|client)\.user\b/;
  const servicio = join('src', 'services', 'usuario.service.js');
  const auth = join('src', 'controllers', 'auth.controller.js');
  const ofensores = [];
  let enAuth = 0;
  for (const f of archivos) {
    readFileSync(f, 'utf8').split('\n').forEach((linea, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(linea) || !ACCESO_USER.test(linea)) return;
      if (f.endsWith(servicio)) return;
      if (f.endsWith(auth)) { enAuth += 1; return; }
      ofensores.push(`${rel(f)}:${i + 1}`);
    });
  }
  assert.deepEqual(ofensores, [], `acceso a User fuera de usuario.service.js: ${ofensores.join(', ')}`);
  assert.equal(enAuth, 1, 'auth.controller.js solo puede tocar User en buscarUsuarioPorEmailSinTenant (1 aparición)');
});

// --- Regla 5 (S1.2): el índice persona -> conjunto solo lo lee/escribe domicilio.service.js ---
test('E7.5: `usuarioConjunto` solo en domicilio.service.js', () => {
  const archivos = [...archivosJs(SRC, { incluirTests: false }), ...archivosJs(PRISMA, { incluirTests: false }), ...archivosJs(SCRIPTS, { incluirTests: false })];
  const permitido = join('src', 'services', 'domicilio.service.js');
  const ofensores = [];
  for (const f of archivos) {
    readFileSync(f, 'utf8').split('\n').forEach((linea, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(linea)) return;
      if (/\.usuarioConjunto\b/.test(linea) && !f.endsWith(permitido)) ofensores.push(`${rel(f)}:${i + 1}`);
    });
  }
  assert.deepEqual(ofensores, [], `acceso a UsuarioConjunto fuera de domicilio.service.js: ${ofensores.join(', ')}`);
});

// --- Regla 6 (S1.1): contrato de modelos con tenant == modelos con `conjuntoId` en el esquema ---
test('E7.6: todo modelo con conjuntoId está en MODELOS_CON_TENANT, salvo User y UsuarioConjunto', async () => {
  const { MODELOS_CON_TENANT } = await import('../tenantModels.js');
  const esquema = readFileSync(join(PRISMA, 'schema.prisma'), 'utf8');
  const conConjuntoId = [];
  for (const m of esquema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    if (/^\s*conjuntoId\s+String/m.test(m[2])) conConjuntoId.push(m[1].toLowerCase());
  }
  const EXCEPCIONES = ['user', 'usuarioconjunto']; // ver comentarios en tenantModels.js
  const esperados = conConjuntoId.filter((n) => !EXCEPCIONES.includes(n)).sort();
  assert.deepEqual([...MODELOS_CON_TENANT].sort(), esperados);
  for (const e of EXCEPCIONES) assert.ok(!MODELOS_CON_TENANT.includes(e), `${e} no debe estar en MODELOS_CON_TENANT`);
  assert.ok(MODELOS_CON_TENANT.includes('domicilio'));
});
