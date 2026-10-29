// Lectura de la configuración del Conjunto (KAN-8, Fase D — design.md §4).
//
// Conjunto es un modelo EXENTO del aislamiento (no tiene conjuntoId, §1.5), así
// que se puede leer directo. Pero para el conjunto ACTIVO lo resolvemos por el
// conjuntoId del contexto de tenant (getContext()), NUNCA de datos del cliente.

import { prisma } from '../config/db.js';
import { getContext } from '../config/tenantContext.js';
import { AppError, CODIGOS } from '../domain/errores.js';
import { normalizarCodigoInvitacion } from './invitacion.service.js';

// Mapa categoría de peso -> columna de tarifa en Conjunto.
const COLUMNA_TARIFA = {
  MANO: 'tarifaMano',
  ESTANDAR: 'tarifaEstandar',
  VOLUMEN: 'tarifaVolumen',
  PESADO: 'tarifaPesado',
};

// Campos presentacionales que sí pueden mostrarse (incluye pre-sesión).
export function soloPresentacionales(conjunto) {
  return {
    nombre: conjunto.nombre,
    operadorNombre: conjunto.operadorNombre,
    operadorWhatsapp: conjunto.operadorWhatsapp,
    operadorDomicilio: conjunto.operadorDomicilio,
    puntoRecepcion: conjunto.puntoRecepcion,
  };
}

const CAMPOS_PUBLICOS_LISTA = { slug: true, nombre: true };

// PLAN-conjunto S1.3: "activo" = con la invitación activa (es el interruptor que ya existe
// para retirar un conjunto sin borrar su historial).

/** Conjuntos activos para el selector público: solo `{ slug, nombre }`, por nombre. */
export async function listarConjuntosActivos() {
  return prisma.conjunto.findMany({
    where: { invitacionActiva: true },
    select: CAMPOS_PUBLICOS_LISTA,
    orderBy: [{ nombre: 'asc' }, { slug: 'asc' }],
  });
}

/**
 * Conjunto activo por su slug (el cliente elige el conjunto por slug, nunca por id).
 * Slug inexistente o inactivo -> 400 CONJUNTO_INVALIDO. Conjunto es modelo exento: no
 * requiere contexto.
 */
export async function conjuntoActivoPorSlug(slug) {
  const invalido = () => new AppError(CODIGOS.CONJUNTO_INVALIDO, 'Ese conjunto no está disponible. Elige otro de la lista.', 400, { campo: 'conjunto' });
  if (typeof slug !== 'string' || !slug.trim() || slug.length > 80) throw invalido();
  const conjunto = await prisma.conjunto.findUnique({ where: { slug: slug.trim() } });
  if (!conjunto || !conjunto.invitacionActiva) throw invalido();
  return conjunto;
}

/**
 * Resuelve el conjunto de una solicitud SIN sesión (registro y config-publica), en este
 * orden: código de invitación (opcional, compatibilidad con los QR/enlaces `?c=`), slug
 * (`conjunto`) o, sin ninguno de los dos, el único conjunto activo (QR viejos sin `?c=`).
 * Con código y slug a la vez deben apuntar al mismo conjunto. Con varios conjuntos activos
 * y sin slug ni código -> 400 CONJUNTO_REQUERIDO; sin ninguno activo -> 400 INVITACION_INVALIDA.
 */
export async function resolverConjuntoPublico({ slug, codigo } = {}) {
  const hayCodigo = typeof codigo === 'string' && codigo.trim() !== '';
  const haySlug = slug !== undefined && slug !== null && slug !== '';
  let porCodigo = null;
  if (hayCodigo) {
    porCodigo = await prisma.conjunto.findUnique({ where: { codigoInvitacion: normalizarCodigoInvitacion(codigo) } });
    if (!porCodigo || !porCodigo.invitacionActiva) {
      throw new AppError(CODIGOS.INVITACION_INVALIDA, 'El enlace de invitación no es válido o ya venció. Pide uno nuevo a la administración.', 400);
    }
  }
  if (haySlug) {
    const porSlug = await conjuntoActivoPorSlug(slug);
    if (porCodigo && porCodigo.id !== porSlug.id) {
      throw new AppError(CODIGOS.CONJUNTO_INVALIDO, 'El código de invitación no corresponde al conjunto elegido.', 400, { campo: 'conjunto' });
    }
    return porSlug;
  }
  if (porCodigo) return porCodigo;
  const activos = await prisma.conjunto.findMany({ where: { invitacionActiva: true }, take: 2 });
  if (activos.length === 1) return activos[0];
  if (activos.length === 0) {
    throw new AppError(CODIGOS.INVITACION_INVALIDA, 'Por ahora no hay conjuntos disponibles para registrarse. Pregunta a la administración.', 400);
  }
  throw new AppError(CODIGOS.CONJUNTO_REQUERIDO, 'Elige tu conjunto para continuar.', 400, { campo: 'conjunto' });
}

// Tarifas como mapa { MANO, ESTANDAR, VOLUMEN, PESADO } desde las columnas.
export function tarifasDe(conjunto) {
  return {
    MANO: conjunto.tarifaMano,
    ESTANDAR: conjunto.tarifaEstandar,
    VOLUMEN: conjunto.tarifaVolumen,
    PESADO: conjunto.tarifaPesado,
  };
}

/**
 * Devuelve el registro Conjunto del contexto de tenant activo.
 * @returns {Promise<object>} el Conjunto
 * @throws si no hay contexto o el conjunto no existe.
 */
export async function conjuntoDelContexto() {
  const ctx = getContext();
  if (!ctx || !ctx.conjuntoId) {
    throw new Error('conjuntoDelContexto(): no hay conjunto en el contexto de tenant');
  }
  const conjunto = await prisma.conjunto.findUnique({ where: { id: ctx.conjuntoId } });
  if (!conjunto) {
    throw new Error(`conjuntoDelContexto(): conjunto ${ctx.conjuntoId} no existe`);
  }
  return conjunto;
}

// El operador del conjunto activo vive ahora en services/usuario.service.js (único
// acceso a `User`, PLAN-conjunto S1.1); se reexporta aquí por compatibilidad con los
// llamadores existentes. Filtra por el conjunto del contexto y rol OPERATOR.
export { operadorDelConjuntoActual } from './usuario.service.js';

export { COLUMNA_TARIFA };
