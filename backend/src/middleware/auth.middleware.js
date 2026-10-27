import jwt from 'jsonwebtoken';
import { AppError, CODIGOS } from '../domain/errores.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new AppError(CODIGOS.NO_AUTENTICADO, 'Inicia sesión para continuar.', 401));

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    next(new AppError(CODIGOS.SESION_INVALIDA, 'Tu sesión venció. Inicia sesión de nuevo.', 401));
  }
}

// El rol se decide aquí, en el servidor, a partir del token firmado —
// nunca a partir de un valor que envíe el cliente.
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError(CODIGOS.PROHIBIDO, 'Tu cuenta no tiene permiso para esta acción.', 403));
    }
    next();
  };
}
