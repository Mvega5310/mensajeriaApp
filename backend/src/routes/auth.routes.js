import { Router } from 'express';
import { register, login, me, forgotPassword, resetPassword } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { requireTenant } from '../middleware/tenant.middleware.js';

const router = Router();

router.post('/register', register);
router.post('/login', login);
// /me lee datos del propio usuario dentro de su conjunto: requireTenant va
// justo después de requireAuth (register/login/forgot/reset son pre-tenant y
// NO lo llevan).
router.get('/me', requireAuth, requireTenant, me);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

export default router;
