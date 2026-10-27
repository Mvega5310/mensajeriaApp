// Recepción de paquetes por el operador (T2.3): con o sin pre-alerta del residente
// y con o sin dueño conocido. Todo cambio de estado pasa por paquete.service.js
// (máquina de estados + PaqueteEvento) y el cobro por cobro.service.js, la misma
// función que usa `checkin`.
//
// Decisiones:
//  - PIN: se genera SIEMPRE al crear el paquete (la columna es NOT NULL y la entrega
//    lo necesita). Una pre-alerta existente conserva el PIN que ya tenía. El operador
//    NUNCA recibe el PIN (ni al recibir, ni al asignar, ni en el replay idempotente,
//    ni en el texto de WhatsApp): solo lo ve el residente, en su enlace, su app y el
//    correo de llegada.
//  - Cobro en SIN_ASIGNAR: todavía no hay residente, así que no hay cortesía ni bono
//    que evaluar. Se guarda `costoServicio = 0` y la categoría; el cobro real (cortesía
//    / bono / tarifa) se calcula en ASIGNAR, con el residente ya conocido.
//  - Idempotencia: la clave se guarda en la MISMA transacción que el paquete.

import { randomUUID } from 'node:crypto';
import { prisma } from '../config/db.js';
import { AppError, CODIGOS } from '../domain/errores.js';
import { EVENTOS, ESTADOS, transicionar } from '../domain/paquete.machine.js';
import {
  validarRecepcion, elegirPrealerta, validarClaveIdempotencia,
  GUIA_POR_DEFECTO, PROVEEDOR_POR_DEFECTO, normalizarGuia,
} from '../domain/recepcion.js';
import { etiquetaApartamento } from '../domain/apartamento.js';
import { aplicarEvento, crearConEvento } from './paquete.service.js';
import { generatePin } from './pin.service.js';
import { resolverCobro } from './cobro.service.js';
import { conjuntoDelContexto } from './conjunto.service.js';
import { armarAviso, enviarAvisoLlegada } from './avisos.service.js';
import { subirFotos, registrarFotos, descartarSubidas } from './fotos.service.js';

export const VENTANA_IDEMPOTENCIA_MS = 24 * 60 * 60 * 1000;

const noEncontradoResidente = () => new AppError(
  CODIGOS.NO_ENCONTRADO,
  'No encontramos a ese residente. Búscalo de nuevo e intenta otra vez.',
  404,
);

async function buscarResidente(tx, id) {
  const residente = await tx.user.findFirst({
    where: { id, role: 'RESIDENT' },
    select: { id: true, nombre: true, telefono: true, torre: true, apto: true },
  });
  if (!residente) throw noEncontradoResidente();
  return residente;
}

// Respuesta común de recepción y asignar. Lee el estado ya confirmado en la base,
// así una repetición idempotente devuelve exactamente lo mismo.
export async function armarRespuesta(paqueteId, conjunto) {
  const p = await prisma.package.findUnique({
    where: { id: paqueteId },
    include: { residente: { select: { id: true, nombre: true, telefono: true, torre: true, apto: true } } },
  });
  if (!p) throw new AppError(CODIGOS.NO_ENCONTRADO, 'No encontramos ese paquete. Actualiza la lista e intenta de nuevo.', 404);
  const evento = await prisma.paqueteEvento.findFirst({
    where: { paqueteId, tipo: { in: [EVENTOS.RECIBIR, EVENTOS.ASIGNAR] } },
    orderBy: { creadoEn: 'desc' },
  });
  const r = p.residente;
  const motivoCobro = evento?.datos?.motivoCobro ?? null;
  const paquete = {
    id: p.id,
    estado: p.estado,
    residenteId: p.residenteId,
    nombre: r?.nombre ?? p.etiquetaNombre ?? null,
    torre: r?.torre ?? null,
    apto: r?.apto ?? null,
    etiquetaApto: r ? etiquetaApartamento(r.torre, r.apto) : null,
    etiquetaNombre: p.etiquetaNombre,
    categoriaPeso: p.categoriaPeso,
    costo: r ? p.costoServicio : null,
    motivoCobro,
    guia: p.guia,
    transportadora: p.transportadora,
    recibidoEn: p.recibidoEn,
  };
  // El aviso de WhatsApp NO lleva el PIN (solo el residente lo ve, en el enlace).
  let aviso = null;
  if (r) {
    const { texto, waUrl } = armarAviso({ residente: r, paquete: p, conjunto });
    aviso = { texto, waUrl };
  }
  return { paquete, aviso };
}

async function respuestaPorClave(operadorId, clave, conjunto) {
  const desde = new Date(Date.now() - VENTANA_IDEMPOTENCIA_MS);
  const previa = await prisma.claveIdempotencia.findFirst({
    where: { operadorId, clave, creadoEn: { gte: desde } },
  });
  return previa ? armarRespuesta(previa.paqueteId, conjunto) : null;
}

/**
 * @param {{operadorId:string, body:object, claveCabecera?:string}} p
 * @returns {Promise<{respuesta:{paquete:object, aviso:object|null}, repetida:boolean}>}
 */
export async function recibirPaquete({ operadorId, body, claveCabecera, notificador, almacenFotos }) {
  const conjunto = await conjuntoDelContexto();
  const datos = validarRecepcion(body, { maxFotos: conjunto.maxFotos });
  const clave = validarClaveIdempotencia(claveCabecera);

  if (clave) {
    const previa = await respuestaPorClave(operadorId, clave, conjunto);
    if (previa) return { respuesta: previa, repetida: true };
  }

  // Fotos: se validan y suben ANTES de la transacción (no se retiene una conexión
  // de base de datos durante la subida). Si algo falla después, se borran.
  const { fotoUrl, subidas } = await subirFotos({ almacen: almacenFotos, conjuntoId: conjunto.id, fotos: datos.fotos });
  let paqueteId;
  try {
    paqueteId = await prisma.$transaction(async (tx) => {
      const ahora = new Date();
      let paquete;

      if (datos.residenteId) {
        const residente = await buscarResidente(tx, datos.residenteId);
        const abiertas = await tx.package.findMany({
          where: { residenteId: residente.id, estado: ESTADOS.PREALERTADO },
          select: { id: true, guia: true, createdAt: true },
        });
        const elegida = elegirPrealerta(abiertas, datos.guia);
        // Paquete nuevo: se le fija el id desde ya para poder reservar la cortesía.
        const nuevoId = elegida ? null : randomUUID();
        const r = await resolverCobro(tx, {
          conjunto, residente, categoria: datos.categoriaPeso, paqueteId: elegida?.id ?? nuevoId,
        });
        const eventoDatos = {
          categoriaPeso: datos.categoriaPeso, motivoCobro: r.cobro.motivo, monto: r.cobro.monto,
          bonoId: r.bonoId, conPrealerta: !!elegida,
        };

        if (elegida) {
          const fresco = await tx.package.findUnique({ where: { id: elegida.id } });
          const cambios = {
            categoriaPeso: datos.categoriaPeso,
            costoServicio: r.cobro.monto,
            bonoId: r.bonoId,
            fotoUrl,
            recibidoEn: ahora,
          };
          // Datos que trae el operador y la pre-alerta no tenía.
          if (datos.transportadora && !fresco.transportadora) cambios.transportadora = datos.transportadora;
          if (datos.guia && !normalizarGuia(fresco.guia)) cambios.guia = datos.guia;
          paquete = await aplicarEvento(tx, fresco, EVENTOS.RECIBIR, {
            actorId: operadorId, datos: eventoDatos, cambios,
          });
        } else {
          paquete = await crearConEvento(tx, EVENTOS.RECIBIR, {
            actorId: operadorId,
            datos: eventoDatos,
            data: {
              id: nuevoId,
              residenteId: residente.id,
              etiquetaNombre: datos.etiquetaNombre,
              proveedor: datos.transportadora ?? PROVEEDOR_POR_DEFECTO,
              guia: datos.guia ?? GUIA_POR_DEFECTO,
              transportadora: datos.transportadora,
              categoriaPeso: datos.categoriaPeso,
              costoServicio: r.cobro.monto,
              bonoId: r.bonoId,
              fotoUrl,
              pin: generatePin(),
              recibidoEn: ahora,
            },
          });
        }
      } else {
        paquete = await crearConEvento(tx, EVENTOS.RECIBIR_SIN_DUENO, {
          actorId: operadorId,
          datos: { categoriaPeso: datos.categoriaPeso, etiquetaNombre: datos.etiquetaNombre },
          data: {
            residenteId: null,
            etiquetaNombre: datos.etiquetaNombre,
            proveedor: datos.transportadora ?? PROVEEDOR_POR_DEFECTO,
            guia: datos.guia ?? GUIA_POR_DEFECTO,
            transportadora: datos.transportadora,
            categoriaPeso: datos.categoriaPeso,
            costoServicio: 0,
            fotoUrl,
            pin: generatePin(),
            recibidoEn: ahora,
          },
        });
      }

      if (clave) {
        // Una clave vencida (> 24 h) deja de proteger: se libera para poder reusarla.
        await tx.claveIdempotencia.deleteMany({
          where: { operadorId, clave, creadoEn: { lt: new Date(ahora.getTime() - VENTANA_IDEMPOTENCIA_MS) } },
        });
        await tx.claveIdempotencia.create({ data: { clave, operadorId, paqueteId: paquete.id } });
      }
      await registrarFotos(tx, paquete.id, subidas);
      return paquete.id;
    });
  } catch (e) {
    await descartarSubidas(almacenFotos, subidas);
    // Dos envíos simultáneos con la misma clave: el perdedor falla por la unicidad
    // (su transacción, bono incluido, se revierte) y devuelve lo que creó el ganador.
    if (clave && e?.code === 'P2002') {
      const previa = await respuestaPorClave(operadorId, clave, conjunto);
      if (previa) return { respuesta: previa, repetida: true };
    }
    throw e;
  }

  const respuesta = await armarRespuesta(paqueteId, conjunto);
  await avisarLlegadaDe(notificador, paqueteId, conjunto, respuesta.aviso);
  return { respuesta, repetida: false };
}

// Correo de llegada, SOLO tras confirmar la transacción y nunca en un replay.
// La búsqueda del destinatario se espera (es una lectura corta y hace el
// resultado determinista); el envío en sí es fire-and-forget y un fallo no se propaga.
async function avisarLlegadaDe(notificador, paqueteId, conjunto, aviso) {
  if (!notificador || !aviso) return; // sin dueño no hay a quién avisar
  try {
    const p = await prisma.package.findUnique({
      where: { id: paqueteId },
      include: { residente: { select: { id: true, nombre: true, email: true, telefono: true } } },
    });
    if (!p?.residente?.email) return;
    const { residente, ...paquete } = p;
    enviarAvisoLlegada(notificador, { residente, paquete, conjunto });
  } catch {
    console.error('[notificador] fallo al preparar "llegada"');
  }
}

/** Asigna un residente a un paquete SIN_ASIGNAR y calcula su cobro (SIN_ASIGNAR -> EN_RECEPCION). */
export async function asignarPaquete({ operadorId, paqueteId, residenteId, notificador }) {
  if (typeof residenteId !== 'string' || !residenteId) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, 'Elige el residente al que se le asigna el paquete.', 400, { campo: 'residenteId' });
  }
  const conjunto = await conjuntoDelContexto();

  await prisma.$transaction(async (tx) => {
    const fresco = await tx.package.findUnique({ where: { id: paqueteId } });
    if (!fresco) {
      throw new AppError(CODIGOS.NO_ENCONTRADO, 'No encontramos ese paquete. Actualiza la lista e intenta de nuevo.', 404);
    }
    // Transición primero: un paquete que no está sin asignar no debe gastar bono.
    transicionar(fresco.estado, EVENTOS.ASIGNAR);
    const residente = await buscarResidente(tx, residenteId);
    const r = await resolverCobro(tx, {
      conjunto, residente, categoria: fresco.categoriaPeso, paqueteId: fresco.id,
    });
    await aplicarEvento(tx, fresco, EVENTOS.ASIGNAR, {
      actorId: operadorId,
      datos: {
        residenteId: residente.id, categoriaPeso: fresco.categoriaPeso,
        motivoCobro: r.cobro.motivo, monto: r.cobro.monto, bonoId: r.bonoId,
      },
      cambios: { residenteId: residente.id, costoServicio: r.cobro.monto, bonoId: r.bonoId },
    });
  });

  const respuesta = await armarRespuesta(paqueteId, conjunto);
  await avisarLlegadaDe(notificador, paqueteId, conjunto, respuesta.aviso);
  return respuesta;
}
