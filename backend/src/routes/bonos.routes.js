import { Router } from 'express';
import { asyncHandler } from '../domain/errores.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { requireTenant, conjuntoDeSolicitud } from '../middleware/tenant.middleware.js';
import { create, listForResident, listMine } from '../controllers/bonos.controller.js';

const router = Router();

router.use(requireAuth);
router.use(requireTenant);

router.post('/', requireRole('OPERATOR'), asyncHandler(create));
// `?conjunto=<slug>` (opcional): solo los bonos de ese conjunto; sin él, los de todos (S3.2).
router.get('/mine', requireRole('RESIDENT'), conjuntoDeSolicitud, asyncHandler(listMine));
router.get('/residente/:residenteId', requireRole('OPERATOR'), asyncHandler(listForResident));

export default router;
