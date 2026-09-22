import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { requireTenant } from '../middleware/tenant.middleware.js';
import { configPublica, config } from '../controllers/conjunto.controller.js';

// Router público: config presentacional por código de invitación (pre-sesión).
// Se monta en /api/conjuntos.
export const conjuntosPublicRouter = Router();
conjuntosPublicRouter.get('/config-publica', configPublica);

// Router autenticado: config del propio conjunto (con tarifas y flags).
// Se monta en /api/conjunto.
export const conjuntoAuthRouter = Router();
conjuntoAuthRouter.use(requireAuth);
conjuntoAuthRouter.use(requireTenant);
conjuntoAuthRouter.get('/config', config);
