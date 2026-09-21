// Bootstrap del tenant (KAN-8, Fase B — design.md §2.3, §3.6).
//
// La resolución del conjunto de un usuario es un problema de "huevo y gallina":
// necesitamos leer User.conjuntoId por id, pero User está bajo la extensión de
// aislamiento, que exige un contexto de tenant que en ese momento todavía no
// existe (middleware que aún va a abrirlo; resetPassword sin sesión).
//
// Se resuelve con $queryRaw parametrizado por id: las consultas crudas NO pasan
// por la capa de modelos de la extensión, así que no disparan el falla-cerrado,
// siguen usando el ÚNICO cliente extendido (no un segundo cliente) y leen una
// sola columna por PK con parámetro ligado (sin inyección).
//
// INVARIANTE (checklist de tasks.md): $queryRaw / $executeRaw / $queryRawUnsafe
// / $executeRawUnsafe deben aparecer SOLO en resolverConjuntoIdPorUsuario().
// Cualquier otra consulta cruda sería una vía sin aislamiento.

import { Prisma } from '@prisma/client';
import { prisma } from './db.js';

/**
 * Resuelve el conjuntoId de un usuario por su id, sin depender del contexto de
 * tenant. Devuelve string | null.
 *
 * @param {string} userId
 * @returns {Promise<string|null>}
 */
export async function resolverConjuntoIdPorUsuario(userId) {
  const filas = await prisma.$queryRaw(
    Prisma.sql`SELECT "conjuntoId" FROM "User" WHERE "id" = ${userId} LIMIT 1`
  );
  const fila = Array.isArray(filas) ? filas[0] : undefined;
  return fila?.conjuntoId ?? null;
}
