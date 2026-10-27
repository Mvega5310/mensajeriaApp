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

/**
 * Un paquete "ya se cobró" cuando tiene dueño y pasó por RECIBIR/ASIGNAR: su
 * estado es EN_RECEPCION, PROGRAMADO o ENTREGADO. Criterio por ESTADO (y no por
 * `recibidoEn`) porque es el más robusto: `recibidoEn` también se llena al recibir
 * SIN_ASIGNAR (que aún no cobra) y los paquetes legados no lo tienen; en cambio el
 * estado solo avanza (la máquina no vuelve a PREALERTADO/SIN_ASIGNAR) y cubre los
 * datos viejos sin eventos.
 */
export const ESTADOS_COBRADOS = Object.freeze(['EN_RECEPCION', 'PROGRAMADO', 'ENTREGADO']);

export function estaCobrado({ estado, residenteId }) {
  return !!residenteId && ESTADOS_COBRADOS.includes(estado);
}

/**
 * Cortesía de primera entrega (revisión F2): es para el PRIMER PAQUETE DEL
 * APARTAMENTO QUE SE COBRA, no para el primero que se creó. Un paquete es primera
 * entrega si NINGÚN otro paquete del mismo apartamento físico (todas sus cuentas;
 * lo agrupa quien llama con claveApartamento) ya fue cobrado. Un SIN_ASIGNAR o una
 * pre-alerta antigua no "gastan" la cortesía hasta que se cobran.
 *
 * @param {object} p
 * @param {Array<{id:string, estado:string, residenteId:string|null}>} p.paquetesDelApto
 *   paquetes del apartamento (puede incluir al evaluado: se excluye por `excluirId`).
 * @param {string} [p.excluirId]  id del paquete que se está evaluando.
 * @returns {boolean}
 */
export function esPrimeraEntrega({ paquetesDelApto = [], excluirId }) {
  return !paquetesDelApto.some((p) => p.id !== excluirId && estaCobrado(p));
}

const aMs = (f) => (f instanceof Date ? f.getTime() : Number(f));

/**
 * Para los listados y el CSV ("Primera vez" / "Primera entrega"): de un conjunto
 * de paquetes ya existentes, cuáles se llevaron la cortesía. Coherente con la
 * regla de arriba: por apartamento, entre los COBRADOS.
 *  - Si el apartamento tiene un paquete cobrado con motivoCobro 'CORTESIA'
 *    (evento RECIBIR/ASIGNAR), esa es la primera entrega.
 *  - Datos legados (cobrados SIN evento, motivoCobro null): si el apartamento no
 *    tiene ninguna CORTESIA registrada, es el cobrado legado más antiguo
 *    (`cobradoEn ?? createdAt`, desempate por id).
 *
 * @param {Array<{id:string, clave:string, estado:string, residenteId:string|null,
 *   motivoCobro:string|null, cobradoEn:Date|null, createdAt:Date}>} paquetes
 *   `clave` la calcula quien llama (claveDeResidente; "paquete:<id>" si no hay dueño).
 * @returns {Set<string>} ids de los paquetes que son primera entrega.
 */
export function primerasEntregas(paquetes) {
  const porClave = new Map();
  for (const p of paquetes) {
    if (!estaCobrado(p)) continue;
    if (!porClave.has(p.clave)) porClave.set(p.clave, []);
    porClave.get(p.clave).push(p);
  }
  const ids = new Set();
  for (const grupo of porClave.values()) {
    const conCortesia = grupo.filter((p) => p.motivoCobro === MOTIVOS_COBRO.CORTESIA);
    if (conCortesia.length) { conCortesia.forEach((p) => ids.add(p.id)); continue; }
    const legados = grupo.filter((p) => p.motivoCobro == null)
      .sort((a, b) => aMs(a.cobradoEn ?? a.createdAt) - aMs(b.cobradoEn ?? b.createdAt) || (a.id < b.id ? -1 : 1));
    if (legados.length) ids.add(legados[0].id);
  }
  return ids;
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
