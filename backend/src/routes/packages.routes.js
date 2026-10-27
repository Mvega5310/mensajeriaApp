import express, { Router } from 'express';
import { LIMITE_JSON_FOTOS_BYTES } from '../domain/recepcion.js';
import { asyncHandler } from '../domain/errores.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { requireTenant } from '../middleware/tenant.middleware.js';
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
router.patch('/:id/schedule', requireRole('RESIDENT'), asyncHandler(schedule));
// Ambos roles pueden pedirla; getFoto() valida por dentro que un
// residente solo vea la foto de su propio paquete.
router.get('/:id/foto', asyncHandler(getFoto));

router.get('/', requireRole('OPERATOR'), asyncHandler(listAll));
router.get('/export', requireRole('OPERATOR'), asyncHandler(exportCsv));
router.post('/recepcion', requireRole('OPERATOR'), jsonFotos, asyncHandler(recepcion));
router.patch('/:id/asignar', requireRole('OPERATOR'), asyncHandler(asignar));
router.patch('/:id/checkin', requireRole('OPERATOR'), jsonFotos, asyncHandler(checkin));
router.post('/:id/confirm-delivery', requireRole('OPERATOR'), asyncHandler(confirmDelivery));

export default router;
