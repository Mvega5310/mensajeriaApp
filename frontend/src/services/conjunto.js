import { api } from './api.js';

// Configuración del propio conjunto (con sesión). Fuente única de tarifas,
// bonosHabilitados, nombre del conjunto y (solo operador) codigoInvitacion.
// GET /api/conjunto/config  (requireAuth + requireTenant)
export function getConjuntoConfig() {
  return api('/conjunto/config');
}

// Configuración presentacional por código de invitación (sin sesión).
// GET /api/conjuntos/config-publica?c=<codigo>
// También acepta `?conjunto=<slug>`. Sin ninguno responde solo si hay UN ÚNICO conjunto activo
// (con varios, 400 CONJUNTO_REQUERIDO).
export function getConfigPublica(codigo, slug) {
  const q = [];
  if (codigo) q.push(`c=${encodeURIComponent(codigo)}`);
  if (slug) q.push(`conjunto=${encodeURIComponent(slug)}`);
  return api(`/conjuntos/config-publica${q.length ? `?${q.join('&')}` : ''}`);
}

// Conjuntos activos para el selector (sin sesión): [{ slug, nombre }] por nombre.
export function getConjuntos() {
  return api('/conjuntos');
}

// Direcciones guardadas de la persona en todos sus conjuntos (con sesión normal):
// [{ id, conjunto:{slug,nombre}, torre, apto, etiqueta, nombreRecibe, telefono, ultimoUsoEn }].
export function getDomicilios() {
  return api('/domicilios');
}
