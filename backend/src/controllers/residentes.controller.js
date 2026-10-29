import { AppError, CODIGOS } from '../domain/errores.js';
import { buscarResidentes } from '../services/residente.service.js';

const MAX_Q = 60;
const MAX_GUIA = 60;

// Operador: GET /residentes/buscar?q=[&guia=] — máximo 5 resultados, sin email ni teléfono
// completo (solo sus últimos 4 dígitos, para distinguir a dos personas con el mismo nombre).
export async function buscar(req, res) {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < 1) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, 'Escribe un apartamento o un nombre para buscar.', 400);
  }
  if (q.length > MAX_Q) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, 'La búsqueda es demasiado larga. Escribe menos texto.', 400);
  }
  // `guia` (opcional): la guía que el operador ya tiene (p. ej. la del paquete sin dueño que
  // asigna); un domicilio con una pre-alerta abierta de esa guía sale primero.
  const guia = typeof req.query.guia === 'string' ? req.query.guia.trim().slice(0, MAX_GUIA) : '';
  res.json(await buscarResidentes(q, { guia }));
}
