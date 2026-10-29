// Enlace firmado del residente (T3.1): emisión, apertura y la vista "Mis paquetes".
//
// Resolución del tenant SIN GLOBAL_LOOKUP ni SQL crudo: el token firmado ya trae
// el conjuntoId, y la firma (HMAC) garantiza que lo emitimos nosotros. Con él se
// abre un contexto TENANT normal (runWithTenant). Si el conjuntoId no coincidiera
// con alguno donde el residente tiene Domicilio, la extensión de Prisma filtra por ese
// conjunto, el Domicilio no existe ahí y el residente "no existe" (404): no hay fuga
// entre conjuntos (la cuenta ya no está aislada por tenant; el Domicilio sí).

import jwt from 'jsonwebtoken';
import { prisma } from '../config/db.js';
import { secretoEnlace } from '../config/env.js';
import { runWithTenant } from '../config/tenantContext.js';
import { AppError, CODIGOS } from '../domain/errores.js';
import { firmar, verificar, vencimientoPorDefecto } from '../domain/enlace.js';
import { ESTADOS, EVENTOS } from '../domain/paquete.machine.js';
import { etiquetaApartamento } from '../domain/apartamento.js';
import { franjasDe } from '../domain/conjuntoConfig.js';
import { METODOS_PAGO } from '../domain/pago.js';
import { conjuntoDelContexto } from './conjunto.service.js';
import { motivosDeCobro } from './paquete.service.js';
import { obtenerResumenPropio } from './usuario.service.js';
import { domicilioDePersona } from './domicilio.service.js';

export const SCOPE_ENLACE = 'enlace';
export const VIGENCIA_SESION_ENLACE = '2h';
// Con PIN visible: el residente ya puede recoger. PREALERTADO aún no llegó.
const ESTADOS_CON_PIN = [ESTADOS.EN_RECEPCION, ESTADOS.PROGRAMADO];
const ESTADOS_ACTIVOS = [ESTADOS.PREALERTADO, ...ESTADOS_CON_PIN];

/** Token firmado (vence en 7 días, D1) para el residente. */
export function tokenDeResidente({ residenteId, conjuntoId }, ahora = Date.now()) {
  return firmar({ residenteId, conjuntoId, exp: vencimientoPorDefecto(ahora) }, secretoEnlace());
}

/**
 * `${FRONTEND_URL}/p#<token>`; null si no hay FRONTEND_URL (se omite del texto).
 * El token va en el FRAGMENTO: el navegador no lo envía al servidor, así que no
 * queda en los registros de Vercel/Railway ni en el Referer. El frontend lo lee y
 * lo manda por POST /api/p/abrir.
 */
export function urlMisPaquetes({ residenteId, conjuntoId }) {
  const base = (process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '');
  if (!base) return null;
  return `${base}/p#${tokenDeResidente({ residenteId, conjuntoId })}`;
}

/** Vista "Mis paquetes". Debe correr DENTRO de un contexto de tenant. Sin email ni teléfono. */
export async function vistaMisPaquetes(residenteId) {
  const cuenta = await obtenerResumenPropio(residenteId);
  // La persona "existe" en este conjunto solo si tiene un Domicilio aquí (aislado por tenant).
  const domicilio = cuenta ? await domicilioDePersona(residenteId) : null;
  const residente = cuenta && domicilio
    ? { nombre: domicilio.nombreRecibe || cuenta.nombre, torre: domicilio.torre, apto: domicilio.apto }
    : null;
  if (!residente) {
    throw new AppError(CODIGOS.NO_ENCONTRADO, 'No encontramos tu cuenta. Pide a la portería que te reenvíe el aviso.', 404);
  }
  const conjunto = await conjuntoDelContexto();
  const paquetes = await prisma.package.findMany({
    where: { residenteId, estado: { in: ESTADOS_ACTIVOS } },
    select: {
      id: true, estado: true, pin: true, costoServicio: true, categoriaPeso: true, proveedor: true,
      transportadora: true, guia: true, recibidoEn: true, franjaHoraria: true, metodoPagoServicio: true, modalidadEntrega: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  const motivoPor = await motivosDeCobro(paquetes.map((p) => p.id));

  return {
    residente: { nombre: residente.nombre, etiquetaApto: etiquetaApartamento(residente.torre, residente.apto) },
    conjunto: { nombre: conjunto.nombre },
    paquetes: paquetes.map((p) => ({
      id: p.id,
      estado: p.estado,
      pin: ESTADOS_CON_PIN.includes(p.estado) ? p.pin : null,
      costo: p.costoServicio,
      motivoCobro: motivoPor.get(p.id) ?? null,
      categoriaPeso: p.categoriaPeso,
      proveedor: p.proveedor,
      transportadora: p.transportadora,
      guia: p.guia,
      recibidoEn: p.recibidoEn,
      franjaHoraria: p.franjaHoraria,
      metodoPagoServicio: p.metodoPagoServicio,
      modalidadEntrega: p.modalidadEntrega,
    })),
    franjasEntrega: franjasDe(conjunto),
    metodosPago: METODOS_PAGO,
  };
}

/** Abre un enlace: verifica, entra al tenant del token y devuelve la vista + sesión limitada. */
export async function abrirEnlace(token) {
  const { residenteId, conjuntoId } = verificar(token, secretoEnlace());
  const vista = await runWithTenant({ conjuntoId, role: 'RESIDENT' }, () => vistaMisPaquetes(residenteId));
  const sesion = jwt.sign(
    { sub: residenteId, role: 'RESIDENT', conjuntoId, scope: SCOPE_ENLACE },
    process.env.JWT_SECRET,
    { expiresIn: VIGENCIA_SESION_ENLACE },
  );
  return { ...vista, sesion };
}
