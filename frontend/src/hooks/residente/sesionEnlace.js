// Sesión limitada (2 h) que entrega POST /p/abrir. Las respuestas que autoriza contienen
// PINes: vive solo en memoria y en sessionStorage (nunca localStorage) y jamás se mezcla
// con el token de login. Cada acceso a sessionStorage va en try/catch.
const CLAVE = 'puertaya.sesionEnlace';
let enMemoria = null;
let primeraVista = null; // respuesta de /p/abrir, para pintar sin otra llamada

export function guardarSesionEnlace(sesion, vista) {
  enMemoria = sesion;
  primeraVista = vista ?? null;
  try { sessionStorage.setItem(CLAVE, sesion); } catch { /* sin almacenamiento: queda en memoria */ }
}

export function leerSesionEnlace() {
  if (enMemoria) return enMemoria;
  try { enMemoria = sessionStorage.getItem(CLAVE); } catch { /* ignorar */ }
  return enMemoria;
}

export function tomarPrimeraVista() {
  const v = primeraVista;
  primeraVista = null;
  return v;
}

export function limpiarSesionEnlace() {
  enMemoria = null;
  primeraVista = null;
  try { sessionStorage.removeItem(CLAVE); } catch { /* ignorar */ }
}

/** Cabeceras para api(): con login normal no hace falta nada; con enlace, la sesión limitada. */
export function cabecerasDeSesion(modo) {
  if (modo !== 'enlace') return undefined;
  const s = leerSesionEnlace();
  return s ? { Authorization: `Bearer ${s}` } : undefined;
}

/** 'normal' (login o enlace de acceso) | 'enlace' (solo el enlace de WhatsApp) | null. */
export function modoDeSesion() {
  let normal = false;
  try { normal = !!localStorage.getItem('token'); } catch { /* ignorar */ }
  if (normal) return 'normal';
  return leerSesionEnlace() ? 'enlace' : null;
}
