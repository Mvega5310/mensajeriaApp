// Aplicación de la máquina de estados del paquete con bitácora (T1.3).
//
// Todo cambio de estado pasa por aquí: calcula el destino con la máquina pura
// (domain/paquete.machine.js), actualiza el paquete y deja UN PaqueteEvento, todo
// con el `tx` que reciba el llamador (una `prisma.$transaction(async (tx) => ...)`
// del cliente extendido: la extensión de tenant y el AsyncLocalStorage funcionan
// dentro de la transacción interactiva, ver paquete.integration.test.js).
//
// Reglas: nunca se pasa `conjuntoId` en `data` (invariante 7: lo pone la
// extensión) y el llamador es quien abre la transacción y hace `await` dentro del
// contexto de tenant (invariante 4).

import { Prisma } from '@prisma/client';
import { AppError, CODIGOS } from '../domain/errores.js';
import { prisma } from '../config/db.js';
import { EVENTOS, transicionar } from '../domain/paquete.machine.js';

/**
 * `select` de Package para listados y lecturas que NO necesitan la foto: todas las
 * columnas escalares salvo `fotoUrl` (base64 de cientos de KB en datos legados; ver
 * CLAUDE.md, "Fotos fuera de los listados") y `pin` (solo el residente dueño lo ve).
 * Se calcula desde el esquema, así una columna nueva entra sola; `fotoUrl` y `pin`
 * solo se piden por nombre. `omit` de Prisma sigue en vista previa en 5.x: no se usa.
 * @param {{conPin?:boolean, quitar?:string[]}} [o]  conPin: incluye `pin` (dueño o correo
 *   de llegada); quitar: columnas adicionales a excluir.
 */
export function selectSinFoto({ conPin = false, quitar = [] } = {}) {
  const fuera = new Set(['fotoUrl', ...(conPin ? [] : ['pin']), ...quitar]);
  return Object.fromEntries(
    Object.values(Prisma.PackageScalarFieldEnum).filter((c) => !fuera.has(c)).map((c) => [c, true]),
  );
}

/**
 * Aplica `evento` a un paquete existente.
 * @param {object} tx        cliente transaccional del cliente extendido.
 * @param {{id:string, estado:string}} paquete  paquete leído (dentro de la tx).
 * @param {string} evento    uno de EVENTOS.
 * @param {{actorId?:string, datos?:object, cambios?:object}} [opciones]
 * @returns {Promise<object>} el paquete actualizado.
 * @throws AppError TRANSICION_INVALIDA (409) si el evento no aplica, o si otro
 *   proceso cambió el estado entre la lectura y la escritura.
 */
export async function aplicarEvento(tx, paquete, evento, { actorId, datos, cambios } = {}) {
  const aEstado = transicionar(paquete.estado, evento);

  // Escritura condicionada al estado leído: si dos peticiones concurrentes
  // intentan el mismo cambio, solo una gana y la otra recibe 409 (y su
  // transacción, incluido el consumo de bono, se revierte).
  const { count } = await tx.package.updateMany({
    where: { id: paquete.id, estado: paquete.estado },
    data: { ...(cambios ?? {}), estado: aEstado },
  });
  if (count !== 1) {
    throw new AppError(
      CODIGOS.TRANSICION_INVALIDA,
      'El paquete cambió mientras lo procesabas. Actualiza la pantalla e intenta de nuevo.',
      409,
      { estado: paquete.estado, evento },
    );
  }

  await tx.paqueteEvento.create({
    data: {
      paqueteId: paquete.id,
      tipo: evento,
      deEstado: paquete.estado,
      aEstado,
      actorId: actorId ?? null,
      datos: datos ?? undefined,
    },
  });

  return tx.package.findUnique({ where: { id: paquete.id }, select: selectSinFoto({ conPin: true }) });
}

/**
 * Crea un paquete nuevo como efecto de un evento (PREALERTAR, RECIBIR_SIN_DUENO,
 * RECIBIR directo): `deEstado` queda null.
 * @param {object} tx
 * @param {string} evento
 * @param {{data:object, actorId?:string, datos?:object}} p  `data` sin estado ni conjuntoId.
 */
export async function crearConEvento(tx, evento, { data, actorId, datos }) {
  const aEstado = transicionar(null, evento);
  const paquete = await tx.package.create({ data: { ...data, estado: aEstado }, select: selectSinFoto({ conPin: true }) });
  await tx.paqueteEvento.create({
    data: {
      paqueteId: paquete.id,
      tipo: evento,
      deEstado: null,
      aEstado,
      actorId: actorId ?? null,
      datos: datos ?? undefined,
    },
  });
  return paquete;
}

/**
 * Motivo del cobro de cada paquete (CORTESIA, BONO, TARIFA...), tomado del evento
 * RECIBIR/ASIGNAR más reciente. Así los listados del residente no tienen que inferir
 * "Gratis" por costo 0. Devuelve Map<paqueteId, motivo|null> (solo los que tienen evento).
 * Debe correr dentro de un contexto de tenant.
 */
export async function motivosDeCobro(paqueteIds) {
  const mapa = new Map();
  if (!paqueteIds.length) return mapa;
  const eventos = await prisma.paqueteEvento.findMany({
    where: { paqueteId: { in: paqueteIds }, tipo: { in: [EVENTOS.RECIBIR, EVENTOS.ASIGNAR] } },
    orderBy: { creadoEn: 'desc' },
    select: { paqueteId: true, datos: true },
  });
  for (const e of eventos) if (!mapa.has(e.paqueteId)) mapa.set(e.paqueteId, e.datos?.motivoCobro ?? null);
  return mapa;
}
