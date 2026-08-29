import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import {
  createPrealert,
  listMine,
  listAll,
  schedule,
  checkin,
  confirmDelivery,
  exportCsv,
} from '../controllers/packages.controller.js';

const router = Router();

router.use(requireAuth);

router.post('/', requireRole('RESIDENT'), createPrealert);
router.get('/mine', requireRole('RESIDENT'), listMine);
router.patch('/:id/schedule', requireRole('RESIDENT'), schedule);

router.get('/', requireRole('OPERATOR'), listAll);
router.get('/export', requireRole('OPERATOR'), exportCsv);
router.patch('/:id/checkin', requireRole('OPERATOR'), checkin);
router.post('/:id/confirm-delivery', requireRole('OPERATOR'), confirmDelivery);

export default router;
