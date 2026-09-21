// Extensión de Prisma para aislamiento multi-conjunto (KAN-8, Fase B —
// design.md §2.3 y §2.3.1).
//
// Intercepta las operaciones sobre los modelos con tenant (ver tenantModels.js)
// y, según el contexto activo (tenantContext.js):
//
//   scope TENANT         -> inyecta el filtro por conjuntoId en lecturas y
//                           escrituras, y FUERZA data.conjuntoId desde el
//                           contexto en las creaciones.
//   scope GLOBAL_LOOKUP  -> NO filtra esa operación (exención puntual, solo
//                           usada por buscarUsuarioPorEmailSinTenant()).
//   sin contexto         -> LANZA (falla cerrado). La ausencia de contexto
//                           NUNCA se interpreta como permiso.
//
// Invariantes que sostiene (checklist de tasks.md):
// - Un solo PrismaClient extendido (se aplica en config/db.js).
// - findUnique/findUniqueOrThrow se reescriben a findFirst/findFirstOrThrow
//   (Prisma no admite conjuntoId en el where de findUnique sin clave única
//   compuesta). La reescritura se hace redirigiendo la llamada al método
//   findFirst del propio modelo del cliente extendido.
// - conjuntoId NUNCA se acepta desde `data`: se ignora/rechaza y se fija desde
//   el contexto.
// - No hay ningún flag de runtime que active/desactive el aislamiento.

import { Prisma } from '@prisma/client';
import { getContext, SCOPE } from './tenantContext.js';
import { esModeloConTenant } from './tenantModels.js';

// Operaciones cuyo `where` es un WhereInput (admite AND, campos no únicos).
// Aquí combinamos con AND sin pisar las condiciones del llamador.
const OPS_WHERE_FILTRO = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
]);

// Operaciones cuyo `where` es un WhereUniqueInput. Prisma 5 NO admite `AND`
// aquí: el campo único debe estar en el primer nivel. Además, desde Prisma 5.0
// se pueden incluir campos NO únicos (como conjuntoId) en el mismo nivel, así
// que `findUnique({ where: { id, conjuntoId } })` funciona y devuelve null si el
// conjunto no coincide — por eso YA NO reescribimos findUnique -> findFirst.
const OPS_WHERE_UNICO = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'delete',
  'upsert',
]);

// Combina un WhereInput con el filtro de conjunto usando AND (no pisa las
// condiciones del llamador). Para findMany/updateMany/etc.
export function conFiltroConjunto(where, conjuntoId) {
  const filtro = { conjuntoId };
  if (where === undefined || where === null) return filtro;
  return { AND: [where, filtro] };
}

// Combina un WhereUniqueInput con el conjunto en el PRIMER NIVEL (spread plano),
// como exige Prisma 5 para las claves únicas. Si el llamador ya trae un
// conjuntoId distinto, lanza: el llamador NUNCA decide el tenant (R1.2).
export function whereUnicoConConjunto(where, conjuntoId) {
  if (where && typeof where === 'object' && 'conjuntoId' in where && where.conjuntoId !== conjuntoId) {
    throw new Error(
      'Aislamiento de tenant: el where trae un conjuntoId distinto del contexto activo.'
    );
  }
  return { ...(where ?? {}), conjuntoId };
}

// Fuerza data.conjuntoId desde el contexto. Rechaza que el llamador fije un
// conjuntoId distinto: el valor del llamador NUNCA decide el tenant (R1.2).
export function forzarConjuntoEnData(data, conjuntoId) {
  if (Array.isArray(data)) {
    return data.map((item) => forzarConjuntoEnData(item, conjuntoId));
  }
  if (data && typeof data === 'object' && 'conjuntoId' in data && data.conjuntoId !== conjuntoId) {
    throw new Error(
      'Aislamiento de tenant: no se permite fijar conjuntoId desde data; ' +
        'el conjunto proviene siempre del contexto activo.'
    );
  }
  return { ...(data ?? {}), conjuntoId };
}

/**
 * Lógica pura del interceptor de aislamiento. Se extrae para poder probarla sin
 * una base de datos real: recibe explícitamente `query` (ejecutor de la
 * operación original) y `client` (para la reescritura findUnique -> findFirst),
 * ambos inyectables en pruebas con fakes.
 *
 * @param {object} p
 * @param {string} p.model      nombre de modelo de Prisma
 * @param {string} p.operation  operación (findMany, create, ...)
 * @param {object} p.args       argumentos originales
 * @param {(a:object)=>Promise<any>} p.query  ejecuta la operación original
 * @param {()=>(object|undefined)} [p.leerContexto]  fuente del contexto (test)
 */
export async function aplicarAislamiento({ model, operation, args, query, leerContexto = getContext }) {
  // Modelos sin tenant (Conjunto, PasswordResetToken): pasan tal cual y no
  // requieren contexto. Es lo que permite las lecturas pre-tenant (resolver
  // Conjunto por codigoInvitacion, etc.).
  if (!esModeloConTenant(model)) {
    return query(args);
  }

  const ctx = leerContexto();

  // Falla cerrado: sin contexto no se toca un modelo con tenant.
  if (!ctx) {
    throw new Error(
      `Aislamiento de tenant: operación '${operation}' sobre '${model}' ` +
        'sin contexto de conjunto. Debe correr dentro de runWithTenant(...) o, ' +
        'para autenticación, de buscarUsuarioPorEmailSinTenant().'
    );
  }

  // Exención puntual y explícita para autenticación pre-tenant.
  if (ctx.scope === SCOPE.GLOBAL_LOOKUP) {
    return query(args);
  }

  // scope TENANT
  const { conjuntoId } = ctx;
  const nextArgs = { ...args };

  // 1) Operaciones con WhereUniqueInput (findUnique, findUniqueOrThrow, update,
  //    delete, upsert): el conjunto va en el PRIMER NIVEL del where (spread),
  //    NO en un AND. Prisma 5 admite campos no únicos ahí, así que findUnique
  //    por id devuelve null si el conjunto no coincide (sin reescribir a
  //    findFirst).
  if (OPS_WHERE_UNICO.has(operation)) {
    nextArgs.where = whereUnicoConConjunto(nextArgs.where, conjuntoId);

    // update y upsert traen data que hay que sujetar al conjunto.
    if (operation === 'update' && nextArgs.data !== undefined) {
      nextArgs.data = forzarConjuntoEnData(nextArgs.data, conjuntoId);
    }
    if (operation === 'upsert') {
      if (nextArgs.create !== undefined) {
        nextArgs.create = forzarConjuntoEnData(nextArgs.create, conjuntoId);
      }
      if (nextArgs.update !== undefined) {
        nextArgs.update = forzarConjuntoEnData(nextArgs.update, conjuntoId);
      }
    }
    return query(nextArgs);
  }

  // 2) Operaciones con WhereInput (findMany, findFirst, count, aggregate,
  //    groupBy, updateMany, deleteMany): combinamos con AND.
  if (OPS_WHERE_FILTRO.has(operation)) {
    nextArgs.where = conFiltroConjunto(nextArgs.where, conjuntoId);
    // updateMany trae data que también hay que sujetar al conjunto.
    if (nextArgs.data !== undefined) {
      nextArgs.data = forzarConjuntoEnData(nextArgs.data, conjuntoId);
    }
    return query(nextArgs);
  }

  // 3) Creaciones: conjuntoId SIEMPRE desde el contexto.
  if (operation === 'create' || operation === 'createMany') {
    nextArgs.data = forzarConjuntoEnData(nextArgs.data, conjuntoId);
    return query(nextArgs);
  }

  // Operación no contemplada sobre un modelo con tenant: no se deja pasar sin
  // filtro (falla cerrado por defecto).
  throw new Error(
    `Aislamiento de tenant: operación no soportada '${operation}' sobre ` +
      `'${model}'. Revisa la extensión antes de usarla.`
  );
}

/**
 * Construye la extensión de tenant. Factory para aplicarla una sola vez en
 * config/db.js (un único cliente extendido). Delega toda la lógica en
 * aplicarAislamiento().
 */
export function tenantExtension() {
  return Prisma.defineExtension((client) =>
    client.$extends({
      name: 'kan8-tenant-isolation',
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            return aplicarAislamiento({ model, operation, args, query });
          },
        },
      },
    })
  );
}
