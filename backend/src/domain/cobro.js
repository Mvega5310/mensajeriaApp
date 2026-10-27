// Reglas de cobro y cortesía (T1.2). Funciones puras: sin Prisma, sin reloj,
// sin efectos. Las consultas a la base viven en el controlador/servicio, que
// le pasa a estas funciones los datos ya leídos.
//
// Montos: enteros en COP (el Conjunto los guarda como Int).

import { AppError, CODIGOS } from './errores.js';

// Categorías de peso válidas (sin montos): fuente única; tariff.service la reexporta.
export const CATEGORIAS_VALIDAS = Object.freeze(['MANO', 'ESTANDAR', 'VOLUMEN', 'PESADO']);

export function esCategoriaValida(categoria) {
  return CATEGORIAS_VALIDAS.includes(categoria);
}

export const MOTIVOS_COBRO = Object.freeze({
  TARIFA: 'TARIFA',
  CORTESIA: 'CORTESIA',
  BONO: 'BONO',
});

const aMs = (fecha) => (fecha instanceof Date ? fecha.getTime() : Number(fecha));

/**
 * Cortesía de primera entrega: es POR APARTAMENTO FÍSICO (no por cuenta; el
 * agrupamiento por torre/apto lo resuelve quien llama con claveApartamento).
 * Un paquete es la primera entrega si ningún otro paquete del mismo
 * apartamento fue creado ANTES que él (por `createdAt`, no por fecha de
 * ingreso ni por estado: cuenta cualquier paquete previo, aunque esté
 * cancelado o sin cobrar). Empate exacto de `createdAt` => ambos son primera
 * (igual que el listado y el CSV originales).
 *
 * @param {object} p
 * @param {Date|number} p.createdAt  Creación del paquete evaluado.
 * @param {Array<Date|number>} p.createdAtDelApto  `createdAt` de los paquetes del
 *   mismo apartamento. Puede incluir al propio paquete; basta con pasar el más
 *   antiguo.
 * @returns {boolean}
 */
export function esPrimeraEntrega({ createdAt, createdAtDelApto = [] }) {
  const propio = aMs(createdAt);
  return !createdAtDelApto.some((otro) => aMs(otro) < propio);
}

/**
 * Cobro de un paquete al recibirlo. Precedencia (como el checkin original):
 *   1. cortesía de primera entrega -> $0, motivo CORTESIA (nunca consume bono);
 *   2. bono prepago, solo si el conjunto los tiene habilitados y hay al menos
 *      un crédito en la categoría -> $0, motivo BONO, consumeBono = true;
 *   3. tarifa del conjunto para la categoría -> motivo TARIFA.
 * La categoría se valida siempre, también en cortesía.
 *
 * @param {object} p
 * @param {{MANO:number,ESTANDAR:number,VOLUMEN:number,PESADO:number}} p.tarifas
 * @param {string} p.categoria
 * @param {boolean} p.esPrimeraEntrega
 * @param {boolean} p.bonosHabilitados
 * @param {number} p.creditosBono  Créditos disponibles en la categoría (0 si no hay).
 * @returns {{monto:number, motivo:'TARIFA'|'CORTESIA'|'BONO', consumeBono:boolean}}
 */
export function calcularCobro({ tarifas, categoria, esPrimeraEntrega: primera, bonosHabilitados, creditosBono }) {
  if (!esCategoriaValida(categoria)) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, 'La categoría de peso no es válida. Elige una de la lista.', 400);
  }
  if (primera) return { monto: 0, motivo: MOTIVOS_COBRO.CORTESIA, consumeBono: false };
  if (bonosHabilitados && creditosBono > 0) {
    return { monto: 0, motivo: MOTIVOS_COBRO.BONO, consumeBono: true };
  }
  return { monto: tarifas[categoria], motivo: MOTIVOS_COBRO.TARIFA, consumeBono: false };
}
