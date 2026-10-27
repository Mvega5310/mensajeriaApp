import { AppError, CODIGOS } from '../domain/errores.js';
import { buscarResidentes } from '../services/residente.service.js';

const MAX_Q = 60;

// Operador: GET /residentes/buscar?q= — máximo 5 resultados, sin email/teléfono.
export async function buscar(req, res) {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < 1) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, 'Escribe un apartamento o un nombre para buscar.', 400);
  }
  if (q.length > MAX_Q) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, 'La búsqueda es demasiado larga. Escribe menos texto.', 400);
  }
  res.json(await buscarResidentes(q));
}
