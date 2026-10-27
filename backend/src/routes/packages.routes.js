import { Router } from 'express';
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
router.post('/recepcion', requireRole('OPERATOR'), asyncHandler(recepcion));
router.patch('/:id/asignar', requireRole('OPERATOR'), asyncHandler(asignar));
router.patch('/:id/checkin', requireRole('OPERATOR'), asyncHandler(checkin));
router.post('/:id/confirm-delivery', requireRole('OPERATOR'), asyncHandler(confirmDelivery));

export default router;
