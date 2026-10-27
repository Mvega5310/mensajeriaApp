// SQL crudo para asignar un conjuntoId a las filas de LEGADO (KAN-8, Fase F).
//
// Por qué SQL crudo: el backfill tiene que tocar filas con conjuntoId NULL. La
// extensión de tenant (a) falla cerrado sin contexto y (b) dentro de
// runWithTenant filtra por conjuntoId, así que un updateMany jamás "vería" las
// filas NULL. La única forma correcta es SQL crudo que no pase por la capa de
// modelos de la extensión.
//
// INVARIANTE E7.2 (consultas crudas): este archivo está en la lista blanca de
// la auditoría `auditoriaInvariantes.test.js`, JUNTO A `tenantBootstrap.js`. Es
// una ampliación EXPLÍCITA y acotada: las consultas crudas de backfill viven
// SOLO aquí. Los nombres de tabla son LITERALES FIJOS (nunca interpolados desde
// entrada externa); todo valor (conjuntoId) se liga como PARÁMETRO vía el tag
// template de Prisma (`$executeRaw\`... ${valor} ...\``), nunca se concatena.
//
// Usa el cliente transaccional `tx` que le pasa el llamador (un solo
// PrismaClient, el de config/db.js — invariante E7.3 intacto).

// Tablas con tenant que llevan conjuntoId directo (design.md §1.5). Lista fija.
export const TABLAS_CON_TENANT = Object.freeze(['User', 'Package', 'Bono', 'Comentario']);

// UPDATE por tabla: una función por tabla, cada una con su nombre de tabla en un
// LITERAL FIJO del tag template; `conjuntoId` se liga como parámetro.
const UPDATE_LEGADO = {
  User: (tx, id) => tx.$executeRaw`UPDATE "User" SET "conjuntoId" = ${id} WHERE "conjuntoId" IS NULL`,
  Package: (tx, id) => tx.$executeRaw`UPDATE "Package" SET "conjuntoId" = ${id} WHERE "conjuntoId" IS NULL`,
  Bono: (tx, id) => tx.$executeRaw`UPDATE "Bono" SET "conjuntoId" = ${id} WHERE "conjuntoId" IS NULL`,
  Comentario: (tx, id) => tx.$executeRaw`UPDATE "Comentario" SET "conjuntoId" = ${id} WHERE "conjuntoId" IS NULL`,
};

/**
 * Asigna `conjuntoId` a todas las filas de las tablas con tenant que hoy tienen
 * `conjuntoId IS NULL`. Devuelve el número de filas afectadas por tabla.
 * Debe llamarse DENTRO de una transacción (recibe `tx`).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} conjuntoId
 * @returns {Promise<Record<string, number>>}
 */
export async function asignarConjuntoALegado(tx, conjuntoId) {
  if (!conjuntoId || typeof conjuntoId !== 'string') {
    throw new Error('asignarConjuntoALegado: conjuntoId inválido');
  }
  const afectadas = {};
  for (const tabla of TABLAS_CON_TENANT) {
    afectadas[tabla] = await UPDATE_LEGADO[tabla](tx, conjuntoId);
  }
  return afectadas;
}

// Conteo por tabla: total y con conjuntoId NULL. Literales fijos por tabla.
const CONTEO = {
  User: (tx) => tx.$queryRaw`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE "conjuntoId" IS NULL)::int AS nulos FROM "User"`,
  Package: (tx) => tx.$queryRaw`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE "conjuntoId" IS NULL)::int AS nulos FROM "Package"`,
  Bono: (tx) => tx.$queryRaw`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE "conjuntoId" IS NULL)::int AS nulos FROM "Bono"`,
  Comentario: (tx) => tx.$queryRaw`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE "conjuntoId" IS NULL)::int AS nulos FROM "Comentario"`,
};

/**
 * Conteo por tabla: { total, nulos, asignados }.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<Record<string, {total:number, nulos:number, asignados:number}>>}
 */
export async function contarPorTabla(tx) {
  const out = {};
  for (const tabla of TABLAS_CON_TENANT) {
    const filas = await CONTEO[tabla](tx);
    const row = Array.isArray(filas) && filas[0] ? filas[0] : { total: 0, nulos: 0 };
    out[tabla] = { total: row.total, nulos: row.nulos, asignados: row.total - row.nulos };
  }
  return out;
}

// Filas con conjuntoId apuntando a OTRO conjunto distinto del dado.
const OTRO_CONJUNTO = {
  User: (tx, id) => tx.$queryRaw`SELECT COUNT(*)::int AS n FROM "User" WHERE "conjuntoId" IS NOT NULL AND "conjuntoId" <> ${id}`,
  Package: (tx, id) => tx.$queryRaw`SELECT COUNT(*)::int AS n FROM "Package" WHERE "conjuntoId" IS NOT NULL AND "conjuntoId" <> ${id}`,
  Bono: (tx, id) => tx.$queryRaw`SELECT COUNT(*)::int AS n FROM "Bono" WHERE "conjuntoId" IS NOT NULL AND "conjuntoId" <> ${id}`,
  Comentario: (tx, id) => tx.$queryRaw`SELECT COUNT(*)::int AS n FROM "Comentario" WHERE "conjuntoId" IS NOT NULL AND "conjuntoId" <> ${id}`,
};

/**
 * Nº de filas que ya apuntan a un conjunto distinto del dado (no es backfill limpio).
 * @returns {Promise<number>}
 */
export async function contarAsignadasAOtroConjunto(tx, conjuntoId) {
  let total = 0;
  for (const tabla of TABLAS_CON_TENANT) {
    const filas = await OTRO_CONJUNTO[tabla](tx, conjuntoId);
    total += Array.isArray(filas) && filas[0] ? filas[0].n : 0;
  }
  return total;
}

/**
 * Bloquea las 4 tablas con tenant en SHARE ROW EXCLUSIVE MODE dentro de la
 * transacción actual. Permite LECTURAS concurrentes pero BLOQUEA escrituras
 * (INSERT/UPDATE/DELETE) de otras transacciones hasta el COMMIT/ROLLBACK. Así,
 * durante C1/C3 con tráfico vivo, un escritor viejo espera unos segundos en vez
 * de colarse entre el conteo y el UPDATE (lo que causaría un abort espurio).
 * Los nombres de tabla son literales fijos.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
export async function bloquearTablasConTenant(tx) {
  // Un solo LOCK con las 4 tablas; literal fijo, sin interpolación de entrada.
  await tx.$executeRaw`LOCK TABLE "User", "Package", "Bono", "Comentario" IN SHARE ROW EXCLUSIVE MODE`;
}

/**
 * Nº de User con role OPERATOR que quedarían en el conjunto: los que hoy están
 * sin conjunto (NULL) más los ya asignados al conjunto `idTentativo` (caso P1).
 * operadorDelConjuntoActual() depende de que sea exactamente 1.
 * @returns {Promise<number>}
 */
export async function contarOperadoresDelConjunto(tx, idTentativo) {
  const filas = await tx.$queryRaw`
    SELECT COUNT(*)::int AS n FROM "User"
    WHERE "role" = 'OPERATOR' AND ("conjuntoId" IS NULL OR "conjuntoId" = ${idTentativo})
  `;
  return Array.isArray(filas) && filas[0] ? filas[0].n : 0;
}

/**
 * Integridad cruzada: Package/Bono/Comentario cuyo residente está en otro
 * conjunto que el de la propia fila. Devuelve el nº de inconsistencias.
 * @returns {Promise<number>}
 */
export async function contarInconsistenciasCruzadas(tx) {
  const consultas = [
    tx.$queryRaw`SELECT COUNT(*)::int AS n FROM "Package" p JOIN "User" u ON u."id" = p."residenteId" WHERE p."conjuntoId" <> u."conjuntoId"`,
    tx.$queryRaw`SELECT COUNT(*)::int AS n FROM "Bono" b JOIN "User" u ON u."id" = b."residenteId" WHERE b."conjuntoId" <> u."conjuntoId"`,
    tx.$queryRaw`SELECT COUNT(*)::int AS n FROM "Comentario" c JOIN "User" u ON u."id" = c."residenteId" WHERE c."conjuntoId" <> u."conjuntoId"`,
  ];
  let total = 0;
  for (const q of consultas) {
    const filas = await q;
    total += Array.isArray(filas) && filas[0] ? filas[0].n : 0;
  }
  return total;
}
