// Guarda estructural sobre el APP REAL (KAN-8, Fase E — E6).
// Runner: node:test. Ejecutar: npm test
//
// Recorre TODAS las rutas montadas en createApp() (no una lista de routers a
// mano, para que un router nuevo no quede sin revisar) y exige:
//  - toda ruta con `requireAuth` debe tener `requireTenant` después en su cadena;
//  - toda ruta autenticada (con requireAuth) que no lleve requireTenant, falla;
//  - toda ruta SIN requireAuth debe estar en la lista corta y explícita de
//    rutas pre-sesión; si aparece una nueva ruta pública no listada, falla.
//
// REQUIERE prisma generate (createApp importa controladores -> @prisma/client).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../app.js';

const AUTH = 'requireAuth';
const TENANT = 'requireTenant';

// Rutas que corren SIN sesión (pre-tenant). Lista corta y explícita: si aparece
// una ruta pública nueva que no esté aquí, la prueba falla (hay que decidir
// conscientemente si debe ser pública).
const RUTAS_SIN_SESION = new Set([
  'GET /health',
  'POST /api/auth/register',
  'POST /api/auth/login',
  'POST /api/auth/forgot-password',
  'POST /api/auth/reset-password',
  'GET /api/conjuntos/config-publica',
]);

// --- Aplanado del router de Express ---
// Cada capa puede ser: una ruta (layer.route) o un router montado
// (layer.handle.stack + layer.regexp con el prefijo). Reconstruimos el path y
// la cadena de nombres de middleware acumulando los mws de cada nivel.

function prefijoDeCapa(layer) {
  // Extrae el prefijo textual de una capa de montaje (app.use('/api/x', router)).
  // Express guarda una regexp; para prefijos estáticos, fast_slash o el source.
  if (layer.regexp && layer.regexp.fast_slash) return '';
  const m = layer.regexp && layer.regexp.source
    ? layer.regexp.source
        .replace('^\\/', '/')
        .replace('\\/?(?=\\/|$)', '')
        .replace(/\\\//g, '/')
    : '';
  return m === '/(?=/|$)' ? '' : m;
}

function recolectarRutas(stack, prefijo, mwHeredados, out) {
  // Primera pasada: mws de nivel de este stack (capas sin route ni sub-router
  // nombrado 'router'), que aplican a las rutas hermanas declaradas DESPUÉS.
  // En Express, router.use(mw) se registra como capa previa a las rutas del
  // router, así que acumularlos primero refleja el orden real de ejecución.
  const mwsNivel = [];
  for (const layer of stack) {
    if (!layer.route && layer.name !== 'router' && layer.handle && layer.name) {
      mwsNivel.push(layer.name);
    }
  }
  const heredados = [...mwHeredados, ...mwsNivel];

  // Segunda pasada: rutas concretas y sub-routers montados.
  for (const layer of stack) {
    if (layer.route) {
      const rutaMws = layer.route.stack.map((s) => s.handle?.name || '');
      const metodos = Object.keys(layer.route.methods).filter((k) => layer.route.methods[k]);
      for (const metodo of metodos) {
        out.push({
          method: metodo.toUpperCase(),
          path: prefijo + layer.route.path,
          cadena: [...heredados, ...rutaMws],
        });
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      recolectarRutas(layer.handle.stack, prefijo + prefijoDeCapa(layer), heredados, out);
    }
  }
}

function rutasDelApp(app) {
  const stack = app._router?.stack || app.router?.stack || [];
  const out = [];
  recolectarRutas(stack, '', [], out);
  return out;
}

// Normaliza un path con posibles artefactos de regexp a algo legible.
function limpiarPath(p) {
  return p.replace(/\/+/g, '/');
}

test('E6: toda ruta con requireAuth lleva requireTenant después (app real)', () => {
  const app = createApp();
  const rutas = rutasDelApp(app);
  // Sanidad: debe haber encontrado varias rutas.
  assert.ok(rutas.length >= 5, `se esperaban varias rutas, se hallaron ${rutas.length}`);

  const ofensores = [];
  for (const r of rutas) {
    const idxAuth = r.cadena.indexOf(AUTH);
    if (idxAuth === -1) continue;
    const idxTenant = r.cadena.indexOf(TENANT);
    if (!(idxTenant !== -1 && idxTenant > idxAuth)) {
      ofensores.push(`${r.method} ${limpiarPath(r.path)} [${r.cadena.filter(Boolean).join(' -> ')}]`);
    }
  }
  assert.deepEqual(ofensores, [], `rutas con requireAuth sin requireTenant después: ${ofensores.join('; ')}`);
});

test('E6: toda ruta pública (sin requireAuth) está en la lista de rutas sin sesión', () => {
  const app = createApp();
  const rutas = rutasDelApp(app);

  const inesperadas = [];
  for (const r of rutas) {
    if (r.cadena.includes(AUTH)) continue; // autenticada, no aplica
    const clave = `${r.method} ${limpiarPath(r.path)}`;
    if (!RUTAS_SIN_SESION.has(clave)) inesperadas.push(clave);
  }
  assert.deepEqual(
    inesperadas,
    [],
    `rutas públicas no declaradas en RUTAS_SIN_SESION (decidir si deben ser públicas): ${inesperadas.join('; ')}`
  );
});
