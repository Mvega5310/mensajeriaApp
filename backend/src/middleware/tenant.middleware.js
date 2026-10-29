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
// - Nunca se toma un conjuntoId de query/body/headers. (S1.3: el cliente puede elegir el
//   conjunto por SLUG; se valida contra la BD —activo y con domicilio de la persona— y solo
//   entonces se abre su contexto. Un claim del token solo se acepta verificado en el índice.)
// - Falla cerrado: si el usuario no existe o no tiene conjuntoId resoluble ->
//   401 y NO continúa. No hay "modo sin tenant".
//
// PLAN-conjunto S1.3 — el conjunto de un RESIDENT se elige POR SOLICITUD:
// - requireTenant abre el contexto "base" (User.conjuntoId = último conjunto usado; en la
//   sesión de enlace, el conjunto firmado en el token SI la persona tiene domicilio ahí).
// - conjuntoDeSolicitud (lecturas): `?conjunto=<slug>` -> conjunto activo donde la persona
//   tiene domicilio; abre un contexto anidado de ese conjunto.
// - conjuntoDelPaquete (schedule, foto): busca el paquete DEL residente en sus conjuntos
//   (índice UsuarioConjunto) y abre el contexto del conjunto del paquete.
// - Las escrituras que crean algo (pre-alerta, dirección) resuelven el conjunto en su
//   controlador desde el slug o la dirección elegida.
// Nada de esto usa GLOBAL_LOOKUP ni SQL crudo, y el cliente nunca manda un conjuntoId.
//
// La lectura de bootstrap del tenant (resolverConjuntoIdPorUsuario) vive ahora
// en config/tenantBootstrap.js, porque también la usa resetPassword. Ver la
// nota de diseño y la invariante de $queryRaw en ese módulo.

import { AppError, CODIGOS } from '../domain/errores.js';
import { runWithTenant } from '../config/tenantContext.js';
import { resolverConjuntoIdPorUsuario } from '../config/tenantBootstrap.js';
import { conjuntoActivoPorSlug } from '../services/conjunto.service.js';
import { conjuntoDePaquetePropio, tieneDomicilioEn } from '../services/domicilio.service.js';

export async function requireTenant(req, res, next) {
  const sub = req.user?.sub;
  if (!sub) {
    // No debería ocurrir si requireAuth corrió antes, pero fallamos cerrado.
    return next(new AppError(CODIGOS.NO_AUTENTICADO, 'Inicia sesión para continuar.', 401));
  }

  let conjuntoId;
  try {
    conjuntoId = await resolverConjuntoIdPorUsuario(sub);
  } catch (err) {
    return next(err);
  }

  if (!conjuntoId) {
    // Usuario inexistente o sin conjunto backfilleado: falla cerrado.
    return next(new AppError(CODIGOS.SESION_INVALIDA, 'Tu sesión no está asociada a un conjunto válido. Inicia sesión de nuevo.', 401));
  }

  // Sesión de enlace (T3.1): el token trae el conjunto con el que se firmó. S1.3: ya no se
  // exige que sea el "último conjunto" de la cuenta (la persona puede tener un paquete en B
  // siendo su último conjunto A); basta con que tenga domicilio en ese conjunto. El tenant
  // sigue saliendo de un conjunto verificado en la BD (índice), nunca solo del token.
  if (req.user.scope) {
    let valido = false;
    try {
      valido = typeof req.user.conjuntoId === 'string' && await tieneDomicilioEn(sub, req.user.conjuntoId);
    } catch (err) {
      return next(err);
    }
    if (!valido) {
      return next(new AppError(CODIGOS.SESION_INVALIDA, 'Tu acceso ya no es válido. Abre de nuevo el enlace del aviso.', 401));
    }
    conjuntoId = req.user.conjuntoId;
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

function abrirContexto(req, conjuntoId, next) {
  runWithTenant({ conjuntoId, role: req.user.role }, () => {
    req.conjuntoId = conjuntoId;
    next();
  }).catch(next);
}

/**
 * Lecturas de un RESIDENT en un conjunto concreto: `?conjunto=<slug>` (o `conjunto` en el
 * cuerpo de un POST que crea algo propio de ese conjunto, como un comentario). Va DESPUÉS de
 * requireTenant. Sin slug, no cambia nada (conjunto base). Slug inexistente/inactivo -> 400;
 * conjunto donde la persona no tiene domicilio -> 404. Operadores y sesión de enlace
 * (que ya trae su conjunto) lo ignoran.
 */
export function conjuntoDeSolicitud(req, res, next) {
  if (req.user?.role !== 'RESIDENT' || req.user.scope) return next();
  const slug = req.query?.conjunto ?? (req.method === 'POST' ? req.body?.conjunto : undefined);
  if (slug === undefined || slug === '') return next();
  (async () => {
    const c = await conjuntoActivoPorSlug(slug);
    if (c.id === req.conjuntoId) return null;
    if (!(await tieneDomicilioEn(req.user.sub, c.id))) {
      throw new AppError(CODIGOS.NO_ENCONTRADO, 'No tienes direcciones en ese conjunto. Agrega una primero.', 404);
    }
    return c.id;
  })().then((conjuntoId) => (conjuntoId ? abrirContexto(req, conjuntoId, next) : next()), next);
}

/**
 * Rutas de un RESIDENT sobre un paquete (`/:id/...`): abre el contexto del conjunto DEL
 * paquete (el residente debe ser su dueño). Si no lo encuentra en ninguno de sus conjuntos
 * deja el contexto base y el controlador responde 404 como siempre. La sesión de enlace se
 * queda en el conjunto de su token (acceso limitado). Operadores: sin cambios.
 */
export function conjuntoDelPaquete(req, res, next) {
  if (req.user?.role !== 'RESIDENT' || req.user.scope) return next();
  conjuntoDePaquetePropio(req.user.sub, req.params.id, req.conjuntoId)
    .then((conjuntoId) => (conjuntoId && conjuntoId !== req.conjuntoId ? abrirContexto(req, conjuntoId, next) : next()), next);
}
