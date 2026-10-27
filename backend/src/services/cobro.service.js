// Cobro de un paquete al recibirlo, con lectura de datos y bono atómico (T2.3).
//
// ÚNICA función de cobro al recibir: la usan `checkin` (pre-alerta existente),
// `POST /packages/recepcion` y `PATCH /packages/:id/asignar`. La regla pura vive
// en domain/cobro.js (`calcularCobro`); aquí solo se leen los datos y se consume
// el bono. Debe llamarse DENTRO de la transacción (`tx`) que luego escribe el
// paquete y su evento: si esa transacción falla, el crédito consumido se revierte.

import { prisma } from '../config/db.js';
import { claveDeResidente, normalizarApto } from './apartamento.service.js';
import { tarifasDe } from './conjunto.service.js';
import {
  esPrimeraEntrega, calcularCobro, primerasEntregas, MOTIVOS_COBRO, ESTADOS_COBRADOS,
} from '../domain/cobro.js';
import { EVENTOS } from '../domain/paquete.machine.js';

// Cuentas (ids) del MISMO apartamento físico que `residente`. Torre/apto
// incompletos => la cuenta sola. El filtro por apto en la base solo acota la
// lectura; la igualdad real es por clave normalizada ("TORRE 2" = "T2").
async function idsDelApartamento(tx, residente, clave) {
  if (clave.startsWith('cuenta:')) return [residente.id];
  const candidatos = await tx.user.findMany({
    where: { role: 'RESIDENT', apto: { contains: normalizarApto(residente.apto) } },
    select: { id: true, torre: true, apto: true },
  });
  const ids = candidatos.filter((u) => claveDeResidente(u) === clave).map((u) => u.id);
  return ids.includes(residente.id) ? ids : [...ids, residente.id];
}

// Reserva la cortesía del apartamento insertando su fila en CortesiaApartamento.
// `createMany({ skipDuplicates })` es INSERT ... ON CONFLICT DO NOTHING (Prisma
// puro, sin SQL crudo): no aborta la transacción como un P2002, y en READ COMMITTED
// una inserción concurrente del mismo [conjunto, apartamento] ESPERA a que la otra
// transacción confirme o revierta. Si la otra confirma => count 0 (pierdes: TARIFA);
// si revierte => la fila no existe y esta la obtiene. La fila vive y muere con la
// transacción del paquete, así que un fallo posterior libera la cortesía.
async function reservarCortesia(tx, claveApto, paqueteId) {
  const { count } = await tx.cortesiaApartamento.createMany({
    data: [{ claveApto, paqueteId }],
    skipDuplicates: true,
  });
  return count === 1;
}

/**
 * @param {object} tx  cliente transaccional del cliente extendido (tenant).
 * @param {object} p
 * @param {object} p.conjunto  registro Conjunto del contexto (tarifas, bonosHabilitados).
 * @param {{id:string, torre:string|null, apto:string|null}|null} p.residente  null = sin dueño
 *   (no hay cortesía ni bono: se cobraría TARIFA; los SIN_ASIGNAR no cobran hasta asignarse).
 * @param {string} p.categoria  categoría de peso (se valida en calcularCobro).
 * @param {string} p.paqueteId  id del paquete que se cobra (para excluirlo y para la reserva).
 * @returns {Promise<{cobro:{monto:number,motivo:string}, bono:{id:string,quedan:number}|null,
 *   bonoId:string|null, esPrimeraEntrega:boolean}>}
 */
export async function resolverCobro(tx, { conjunto, residente, categoria, paqueteId }) {
  // Cortesía: primer paquete del apartamento que se COBRA (ver domain/cobro.js).
  // 1) lectura: ¿algún otro paquete del apto ya fue cobrado?
  // 2) si no, se intenta reservar la cortesía (serializa recepciones paralelas).
  let primera = false;
  if (residente) {
    const clave = claveDeResidente(residente);
    const ids = await idsDelApartamento(tx, residente, clave);
    const delApto = await tx.package.findMany({
      where: { residenteId: { in: ids }, estado: { in: [...ESTADOS_COBRADOS] }, id: { not: paqueteId } },
      select: { id: true, estado: true, residenteId: true },
      take: 1,
    });
    if (esPrimeraEntrega({ paquetesDelApto: delApto, excluirId: paqueteId })) {
      primera = await reservarCortesia(tx, clave, paqueteId);
    }
  }

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

/**
 * Ids de los paquetes del conjunto que se llevaron la cortesía, para el listado
 * del operador y el CSV ("Primera vez"). Lee TODOS los paquetes (el primer cobrado
 * de un apartamento puede quedar fuera de un filtro de estado o de fechas) y los
 * eventos RECIBIR/ASIGNAR (motivoCobro). Fuera de transacción; usa el contexto.
 * @returns {Promise<Set<string>>}
 */
export async function idsPrimeraEntrega() {
  const paquetes = await prisma.package.findMany({
    where: { residenteId: { not: null }, estado: { in: [...ESTADOS_COBRADOS] } },
    select: {
      id: true, estado: true, residenteId: true, createdAt: true, recibidoEn: true,
      residente: { select: { id: true, torre: true, apto: true } },
    },
  });
  if (!paquetes.length) return new Set();
  const eventos = await prisma.paqueteEvento.findMany({
    where: { tipo: { in: [EVENTOS.RECIBIR, EVENTOS.ASIGNAR] } },
    orderBy: { creadoEn: 'desc' },
    select: { paqueteId: true, datos: true, creadoEn: true },
  });
  const porPaquete = new Map();
  for (const e of eventos) if (!porPaquete.has(e.paqueteId)) porPaquete.set(e.paqueteId, e);
  return primerasEntregas(paquetes.map((p) => {
    const e = porPaquete.get(p.id);
    return {
      id: p.id,
      clave: claveDeResidente(p.residente),
      estado: p.estado,
      residenteId: p.residenteId,
      motivoCobro: e ? (e.datos?.motivoCobro ?? null) : null,
      cobradoEn: e?.creadoEn ?? p.recibidoEn ?? null,
      createdAt: p.createdAt,
    };
  }));
}
