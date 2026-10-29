// Regla de selección del lote de entrega (T2.5). PURA: sin Prisma.
//
// DECISIONES (documentadas también en README):
//  1. El PIN es por PAQUETE (Package.pin). Un PIN que coincide con un paquete
//     entregable prueba que quien lo tiene es de ESE APARTAMENTO; por eso el lote
//     incluye TODOS los paquetes entregables del apartamento, aunque tengan otro
//     PIN y aunque sean de OTRO residente del mismo apartamento (cortesía y bono
//     ya se tratan por apartamento físico). Un apartamento = claveApartamento
//     (torre canónica+apto: "TORRE 2" y "T2" son la misma torre); si torre/apto están incompletos, el apartamento es la cuenta sola.
//  2. Colisión (4 dígitos): si el PIN coincide con paquetes de MÁS DE UN
//     apartamento no se adivina: AMBIGUO + opciones para que el operador elija; el
//     segundo dato es `residenteId` (de una opción) o `apto` ("T2 304", "304").
//  3. Solo son entregables los estados de ESTADOS_ENTREGABLES y con residente.

import { claveDeResidente } from '../services/apartamento.service.js';
import { etiquetaApartamento, interpretarBusqueda, tokenTorre } from './apartamento.js';

export const ESTADOS_ENTREGABLES = Object.freeze(['EN_RECEPCION', 'PROGRAMADO']);

/** Clave de agrupación por apartamento físico (o cuenta sola si está incompleto). */
export function claveDeApartamento(residente) {
  return claveDeResidente(residente);
}

function coincideApto(residente, texto) {
  const q = interpretarBusqueda(texto);
  if (!q.apto) return false;
  if (residente.apto == null || String(residente.apto).replace(/\D/g, '') !== q.apto) return false;
  return q.torre === undefined || tokenTorre(residente.torre) === q.torre;
}

/**
 * Paquetes entregables que el operador "apuntó" con `residenteId`/`apto` (sin
 * mirar el PIN). Sirve para contar un PIN incorrecto contra el bloqueo por
 * paquete (T1.4) cuando el operador indicó el apartamento. Sin ninguno de los
 * dos datos devuelve [] (un PIN que no coincide con nada no se puede atribuir).
 */
export function candidatosPorDesempate({ entregables, residenteId, apto }) {
  if (!residenteId && !apto) return [];
  let lista = entregables.filter((p) => p.residente && ESTADOS_ENTREGABLES.includes(p.estado));
  if (residenteId) lista = lista.filter((p) => p.residente.id === residenteId);
  if (apto) lista = lista.filter((p) => coincideApto(p.residente, apto));
  return lista;
}

/**
 * @param {object} p
 * @param {Array<{id:string, pin:string, estado:string, recibidoEn:Date|null, createdAt:Date,
 *   residente:{id:string, torre:string|null, apto:string|null}|null}>} p.entregables
 *   candidatos del conjunto (ya filtrados por tenant; aquí se re-filtra por estado).
 * @param {string} p.pin
 * @param {string} [p.residenteId]  desempate: dueño de algún paquete con ese PIN.
 * @param {string} [p.apto]         desempate: "T2 304" / "304".
 * @returns {{tipo:'NINGUNO'}
 *   | {tipo:'AMBIGUO', opciones:Array<{residenteId:string, etiquetaApto:string}>}
 *   | {tipo:'OK', residente:object, coincidentes:object[], lote:object[]}}
 */
export function seleccionarLote({ entregables, pin, residenteId, apto }) {
  const validos = entregables.filter((p) => p.residente && ESTADOS_ENTREGABLES.includes(p.estado));
  let coincidentes = validos.filter((p) => p.pin === pin);
  if (residenteId) coincidentes = coincidentes.filter((p) => p.residente.id === residenteId);
  if (apto) coincidentes = coincidentes.filter((p) => coincideApto(p.residente, apto));
  if (!coincidentes.length) return { tipo: 'NINGUNO' };

  const grupos = new Map();
  for (const p of coincidentes) {
    const k = claveDeApartamento(p.residente);
    if (!grupos.has(k)) grupos.set(k, p);
  }
  if (grupos.size > 1) {
    return {
      tipo: 'AMBIGUO',
      opciones: [...grupos.values()].map((p) => ({
        residenteId: p.residente.id,
        etiquetaApto: etiquetaApartamento(p.residente.torre, p.residente.apto),
      })).sort((a, b) => a.etiquetaApto.localeCompare(b.etiquetaApto, 'es', { numeric: true })),
    };
  }

  const [clave, primero] = [...grupos.entries()][0];
  const fecha = (p) => (p.recibidoEn ?? p.createdAt).getTime();
  const lote = validos.filter((p) => claveDeApartamento(p.residente) === clave).sort((a, b) => fecha(a) - fecha(b));
  return { tipo: 'OK', residente: primero.residente, coincidentes, lote };
}

/** Clave de la PERSONA/dirección de un paquete: su Domicilio (o, sin él, la cuenta). */
export function clavePersona(p) {
  return p.domicilioId ?? `cuenta:${p.residenteId ?? p.residente?.id ?? ''}`;
}

/**
 * Revisión S3.2 (C5): el lote es por apartamento físico, pero en un mismo apartamento puede
 * haber dos personas (dos Domicilios) con paquetes. Marca cuáles se PRESELECCIONAN —solo los
 * del Domicilio dueño del PIN tecleado (los `coincidentes`)— y si el lote mezcla personas
 * (`variasPersonas`), para que el operador vea el nombre de cada paquete y desmarque los que
 * no sean de quien dio el PIN.
 * @returns {{seleccionados:Set<string>, variasPersonas:boolean}} ids preseleccionados.
 */
export function seleccionPorDuenoDelPin({ lote, coincidentes }) {
  const duenos = new Set(coincidentes.map(clavePersona));
  const variasPersonas = new Set(lote.map(clavePersona)).size > 1;
  const seleccionados = new Set(lote.filter((p) => !variasPersonas || duenos.has(clavePersona(p))).map((p) => p.id));
  return { seleccionados, variasPersonas };
}
