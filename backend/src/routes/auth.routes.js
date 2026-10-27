import { Router } from 'express';
import { asyncHandler } from '../domain/errores.js';
import { register, login, me, forgotPassword, resetPassword } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { requireTenant } from '../middleware/tenant.middleware.js';

const router = Router();

router.post('/register', asyncHandler(register));
router.post('/login', asyncHandler(login));
// /me lee datos del propio usuario dentro de su conjunto: requireTenant va
// justo después de requireAuth (register/login/forgot/reset son pre-tenant y
// NO lo llevan).
router.get('/me', requireAuth, requireTenant, asyncHandler(me));
router.post('/forgot-password', asyncHandler(forgotPassword));
router.post('/reset-password', asyncHandler(resetPassword));

export default router;
