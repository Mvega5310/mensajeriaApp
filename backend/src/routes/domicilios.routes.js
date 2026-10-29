import { Router } from 'express';
import { asyncHandler } from '../domain/errores.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { requireTenant } from '../middleware/tenant.middleware.js';
import { listar, crear } from '../controllers/domicilios.controller.js';

// Direcciones de entrega de la persona en TODOS sus conjuntos (PLAN-conjunto S1.3).
// Se monta en /api/domicilios. Solo RESIDENT con sesión normal (la sesión de enlace no
// llega: no está en su lista de rutas permitidas).
const router = Router();
router.use(requireAuth);
router.use(requireTenant);

router.get('/', requireRole('RESIDENT'), asyncHandler(listar));
router.post('/', requireRole('RESIDENT'), asyncHandler(crear));

export default router;
