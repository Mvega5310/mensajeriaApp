import { Router } from 'express';
import { asyncHandler } from '../domain/errores.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { requireTenant, conjuntoDeSolicitud } from '../middleware/tenant.middleware.js';
import { listarPublicos, configPublica, config } from '../controllers/conjunto.controller.js';

// Router público: config presentacional por código de invitación (pre-sesión).
// Se monta en /api/conjuntos.
export const conjuntosPublicRouter = Router();
// Lista pública de conjuntos activos para el selector (S1.3): solo { slug, nombre }.
conjuntosPublicRouter.get('/', asyncHandler(listarPublicos));
conjuntosPublicRouter.get('/config-publica', asyncHandler(configPublica));

// Router autenticado: config del propio conjunto (con tarifas y flags).
// Se monta en /api/conjunto.
export const conjuntoAuthRouter = Router();
conjuntoAuthRouter.use(requireAuth);
conjuntoAuthRouter.use(requireTenant);
// `?conjunto=<slug>` (S1.3): la config del conjunto de la solicitud (tarifas, franjas...).
conjuntoAuthRouter.get('/config', conjuntoDeSolicitud, asyncHandler(config));
