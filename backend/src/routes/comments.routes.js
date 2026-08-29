import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { create, listMine, listAll } from '../controllers/comments.controller.js';

const router = Router();

router.use(requireAuth);

router.post('/', requireRole('RESIDENT'), create);
router.get('/mine', requireRole('RESIDENT'), listMine);
router.get('/', requireRole('OPERATOR'), listAll);

export default router;
