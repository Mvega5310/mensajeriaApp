// Cobro de un paquete al recibirlo, con lectura de datos y bono atómico (T2.3).
//
// ÚNICA función de cobro al recibir: la usan `checkin` (pre-alerta existente),
// `POST /packages/recepcion` y `PATCH /packages/:id/asignar`. La regla pura vive
// en domain/cobro.js (`calcularCobro`); aquí solo se leen los datos y se consume
// el bono. Debe llamarse DENTRO de la transacción (`tx`) que luego escribe el
// paquete y su evento: si esa transacción falla, el crédito consumido se revierte.

import { claveApartamento } from './apartamento.service.js';
import { tarifasDe } from './conjunto.service.js';
import { esPrimeraEntrega, calcularCobro, MOTIVOS_COBRO } from '../domain/cobro.js';

/**
 * @param {object} tx  cliente transaccional del cliente extendido (tenant).
 * @param {object} p
 * @param {object} p.conjunto  registro Conjunto del contexto (tarifas, bonosHabilitados).
 * @param {{id:string, torre:string|null, apto:string|null}|null} p.residente  null = sin dueño
 *   (no hay cortesía ni bono: se cobraría TARIFA; los SIN_ASIGNAR no cobran hasta asignarse).
 * @param {string} p.categoria  categoría de peso (se valida en calcularCobro).
 * @param {Date} p.createdAt  creación del paquete evaluado (un paquete aún no creado: `new Date()`).
 * @returns {Promise<{cobro:{monto:number,motivo:string}, bono:{id:string,quedan:number}|null,
 *   bonoId:string|null, esPrimeraEntrega:boolean}>}
 */
export async function resolverCobro(tx, { conjunto, residente, categoria, createdAt }) {
  // Cortesía por APARTAMENTO físico: se agrupan todas las cuentas del mismo
  // torre/apto; torre/apto incompletos => la cuenta sola.
  const clave = residente ? claveApartamento(residente.torre, residente.apto) : '';
  let idsRelevantes = residente ? [residente.id] : [];
  if (clave) {
    const residentes = await tx.user.findMany({
      where: { role: 'RESIDENT' },
      select: { id: true, torre: true, apto: true },
    });
    idsRelevantes = residentes
      .filter((u) => claveApartamento(u.torre, u.apto) === clave)
      .map((u) => u.id);
  }
  const primerPaquete = idsRelevantes.length
    ? await tx.package.findFirst({
      where: { residenteId: { in: idsRelevantes } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    })
    : null;
  const primera = !!residente && esPrimeraEntrega({
    createdAt,
    createdAtDelApto: primerPaquete ? [primerPaquete.createdAt] : [],
  });

  // Candidatos de bono: del residente, en esta categoría, con crédito; el más
  // antiguo primero (un bono de otra categoría no aplica).
  let candidatos = [];
  if (!primera && conjunto.bonosHabilitados && residente) {
    candidatos = (await tx.bono.findMany({
      where: { residenteId: residente.id, categoriaPeso: categoria },
      orderBy: { createdAt: 'asc' },
    })).filter((b) => b.cantidadUsada < b.cantidadTotal);
  }
  const tarifas = tarifasDe(conjunto);
  let cobro = calcularCobro({
    tarifas,
    categoria,
    esPrimeraEntrega: primera,
    bonosHabilitados: conjunto.bonosHabilitados,
    creditosBono: candidatos.length,
  });

  // Decremento CONDICIONAL: solo si aún queda crédito en la base (count === 1).
  // Si otra transacción concurrente se lo llevó se prueba el siguiente bono; si
  // ninguno cede crédito, el cobro se recalcula como TARIFA (no se bloquea al
  // operador en portería).
  let bono = null;
  if (cobro.consumeBono) {
    for (const c of candidatos) {
      const { count } = await tx.bono.updateMany({
        where: { id: c.id, cantidadUsada: { lt: c.cantidadTotal } },
        data: { cantidadUsada: { increment: 1 } },
      });
      if (count === 1) {
        const usado = (await tx.bono.findUnique({ where: { id: c.id } })).cantidadUsada;
        bono = { id: c.id, quedan: c.cantidadTotal - usado };
        break;
      }
    }
    if (!bono) cobro = { monto: tarifas[categoria], motivo: MOTIVOS_COBRO.TARIFA, consumeBono: false };
  }

  return {
    cobro: { monto: cobro.monto, motivo: cobro.motivo },
    bono,
    bonoId: bono?.id ?? null,
    esPrimeraEntrega: primera,
  };
}
