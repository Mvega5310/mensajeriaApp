// Auditorías de invariantes como pruebas estáticas (KAN-8, Fase E — E7).
// Autónoma: solo lee archivos de backend/src y backend/prisma, no toca BD ni
// importa @prisma/client. Runner: node:test. Ejecutar: npm test
//
// Falla si:
//  1. se abre el scope GLOBAL_LOOKUP fuera de buscarUsuarioPorEmailSinTenant()
//     (archivo controllers/auth.controller.js);
//  2. aparece una consulta cruda ($queryRaw/$executeRaw/$queryRawUnsafe/
//     $executeRawUnsafe) fuera de resolverConjuntoIdPorUsuario()
//     (archivo config/tenantBootstrap.js);
//  3. hay más de un `new PrismaClient(` en el código de producción.
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
  const archivos = [...archivosJs(SRC, { incluirTests: false }), ...archivosJs(PRISMA, { incluirTests: false })];
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
test('E7.2: consultas crudas solo en resolverConjuntoIdPorUsuario (tenantBootstrap.js)', () => {
  const archivos = [...archivosJs(SRC, { incluirTests: false }), ...archivosJs(PRISMA, { incluirTests: false })];
  const CRUDAS = /\$(queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)\b/;
  const ofensores = [];
  for (const f of archivos) {
    const lineas = readFileSync(f, 'utf8').split('\n');
    lineas.forEach((linea, i) => {
      // Ignora líneas de comentario (documentan la invariante).
      const esComentario = /^\s*(\/\/|\*|\/\*)/.test(linea);
      if (!esComentario && CRUDAS.test(linea) && !f.endsWith(join('config', 'tenantBootstrap.js'))) {
        ofensores.push(`${rel(f)}:${i + 1}`);
      }
    });
  }
  assert.deepEqual(ofensores, [], `consultas crudas fuera de tenantBootstrap.js: ${ofensores.join(', ')}`);
});

// --- Regla 3: un único new PrismaClient( en todo el árbol (incl. tests) ---
test('E7.3: existe exactamente un new PrismaClient( (en config/db.js)', () => {
  const archivos = [...archivosJs(SRC, { incluirTests: false }), ...archivosJs(PRISMA, { incluirTests: false })];
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
