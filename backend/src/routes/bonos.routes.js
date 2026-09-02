import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { create, listForResident, listMine } from '../controllers/bonos.controller.js';

const router = Router();

router.use(requireAuth);

router.post('/', requireRole('OPERATOR'), create);
router.get('/mine', requireRole('RESIDENT'), listMine);
router.get('/residente/:residenteId', requireRole('OPERATOR'), listForResident);

export default router;
