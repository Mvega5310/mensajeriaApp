import { Router } from 'express';
import { AppError, CODIGOS, asyncHandler } from '../domain/errores.js';
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
router.get('/paquetes', requireAuth, requireTenant, requireRole('RESIDENT'),
  asyncHandler(async (req, res) => res.json(await vistaMisPaquetes(req.user.sub))));

// PÚBLICA (sin sesión): el token firmado es la credencial. Va en el CUERPO (el
// frontend lo lee del fragmento `/p#<token>`), nunca en la URL: así no queda en
// los registros de Railway/Vercel. Ya NO existe GET /api/p/:token: se eliminó (en
// vez de dejarlo en 410) para no mantener una ruta pública más y porque un enlace
// viejo `/p/<token>` ya no llega a esta API (lo atiende el frontend).
router.post('/abrir', asyncHandler(async (req, res) => {
  const { token } = req.body ?? {};
  if (typeof token !== 'string' || !token) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, 'Falta el enlace. Abre el enlace que te enviaron.', 400, { campo: 'token' });
  }
  res.json(await abrirEnlace(token));
}));

export default router;
