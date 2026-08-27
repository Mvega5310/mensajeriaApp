import crypto from 'node:crypto';

// Genera un PIN de 4 dígitos con un RNG criptográfico (no Math.random()).
export function generatePin() {
  const n = crypto.randomInt(0, 10000);
  return n.toString().padStart(4, '0');
}

// El PIN se guarda en texto plano a propósito: no es una contraseña, es un
// código de bajo valor para un traspaso físico puntual. Lo que lo protege
// no es el hash, sino el control de acceso del backend: solo el residente
// dueño del paquete puede leerlo (GET /packages/mine) y el operador nunca
// recibe el valor correcto — solo puede enviar un intento para compararlo.
export function verifyPin(intento, pinGuardado) {
  return intento === pinGuardado;
}
