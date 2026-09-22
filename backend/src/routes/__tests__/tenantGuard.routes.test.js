// Guarda estructural de rutas (KAN-8, Fase C — revisión punto 2).
// Runner: node:test. Ejecutar: npm test
//
// Recorre cada router de Express y FALLA si alguna capa/ruta protegida con
// `requireAuth` no tiene `requireTenant` aplicado también. Así ninguna ruta
// nueva puede quedar sin aislamiento por olvido.
//
// REQUIERE prisma generate: los routers importan controladores que importan
// config/db.js (@prisma/client). Se reporta como PENDIENTE DE PRUEBA LOCAL.
//
// Excepción explícita: en auth.routes, `/me` es la única ruta autenticada; las
// demás (register/login/forgot/reset) son pre-tenant y NO deben llevar
// requireTenant.

import test from 'node:test';
import assert from 'node:assert/strict';

import authRoutes from '../auth.routes.js';
import packagesRoutes from '../packages.routes.js';
import commentsRoutes from '../comments.routes.js';
import bonosRoutes from '../bonos.routes.js';

// Nombres de los middlewares tal como se declaran (funciones nombradas).
const AUTH = 'requireAuth';
const TENANT = 'requireTenant';

// Extrae, de un router de Express, la lista de "cadenas de middlewares" a
// verificar: las capas de router.use(...) (mws globales del router) y las de
// cada ruta (route.stack). Devuelve arrays de nombres de función.
function cadenasDeMiddleware(router) {
  const globales = [];
  const porRuta = [];

  for (const capa of router.stack) {
    if (capa.route) {
      // Ruta concreta: sus handlers están en capa.route.stack.
      const nombres = capa.route.stack.map((s) => s.handle?.name || '');
      porRuta.push({ path: capa.route.path, nombres });
    } else if (capa.handle && typeof capa.handle === 'function') {
      // Middleware global del router (router.use).
      globales.push(capa.handle.name || '');
    }
  }
  return { globales, porRuta };
}

// Verifica la regla: si `requireAuth` aparece en una cadena, `requireTenant`
// debe aparecer DESPUÉS en la cadena efectiva de esa ruta. La cadena efectiva
// de una ruta = mws globales del router (en orden) + handlers de la ruta.
function verificarRouter(nombre, router, { rutasPreTenant = [] } = {}) {
  const { globales, porRuta } = cadenasDeMiddleware(router);

  for (const { path, nombres } of porRuta) {
    const cadena = [...globales, ...nombres];
    const idxAuth = cadena.indexOf(AUTH);
    if (idxAuth === -1) continue; // ruta pública, no exige tenant

    // Excepción declarada: rutas pre-tenant conocidas.
    if (rutasPreTenant.includes(path)) continue;

    const idxTenant = cadena.indexOf(TENANT);
    assert.ok(
      idxTenant !== -1 && idxTenant > idxAuth,
      `[${nombre}] la ruta '${path}' tiene ${AUTH} pero no ${TENANT} después ` +
        `(cadena: ${cadena.filter(Boolean).join(' -> ')})`
    );
  }
}

test('packages.routes: toda ruta autenticada lleva requireTenant', () => {
  verificarRouter('packages', packagesRoutes);
});

test('bonos.routes: toda ruta autenticada lleva requireTenant', () => {
  verificarRouter('bonos', bonosRoutes);
});

test('comments.routes: toda ruta autenticada lleva requireTenant', () => {
  verificarRouter('comments', commentsRoutes);
});

test('auth.routes: /me lleva requireTenant; register/login/forgot/reset son pre-tenant', () => {
  // Las rutas pre-tenant no llevan requireAuth (así que la guarda las ignora),
  // pero las listamos explícitamente por claridad y para documentar la excepción.
  verificarRouter('auth', authRoutes, {
    rutasPreTenant: ['/register', '/login', '/forgot-password', '/reset-password'],
  });
});

test('auth.routes: /me efectivamente tiene requireAuth seguido de requireTenant', () => {
  const { porRuta } = cadenasDeMiddleware(authRoutes);
  const me = porRuta.find((r) => r.path === '/me');
  assert.ok(me, 'no se encontró la ruta /me');
  const idxAuth = me.nombres.indexOf(AUTH);
  const idxTenant = me.nombres.indexOf(TENANT);
  assert.ok(idxAuth !== -1, '/me debe tener requireAuth');
  assert.ok(idxTenant === idxAuth + 1, '/me debe tener requireTenant justo después de requireAuth');
});
