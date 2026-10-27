// Máquina de estados pura del paquete (T1.1). Sin Prisma ni red.
//
// `null` como estado actual significa "el paquete aún no existe".
// La tabla de transiciones es la única fuente de verdad: cualquier
// combinación que no esté aquí lanza TRANSICION_INVALIDA (409).

import { AppError, CODIGOS } from './errores.js';

export const ESTADOS = Object.freeze({
  SIN_ASIGNAR: 'SIN_ASIGNAR',
  PREALERTADO: 'PREALERTADO',
  EN_RECEPCION: 'EN_RECEPCION',
  PROGRAMADO: 'PROGRAMADO',
  ENTREGADO: 'ENTREGADO',
});

export const EVENTOS = Object.freeze({
  RECIBIR_SIN_DUENO: 'RECIBIR_SIN_DUENO',
  PREALERTAR: 'PREALERTAR',
  RECIBIR: 'RECIBIR',
  ASIGNAR: 'ASIGNAR',
  PROGRAMAR: 'PROGRAMAR',
  DESPROGRAMAR: 'DESPROGRAMAR',
  ENTREGAR: 'ENTREGAR',
});

const E = ESTADOS;

// evento -> { estadoDesde: estadoHacia }. La clave 'null' es "no existe aún".
const TRANSICIONES = Object.freeze({
  [EVENTOS.RECIBIR_SIN_DUENO]: { null: E.SIN_ASIGNAR },
  [EVENTOS.PREALERTAR]: { null: E.PREALERTADO },
  [EVENTOS.RECIBIR]: { null: E.EN_RECEPCION, [E.PREALERTADO]: E.EN_RECEPCION },
  [EVENTOS.ASIGNAR]: { [E.SIN_ASIGNAR]: E.EN_RECEPCION },
  [EVENTOS.PROGRAMAR]: { [E.EN_RECEPCION]: E.PROGRAMADO, [E.PROGRAMADO]: E.PROGRAMADO },
  [EVENTOS.DESPROGRAMAR]: { [E.PROGRAMADO]: E.EN_RECEPCION },
  [EVENTOS.ENTREGAR]: { [E.EN_RECEPCION]: E.ENTREGADO, [E.PROGRAMADO]: E.ENTREGADO },
});

// Solo null/undefined significan "no existe"; el texto 'null' NO es un estado.
const claveEstado = (estado) => {
  if (estado === null || estado === undefined) return 'null';
  return typeof estado === 'string' && estado !== 'null' ? estado : '\0desconocido';
};

function destino(estadoActual, evento) {
  const desde = Object.hasOwn(TRANSICIONES, evento) ? TRANSICIONES[evento] : undefined;
  if (!desde) return undefined;
  const clave = claveEstado(estadoActual);
  return Object.hasOwn(desde, clave) ? desde[clave] : undefined;
}

function mensajeInvalida(estado, evento) {
  if (!Object.hasOwn(TRANSICIONES, evento)) {
    return 'No reconocemos esa acción sobre el paquete. Actualiza la pantalla e intenta de nuevo.';
  }
  if (estado === E.ENTREGADO) {
    if (evento === EVENTOS.RECIBIR) return 'Este paquete ya fue entregado. No se puede recibir otra vez.';
    return 'Este paquete ya fue entregado. No admite más cambios.';
  }
  if (evento === EVENTOS.ENTREGAR && (estado === E.PREALERTADO || estado === E.SIN_ASIGNAR)) {
    return 'Este paquete todavía no ingresó a portería. Recíbelo antes de entregarlo.';
  }
  if (evento === EVENTOS.PROGRAMAR && (estado === E.PREALERTADO || estado === E.SIN_ASIGNAR)) {
    return 'Este paquete todavía no ingresó a portería. Solo se puede programar la entrega cuando ya está recibido.';
  }
  if (evento === EVENTOS.ASIGNAR) {
    return 'Solo se puede asignar a un residente un paquete que llegó sin dueño.';
  }
  if (estado === null || estado === undefined) {
    return 'Este paquete aún no existe, así que no se puede hacer eso. Revisa e intenta de nuevo.';
  }
  return 'Esa acción no se puede hacer con el estado actual del paquete. Actualiza la pantalla e intenta de nuevo.';
}

/** Devuelve el nuevo estado o lanza AppError TRANSICION_INVALIDA (409). */
export function transicionar(estadoActual, evento) {
  const nuevo = destino(estadoActual, evento);
  if (nuevo === undefined) {
    throw new AppError(
      CODIGOS.TRANSICION_INVALIDA,
      mensajeInvalida(estadoActual ?? null, evento),
      409,
      { estado: estadoActual ?? null, evento },
    );
  }
  return nuevo;
}

export function puede(estadoActual, evento) {
  return destino(estadoActual, evento) !== undefined;
}

/** Eventos válidos desde un estado (`null` = paquete aún no existe). */
export function eventosPosibles(estadoActual) {
  return Object.values(EVENTOS).filter((ev) => puede(estadoActual, ev));
}
