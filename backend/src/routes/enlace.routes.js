import { Router } from 'express';
import { asyncHandler } from '../domain/errores.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { requireTenant } from '../middleware/tenant.middleware.js';
import { abrirEnlace, vistaMisPaquetes } from '../services/enlace.service.js';

// Se monta en /api/p. Contiene PIN: nunca debe quedar en cachés ni en Referer.
const router = Router();
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});

// Refresco con la sesión limitada del enlace (o una sesión normal de residente).
// Se declara ANTES de /:token para que "paquetes" no se tome como token.
router.get('/paquetes', requireAuth, requireTenant, requireRole('RESIDENT'),
  asyncHandler(async (req, res) => res.json(await vistaMisPaquetes(req.user.sub))));

// PÚBLICA (sin sesión): el token firmado es la credencial.
router.get('/:token', asyncHandler(async (req, res) => res.json(await abrirEnlace(req.params.token))));

export default router;
