// Lectura de la configuración del Conjunto (KAN-8, Fase D — design.md §4).
//
// Conjunto es un modelo EXENTO del aislamiento (no tiene conjuntoId, §1.5), así
// que se puede leer directo. Pero para el conjunto ACTIVO lo resolvemos por el
// conjuntoId del contexto de tenant (getContext()), NUNCA de datos del cliente.

import { prisma } from '../config/db.js';
import { getContext } from '../config/tenantContext.js';

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

export { COLUMNA_TARIFA };
