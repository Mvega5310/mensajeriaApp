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
import { vistaResidente } from './domicilio.service.js';

// Cobro por APARTAMENTO FÍSICO del conjunto (no por persona). Desde PLAN-conjunto S1.1 el
// apartamento sale del Domicilio (no de la cuenta): dos personas con cuentas distintas y
// Domicilios en el mismo torre/apto comparten cortesía y lote. La clave sigue siendo la
// de `claveApartamento` (torre token | apto), así que las filas existentes de
// CortesiaApartamento siguen valiendo sin migrarlas.

const sinRepetidos = (xs) => [...new Set(xs.filter(Boolean))];

// Domicilios (del conjunto del contexto) del MISMO apartamento físico que `residente`.
// Torre/apto incompletos => solo su domicilio. El filtro por apto en la base solo acota
// la lectura; la igualdad real es por clave normalizada ("TORRE 2" = "T2").
async function domiciliosDelApartamento(tx, residente, clave) {
  if (clave.startsWith('cuenta:')) {
    return residente.domicilioId ? [{ id: residente.domicilioId, usuarioId: residente.id }] : [];
  }
  const candidatos = await tx.domicilio.findMany({
    where: { apto: normalizarApto(residente.apto) },
    select: { id: true, usuarioId: true, torre: true, apto: true },
  });
  const mismos = candidatos.filter((d) => claveDeResidente({ id: d.usuarioId, torre: d.torre, apto: d.apto }) === clave);
  if (residente.domicilioId && !mismos.some((d) => d.id === residente.domicilioId)) {
    mismos.push({ id: residente.domicilioId, usuarioId: residente.id });
  }
  return mismos;
}

// Paquetes de esos domicilios; los anteriores a S1.1 sin Domicilio se cuentan por su cuenta.
const filtroDeDomicilios = (doms) => ({
  OR: [
    { domicilioId: { in: doms.map((d) => d.id) } },
    { domicilioId: null, residenteId: { in: sinRepetidos(doms.map((d) => d.usuarioId)) } },
  ],
});

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
    const doms = await domiciliosDelApartamento(tx, residente, clave);
    // Sin ningún domicilio (residente legado sin Domicilio): la cuenta sola, como antes.
    const filtro = doms.length ? filtroDeDomicilios(doms) : { residenteId: residente.id };
    const delApto = await tx.package.findMany({
      where: { ...filtro, estado: { in: [...ESTADOS_COBRADOS] }, id: { not: paqueteId } },
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
 * Domicilios de los apartamentos físicos a los que pertenecen los paquetes que se
 * muestran (por `domicilioIds` y/o por las cuentas `residenteIds`), en UNA lectura (el
 * filtro por apto en la base solo acota; la igualdad real es por clave normalizada).
 */
async function domiciliosDeApartamentosDe({ residenteIds, domicilioIds }) {
  const base = await prisma.domicilio.findMany({
    where: { OR: [{ id: { in: domicilioIds } }, { usuarioId: { in: residenteIds } }] },
    select: { id: true, usuarioId: true, torre: true, apto: true },
  });
  const clave = (d) => claveDeResidente({ id: d.usuarioId, torre: d.torre, apto: d.apto });
  const claves = new Set(base.map(clave));
  const aptos = sinRepetidos(base.map((d) => normalizarApto(d.apto)));
  const doms = new Map(base.map((d) => [d.id, d]));
  if (aptos.length) {
    const candidatos = await prisma.domicilio.findMany({
      where: { apto: { in: aptos } },
      select: { id: true, usuarioId: true, torre: true, apto: true },
    });
    for (const d of candidatos) if (claves.has(clave(d))) doms.set(d.id, d);
  }
  return [...doms.values()];
}

/**
 * Ids de los paquetes que se llevaron la cortesía de primera entrega, para el
 * listado del operador y el CSV ("Primera vez"). La cortesía es del primer paquete
 * COBRADO del apartamento (que puede estar fuera de un filtro de estado o de
 * fechas), así que se lee el historial completo, pero SOLO de los apartamentos de
 * los paquetes que se están mostrando, no de todo el conjunto, y solo los
 * eventos RECIBIR/ASIGNAR de esos paquetes. Nada de fotoUrl/pin. Fuera de
 * transacción; usa el contexto.
 * @param {{residenteIds?: Array<string|null>, domicilioIds?: Array<string|null>}} p
 * @returns {Promise<Set<string>>}
 */
export async function idsPrimeraEntrega({ residenteIds, domicilioIds }) {
  const ur = sinRepetidos(residenteIds ?? []);
  const dm = sinRepetidos(domicilioIds ?? []);
  if (!ur.length && !dm.length) return new Set();
  const doms = await domiciliosDeApartamentosDe({ residenteIds: ur, domicilioIds: dm });
  const filtro = doms.length ? filtroDeDomicilios(doms) : { residenteId: { in: ur } };
  const paquetes = await prisma.package.findMany({
    where: { ...filtro, estado: { in: [...ESTADOS_COBRADOS] } },
    select: {
      id: true, estado: true, residenteId: true, createdAt: true, recibidoEn: true,
      domicilio: { select: { nombreRecibe: true, telefono: true, torre: true, apto: true } },
      residente: { select: { id: true, nombre: true, telefono: true, torre: true, apto: true } },
    },
  });
  if (!paquetes.length) return new Set();
  const eventos = await prisma.paqueteEvento.findMany({
    where: { paqueteId: { in: paquetes.map((p) => p.id) }, tipo: { in: [EVENTOS.RECIBIR, EVENTOS.ASIGNAR] } },
    orderBy: { creadoEn: 'desc' },
    select: { paqueteId: true, datos: true, creadoEn: true },
  });
  const porPaquete = new Map();
  for (const e of eventos) if (!porPaquete.has(e.paqueteId)) porPaquete.set(e.paqueteId, e);
  return primerasEntregas(paquetes.map((p) => {
    const e = porPaquete.get(p.id);
    return {
      id: p.id,
      clave: claveDeResidente(vistaResidente(p)),
      estado: p.estado,
      residenteId: p.residenteId,
      motivoCobro: e ? (e.datos?.motivoCobro ?? null) : null,
      cobradoEn: e?.creadoEn ?? p.recibidoEn ?? null,
      createdAt: p.createdAt,
    };
  }));
}
