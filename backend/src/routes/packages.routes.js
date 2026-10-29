import express, { Router } from 'express';
import { LIMITE_JSON_FOTOS_BYTES } from '../domain/recepcion.js';
import { asyncHandler } from '../domain/errores.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { requireTenant, conjuntoDelPaquete } from '../middleware/tenant.middleware.js';
import {
  createPrealert,
  listMine,
  listAll,
  schedule,
  checkin,
  recepcion,
  asignar,
  confirmDelivery,
  exportCsv,
  getFoto,
  resumen,
  getById,
} from '../controllers/packages.controller.js';

// Rutas que reciben fotos en base64 en el cuerpo JSON (recepción y checkin).
export function esRutaConFotos(req) {
  const ruta = (req.originalUrl || req.url || '').split('?')[0];
  return (req.method === 'POST' && /^\/api\/packages\/recepcion\/?$/.test(ruta))
    || (req.method === 'PATCH' && /^\/api\/packages\/[^/]+\/checkin\/?$/.test(ruta));
}
const jsonFotos = express.json({ limit: LIMITE_JSON_FOTOS_BYTES });

const router = Router();

router.use(requireAuth);
router.use(requireTenant);

router.post('/', requireRole('RESIDENT'), asyncHandler(createPrealert));
router.get('/mine', requireRole('RESIDENT'), asyncHandler(listMine));
// Rutas del residente sobre UN paquete: el contexto es el conjunto DEL paquete (S1.3).
router.patch('/:id/schedule', requireRole('RESIDENT'), conjuntoDelPaquete, asyncHandler(schedule));
// Ambos roles pueden pedirla; getFoto() valida por dentro que un
// residente solo vea la foto de su propio paquete.
router.get('/:id/foto', conjuntoDelPaquete, asyncHandler(getFoto));

router.get('/', requireRole('OPERATOR'), asyncHandler(listAll));
router.get('/export', requireRole('OPERATOR'), asyncHandler(exportCsv));
router.get('/resumen', requireRole('OPERATOR'), asyncHandler(resumen));
router.get('/:id', requireRole('OPERATOR'), asyncHandler(getById));
router.post('/recepcion', requireRole('OPERATOR'), jsonFotos, asyncHandler(recepcion));
router.patch('/:id/asignar', requireRole('OPERATOR'), asyncHandler(asignar));
router.patch('/:id/checkin', requireRole('OPERATOR'), jsonFotos, asyncHandler(checkin));
router.post('/:id/confirm-delivery', requireRole('OPERATOR'), asyncHandler(confirmDelivery));

export default router;
