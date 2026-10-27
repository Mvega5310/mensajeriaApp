import crypto from 'node:crypto';
import { evaluarIntento } from '../domain/pin.js';

// Genera un PIN de 4 dígitos con un RNG criptográfico (no Math.random()).
export function generatePin() {
  const n = crypto.randomInt(0, 10000);
  return n.toString().padStart(4, '0');
}

// El PIN se guarda en texto plano a propósito: no es una contraseña, es un
// código de bajo valor para un traspaso físico puntual. Lo que lo protege es el
// control de acceso del backend: SOLO EL RESIDENTE lo ve (en el enlace de aviso
// /api/p, en GET /packages/mine y en el correo de llegada que se le envía). El
// operador nunca recibe el valor: no viaja en recepción, asignar, listados ni
// respuestas de entrega; solo teclea el intento que le dice el residente y el
// servidor compara. (El enlace del WhatsApp pasa por su teléfono, y quien lo abra
// ve el PIN: es el costo conocido de la decisión D1.)
export function verifyPin(intento, pinGuardado) {
  return intento === pinGuardado;
}

// Persistencia del límite de intentos (T1.4). Se llama FUERA de la transacción
// de entrega: un `throw PIN_INCORRECTO` revierte la transacción y se llevaría el
// contador. Escritura optimista con `updateMany` condicionado al contador leído
// (compare-and-set): dos fallos concurrentes no se pisan, el perdedor relee y
// reintenta, así que cada fallo cuenta. `evaluarIntento` decide; aquí solo se
// guarda. No usa aplicarEvento (no hay transición de estado) ni toca conjuntoId.
export async function registrarIntentoPin(db, paqueteId, correcto, ahora = new Date()) {
  for (let i = 0; i < 10; i++) {
    const pkg = await db.package.findUnique({
      where: { id: paqueteId },
      select: { intentosPin: true, pinBloqueadoHasta: true },
    });
    if (!pkg) return null;
    const r = evaluarIntento({ intentos: pkg.intentosPin, bloqueadoHasta: pkg.pinBloqueadoHasta, ahora, correcto });
    if (!r.permitido) return r;
    const { count } = await db.package.updateMany({
      where: { id: paqueteId, intentosPin: pkg.intentosPin, pinBloqueadoHasta: pkg.pinBloqueadoHasta },
      data: { intentosPin: r.nuevosIntentos, pinBloqueadoHasta: r.bloqueadoHasta },
    });
    if (count === 1) return r;
  }
  throw new Error('No se pudo registrar el intento de PIN (contención).');
}
