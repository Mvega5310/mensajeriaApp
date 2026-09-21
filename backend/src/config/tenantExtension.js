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

// Lecturas por filtro que aceptan `where` y se filtran por tenant en sitio
// (sin reescribir la operación).
const LECTURAS_POR_FILTRO = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);

// Escrituras/borrados que aceptan `where`.
const ESCRITURAS_CON_WHERE = new Set(['update', 'updateMany', 'delete', 'deleteMany']);

// Combina el where del llamador con el filtro de conjunto, sin pisar sus
// condiciones.
export function conFiltroConjunto(where, conjuntoId) {
  const filtro = { conjuntoId };
  if (where === undefined || where === null) return filtro;
  return { AND: [where, filtro] };
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
 * Construye la extensión de tenant. Factory para poder aplicarla una sola vez
 * en config/db.js (un único cliente extendido).
 */
export function tenantExtension() {
  return Prisma.defineExtension((client) =>
    client.$extends({
      name: 'kan8-tenant-isolation',
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            // Modelos sin tenant (Conjunto, PasswordResetToken): pasan tal
            // cual y no requieren contexto. Es lo que permite las lecturas
            // pre-tenant (resolver Conjunto por codigoInvitacion, etc.).
            if (!esModeloConTenant(model)) {
              return query(args);
            }

            const ctx = getContext();

            // Falla cerrado: sin contexto no se toca un modelo con tenant.
            if (!ctx) {
              throw new Error(
                `Aislamiento de tenant: operación '${operation}' sobre '${model}' ` +
                  'sin contexto de conjunto. Debe correr dentro de ' +
                  'runWithTenant(...) o, para autenticación, de ' +
                  'buscarUsuarioPorEmailSinTenant().'
              );
            }

            // Exención puntual y explícita para autenticación pre-tenant.
            if (ctx.scope === SCOPE.GLOBAL_LOOKUP) {
              return query(args);
            }

            // scope TENANT
            const { conjuntoId } = ctx;
            const nextArgs = { ...args };

            // 1) findUnique / findUniqueOrThrow -> findFirst / findFirstOrThrow.
            //    Se redirige al método correspondiente del modelo en el cliente
            //    extendido (client[model] existe en tiempo de ejecución).
            if (operation === 'findUnique' || operation === 'findUniqueOrThrow') {
              const destino = operation === 'findUnique' ? 'findFirst' : 'findFirstOrThrow';
              nextArgs.where = conFiltroConjunto(nextArgs.where, conjuntoId);
              const delegate = client[model] ?? client[lowerFirst(model)];
              return delegate[destino](nextArgs);
            }

            // 2) Lecturas por filtro.
            if (LECTURAS_POR_FILTRO.has(operation)) {
              nextArgs.where = conFiltroConjunto(nextArgs.where, conjuntoId);
              return query(nextArgs);
            }

            // 3) Escrituras/borrados con where.
            if (ESCRITURAS_CON_WHERE.has(operation)) {
              nextArgs.where = conFiltroConjunto(nextArgs.where, conjuntoId);
              if (nextArgs.data !== undefined) {
                nextArgs.data = forzarConjuntoEnData(nextArgs.data, conjuntoId);
              }
              return query(nextArgs);
            }

            // 4) Creaciones: conjuntoId SIEMPRE desde el contexto.
            if (operation === 'create' || operation === 'createMany') {
              nextArgs.data = forzarConjuntoEnData(nextArgs.data, conjuntoId);
              return query(nextArgs);
            }

            // 5) upsert: filtro en where + conjuntoId forzado en create/update.
            if (operation === 'upsert') {
              nextArgs.where = conFiltroConjunto(nextArgs.where, conjuntoId);
              if (nextArgs.create !== undefined) {
                nextArgs.create = forzarConjuntoEnData(nextArgs.create, conjuntoId);
              }
              if (nextArgs.update !== undefined) {
                nextArgs.update = forzarConjuntoEnData(nextArgs.update, conjuntoId);
              }
              return query(nextArgs);
            }

            // Operación no contemplada sobre un modelo con tenant: no se deja
            // pasar sin filtro (falla cerrado por defecto).
            throw new Error(
              `Aislamiento de tenant: operación no soportada '${operation}' sobre ` +
                `'${model}'. Revisa la extensión antes de usarla.`
            );
          },
        },
      },
    })
  );
}

function lowerFirst(s) {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
