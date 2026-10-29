import { Router } from 'express';
import { asyncHandler } from '../domain/errores.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { requireTenant, conjuntoDeSolicitud } from '../middleware/tenant.middleware.js';
import { create, listMine, listAll } from '../controllers/comments.controller.js';

const router = Router();

router.use(requireAuth);
router.use(requireTenant);
// `conjunto` (slug; query en GET, cuerpo en POST): comentarios dirigidos al operador de ESE conjunto.
router.use(conjuntoDeSolicitud);

router.post('/', requireRole('RESIDENT'), asyncHandler(create));
router.get('/mine', requireRole('RESIDENT'), asyncHandler(listMine));
router.get('/', requireRole('OPERATOR'), asyncHandler(listAll));

export default router;
