import { Router } from 'express';
import { asyncHandler } from '../domain/errores.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { requireTenant } from '../middleware/tenant.middleware.js';
import { buscar } from '../controllers/residentes.controller.js';

const router = Router();
router.use(requireAuth);
router.use(requireTenant);
router.get('/buscar', requireRole('OPERATOR'), asyncHandler(buscar));
export default router;
