// Tarifas por conjunto (KAN-8, Fase D — design.md §4.2). UNA SOLA FUENTE: las
// tarifas viven en el Conjunto (columnas tarifaMano/Estandar/Volumen/Pesado) y
// se leen por el conjuntoId del contexto de tenant, NUNCA del cliente (que solo
// envía la categoría). Ya no existe una constante TARIFAS como fuente de verdad;
// los valores por defecto viven en los @default(...) del esquema Prisma.

import { conjuntoDelContexto, tarifasDe } from './conjunto.service.js';

// Categorías válidas (sin montos): sirve para validar la categoría sin exponer
// ni duplicar tarifas.
export const CATEGORIAS_VALIDAS = Object.freeze(['MANO', 'ESTANDAR', 'VOLUMEN', 'PESADO']);

export function esCategoriaValida(categoriaPeso) {
  return CATEGORIAS_VALIDAS.includes(categoriaPeso);
}

/**
 * Costo del servicio para una categoría, según las tarifas del conjunto ACTIVO.
 * Async: lee el Conjunto del contexto. Lanza si la categoría es inválida.
 * @param {string} categoriaPeso
 * @returns {Promise<number>}
 */
export async function costoPara(categoriaPeso) {
  if (!esCategoriaValida(categoriaPeso)) {
    throw new Error(`Categoría de peso inválida: ${categoriaPeso}`);
  }
  const conjunto = await conjuntoDelContexto();
  const tarifas = tarifasDe(conjunto);
  return tarifas[categoriaPeso];
}
