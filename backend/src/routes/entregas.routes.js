import { Router } from 'express';
import { AppError, CODIGOS, asyncHandler } from '../domain/errores.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { requireTenant } from '../middleware/tenant.middleware.js';
import { verificarPinLote, confirmarLote } from '../services/entrega.service.js';

const router = Router();

router.use(requireAuth);
router.use(requireTenant);

// POST /api/entregas/verificar-pin { pin, residenteId? | apto? }
router.post('/verificar-pin', requireRole('OPERATOR'), asyncHandler(async (req, res) => {
  const { pin, residenteId, apto } = req.body ?? {};
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, 'El PIN tiene 4 dígitos. Revísalo e inténtalo de nuevo.', 400, { campo: 'pin' });
  }
  if ((residenteId !== undefined && typeof residenteId !== 'string') || (apto !== undefined && typeof apto !== 'string')) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, 'El apartamento o el residente no son válidos.', 400);
  }
  try {
    const r = await verificarPinLote({
      operadorId: req.user.sub,
      conjuntoId: req.conjuntoId,
      pin,
      residenteId,
      apto,
      limitador: req.app.locals.limitadorPinEntrega,
    });
    res.json(r);
  } catch (err) {
    if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
    throw err;
  }
}));

// POST /api/entregas/confirmar { tokenEntrega, paqueteIds, metodoPago }
router.post('/confirmar', requireRole('OPERATOR'), asyncHandler(async (req, res) => {
  const { tokenEntrega, paqueteIds, metodoPago } = req.body ?? {};
  res.json(await confirmarLote({
    operadorId: req.user.sub, conjuntoId: req.conjuntoId, tokenEntrega, paqueteIds, metodoPago,
    notificador: req.app.locals.notificador,
  }));
}));

export default router;
