import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.routes.js';
import packagesRoutes from './routes/packages.routes.js';
import commentsRoutes from './routes/comments.routes.js';
import bonosRoutes from './routes/bonos.routes.js';
import { manejadorErrores } from './domain/errores.js';
import { crearLimitadorMemoria, LOGIN_MAX_FALLOS, LOGIN_VENTANA_MS } from './domain/limitador.js';
import { conjuntosPublicRouter, conjuntoAuthRouter } from './routes/conjunto.routes.js';

// Construye la app de Express SIN arrancar el servidor. index.js hace el
// listen en producción; las pruebas de integración HTTP hacen app.listen(0)
// contra un puerto efímero (ver __tests__/http.integration.test.js).
// `limitadorLogin` es inyectable (pruebas, o un limitador con Redis más adelante).
export function createApp({ limitadorLogin } = {}) {
  const app = express();

  // Detrás del proxy de Railway, `req.ip` sería la IP del proxy para todos y el
  // límite de login bloquearía a todo el mundo a la vez. `trust proxy = 1`
  // confía SOLO en el último salto (el proxy de Railway): Express toma la IP que
  // ese proxy añadió a X-Forwarded-For e ignora lo que el cliente haya puesto
  // antes, así que no se puede falsificar para evadir el límite. Sin proxy
  // (local) queda desactivado para que un X-Forwarded-For del cliente no valga.
  // Se puede forzar con TRUST_PROXY (número de saltos, o `false`).
  const tp = process.env.TRUST_PROXY;
  if (tp !== undefined && tp !== '') {
    app.set('trust proxy', /^\d+$/.test(tp) ? Number(tp) : tp === 'false' ? false : tp);
  } else if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }
  app.locals.limitadorLogin = limitadorLogin ?? crearLimitadorMemoria({ max: LOGIN_MAX_FALLOS, ventanaMs: LOGIN_VENTANA_MS });

  app.use(cors({ origin: process.env.CORS_ORIGIN }));
  // El límite ya no es la defensa principal contra fotos gigantes — el
  // frontend las comprime antes de enviarlas (ver utils/image.js). Esto es
  // solo un margen de seguridad para no devolver una página HTML genérica
  // si algo se cuela sin comprimir.
  app.use(express.json({ limit: '4mb' }));

  app.get('/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api/packages', packagesRoutes);
  app.use('/api/comments', commentsRoutes);
  app.use('/api/bonos', bonosRoutes);
  app.use('/api/conjuntos', conjuntosPublicRouter); // público (config-publica?c=)
  app.use('/api/conjunto', conjuntoAuthRouter); // auth+tenant (/config)

  // Manejador global: TODO error sale como { code, message, details? } (ver
  // domain/errores.js). Incluye body demasiado grande (413) y JSON inválido (400).
  app.use(manejadorErrores);

  return app;
}
