import { api } from './api.js';

// Configuración del propio conjunto (con sesión). Fuente única de tarifas,
// bonosHabilitados, nombre del conjunto y (solo operador) codigoInvitacion.
// GET /api/conjunto/config  (requireAuth + requireTenant)
export function getConjuntoConfig() {
  return api('/conjunto/config');
}

// Configuración presentacional por código de invitación (sin sesión).
// GET /api/conjuntos/config-publica?c=<codigo>
export function getConfigPublica(codigo) {
  return api(`/conjuntos/config-publica?c=${encodeURIComponent(codigo)}`);
}
