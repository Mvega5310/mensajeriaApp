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
// NOTA DE DISEÑO (hueco no cubierto por design.md, resuelto aquí y pendiente de
// validación): la lectura de bootstrap del tenant es un problema de "huevo y
// gallina" — necesitamos leer User.conjuntoId por `sub`, pero User está bajo la
// extensión, que exige contexto que todavía no existe. NO usamos GLOBAL_LOOKUP
// (ese scope está reservado en exclusiva a buscarUsuarioPorEmailSinTenant()) ni
// un segundo PrismaClient sin extender (invariante: un solo cliente). En su
// lugar leemos solo la columna conjuntoId con $queryRaw parametrizado por id:
// $queryRaw no atraviesa la capa de modelos de la extensión, así que no dispara
// el falla-cerrado, sigue siendo el MISMO cliente extendido, y es una lectura
// mínima (una columna, por PK) con parámetros ligados (sin inyección).

import { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { runWithTenant } from '../config/tenantContext.js';

/**
 * Resuelve el conjuntoId de un usuario por su id, sin depender del contexto de
 * tenant (lectura de bootstrap). Devuelve string | null.
 */
export async function resolverConjuntoIdPorUsuario(userId) {
  // $queryRaw con parámetro ligado: no pasa por la extensión de modelos y es
  // seguro frente a inyección.
  const filas = await prisma.$queryRaw(
    Prisma.sql`SELECT "conjuntoId" FROM "User" WHERE "id" = ${userId} LIMIT 1`
  );
  const fila = Array.isArray(filas) ? filas[0] : undefined;
  return fila?.conjuntoId ?? null;
}

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
  runWithTenant({ conjuntoId, role: req.user.role }, () => {
    // Guardamos el conjunto resuelto por si algún controlador lo necesita
    // explícitamente (p. ej. para leer configuración del propio Conjunto).
    req.conjuntoId = conjuntoId;
    next();
  });
}
