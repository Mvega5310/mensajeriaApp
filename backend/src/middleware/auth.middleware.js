import jwt from 'jsonwebtoken';
import { AppError, CODIGOS } from '../domain/errores.js';

// Sesión limitada del enlace firmado (T3.1): un JWT con `scope: 'enlace'` solo
// sirve para ESTAS rutas (método + ruta completa). Es la única lista: agregar una
// ruta aquí es dar poder al enlace de WhatsApp, decidirlo con cuidado.
export const SCOPE_ENLACE = 'enlace';
export const RUTAS_PERMITIDAS_ENLACE = [
  { method: 'GET', patron: /^\/api\/p\/paquetes\/?$/ },
  { method: 'PATCH', patron: /^\/api\/packages\/[^/]+\/schedule\/?$/ },
  // Fotos del paquete propio (getFoto valida el dueño: ajeno = 404). T2.8.
  { method: 'GET', patron: /^\/api\/packages\/[^/]+\/foto\/?$/ },
];

function rutaPermitidaParaEnlace(req) {
  const ruta = (req.originalUrl || '').split('?')[0];
  return RUTAS_PERMITIDAS_ENLACE.some((r) => r.method === req.method && r.patron.test(ruta));
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new AppError(CODIGOS.NO_AUTENTICADO, 'Inicia sesión para continuar.', 401));

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return next(new AppError(CODIGOS.SESION_INVALIDA, 'Tu sesión venció. Inicia sesión de nuevo.', 401));
  }
  // Control central: un token de alcance limitado no sirve fuera de su lista.
  if (req.user.scope !== undefined && (req.user.scope !== SCOPE_ENLACE || !rutaPermitidaParaEnlace(req))) {
    return next(new AppError(CODIGOS.PROHIBIDO, 'Este acceso por enlace solo permite ver tus paquetes (con sus fotos) y pedir la entrega. Inicia sesión para hacer otras acciones.', 403));
  }
  next();
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
