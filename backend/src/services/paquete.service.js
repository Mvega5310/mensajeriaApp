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

import { AppError, CODIGOS } from '../domain/errores.js';
import { transicionar } from '../domain/paquete.machine.js';

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

  return tx.package.findUnique({ where: { id: paquete.id } });
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
  const paquete = await tx.package.create({ data: { ...data, estado: aEstado } });
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
