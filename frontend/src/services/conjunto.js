import { api } from './api.js';

// Configuración del propio conjunto (con sesión). Fuente única de tarifas,
// bonosHabilitados, nombre del conjunto y (solo operador) codigoInvitacion.
// GET /api/conjunto/config  (requireAuth + requireTenant)
export function getConjuntoConfig() {
  return api('/conjunto/config');
}

// Configuración presentacional por código de invitación (sin sesión).
// GET /api/conjuntos/config-publica?c=<codigo>
// Sin código, el backend responde solo si existe UN ÚNICO conjunto (si hay
// varios, 400 INVITACION_INVALIDA y hay que pedir el código).
export function getConfigPublica(codigo) {
  return api(codigo ? `/conjuntos/config-publica?c=${encodeURIComponent(codigo)}` : '/conjuntos/config-publica');
}
