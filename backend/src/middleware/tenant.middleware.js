// Middleware de tenant (KAN-8, Fase B — design.md §2.3 componente 2, §3.6).
//
// Se monta DESPUÉS de requireAuth: usa req.user.sub (subject del JWT) para
// resolver el conjunto activo y abrir el contexto TENANT para el resto de la
// cadena. A partir de ahí, la extensión de Prisma (config/db.js) filtra todo
// automáticamente.
//
// Reglas duras (design.md §3.6, R1.3, R1.5):
// - El conjuntoId se resuelve SIEMPRE por `sub` contra la BD. El JWT NO trae
//   claim de conjunto; User.conjuntoId es la única fuente de verdad, así no
//   puede quedar obsoleto respecto a un claim firmado.
// - Nunca se toma el conjunto de query/body/headers ni de un claim del token.
// - Falla cerrado: si el usuario no existe o no tiene conjuntoId resoluble ->
//   401 y NO continúa. No hay "modo sin tenant".
//
// La lectura de bootstrap del tenant (resolverConjuntoIdPorUsuario) vive ahora
// en config/tenantBootstrap.js, porque también la usa resetPassword. Ver la
// nota de diseño y la invariante de $queryRaw en ese módulo.

import { runWithTenant } from '../config/tenantContext.js';
import { resolverConjuntoIdPorUsuario } from '../config/tenantBootstrap.js';

export async function requireTenant(req, res, next) {
  const sub = req.user?.sub;
  if (!sub) {
    // No debería ocurrir si requireAuth corrió antes, pero fallamos cerrado.
    return res.status(401).json({ error: 'No autenticado' });
  }

  let conjuntoId;
  try {
    conjuntoId = await resolverConjuntoIdPorUsuario(sub);
  } catch (err) {
    return next(err);
  }

  if (!conjuntoId) {
    // Usuario inexistente o sin conjunto backfilleado: falla cerrado.
    return res.status(401).json({ error: 'Sesión sin conjunto válido. Inicia sesión de nuevo.' });
  }

  // Abre el contexto TENANT para el resto de la cadena. El role viene del JWT
  // ya verificado (solo se usa para consultas, no para autorizar aquí).
  // runWithTenant ahora devuelve SIEMPRE una promesa (envuelve el callback en
  // async), así que encadenamos .catch(next) para no dejar rechazos sin manejar.
  runWithTenant({ conjuntoId, role: req.user.role }, () => {
    // Guardamos el conjunto resuelto por si algún controlador lo necesita
    // explícitamente (p. ej. para leer configuración del propio Conjunto).
    req.conjuntoId = conjuntoId;
    next();
  }).catch(next);
}
