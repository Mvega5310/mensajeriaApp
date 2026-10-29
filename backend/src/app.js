import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.routes.js';
import packagesRoutes from './routes/packages.routes.js';
import commentsRoutes from './routes/comments.routes.js';
import bonosRoutes from './routes/bonos.routes.js';
import residentesRoutes from './routes/residentes.routes.js';
import entregasRoutes from './routes/entregas.routes.js';
import enlaceRoutes from './routes/enlace.routes.js';
import domiciliosRoutes from './routes/domicilios.routes.js';
import { esRutaConFotos } from './routes/packages.routes.js';
import { manejadorErrores } from './domain/errores.js';
import { crearLimitadorMemoria, LOGIN_MAX_FALLOS, LOGIN_VENTANA_MS, ENLACE_MAX_SOLICITUDES, ENLACE_VENTANA_MS, CONJUNTOS_MAX_CONSULTAS, CONJUNTOS_VENTANA_MS, DIRECCIONES_MAX_ALTAS, DIRECCIONES_VENTANA_MS, PIN_ENTREGA_MAX_FALLOS, PIN_ENTREGA_VENTANA_MS } from './domain/limitador.js';
import { crearNotificadorDesdeEntorno } from './services/notificador/index.js';
import { crearAlmacenDesdeEntorno } from './services/almacen/index.js';
import { conjuntosPublicRouter, conjuntoAuthRouter } from './routes/conjunto.routes.js';

// Construye la app de Express SIN arrancar el servidor. index.js hace el
// listen en producción; las pruebas de integración HTTP hacen app.listen(0)
// contra un puerto efímero (ver __tests__/http.integration.test.js).
// `limitadorLogin` es inyectable (pruebas, o un limitador con Redis más adelante).
export function createApp({ limitadorLogin, limitadorPinEntrega, limitadorEnlace, limitadorConjuntos, limitadorDirecciones, notificador, almacenFotos } = {}) {
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
  // Fallos de PIN en entrega por lote (T2.5): por operador, 20 / 10 min (ver limitador.js).
  app.locals.limitadorPinEntrega = limitadorPinEntrega ?? crearLimitadorMemoria({ max: PIN_ENTREGA_MAX_FALLOS, ventanaMs: PIN_ENTREGA_VENTANA_MS });

  // Solicitudes de enlace de acceso (T3.2): por correo+IP, 5 / 15 min.
  app.locals.limitadorEnlace = limitadorEnlace ?? crearLimitadorMemoria({ max: ENLACE_MAX_SOLICITUDES, ventanaMs: ENLACE_VENTANA_MS });

  // Lista pública de conjuntos (S1.3): por IP, 60 / min.
  app.locals.limitadorConjuntos = limitadorConjuntos ?? crearLimitadorMemoria({ max: CONJUNTOS_MAX_CONSULTAS, ventanaMs: CONJUNTOS_VENTANA_MS });

  // Altas de direcciones por cuenta (revisión S3.2): 20 / hora.
  app.locals.limitadorDirecciones = limitadorDirecciones ?? crearLimitadorMemoria({ max: DIRECCIONES_MAX_ALTAS, ventanaMs: DIRECCIONES_VENTANA_MS });

  // Inyectable (pruebas: fake). Sin clave de Resend => fake en memoria + aviso en el log.
  app.locals.notificador = notificador ?? crearNotificadorDesdeEntorno();

  // Almacén de fotos (T5.1): inyectable; por defecto sale de FOTOS_S3_* (sin ellas: fake/legado).
  app.locals.almacenFotos = almacenFotos ?? crearAlmacenDesdeEntorno(process.env);

  app.use(cors({ origin: process.env.CORS_ORIGIN }));
  // JSON: 1 MB para toda la API. Las DOS rutas con fotos en base64 (recepción y
  // checkin) tienen su propio parser, más grande, montado en packages.routes.js
  // DESPUÉS de requireAuth/requireTenant/requireRole: un anónimo no puede obligar al
  // servidor a leer un cuerpo de ~9 MB. Aquí se omiten para no rechazarlas antes.
  // (El frontend comprime las fotos; esto es margen de seguridad.)
  const jsonGeneral = express.json({ limit: '1mb' });
  app.use((req, res, next) => (esRutaConFotos(req) ? next() : jsonGeneral(req, res, next)));

  app.get('/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api/packages', packagesRoutes);
  app.use('/api/comments', commentsRoutes);
  app.use('/api/bonos', bonosRoutes);
  app.use('/api/residentes', residentesRoutes);
  app.use('/api/domicilios', domiciliosRoutes); // direcciones de la persona (S1.3)
  app.use('/api/entregas', entregasRoutes);
  app.use('/api/p', enlaceRoutes); // enlace firmado del residente (T3.1)
  app.use('/api/conjuntos', conjuntosPublicRouter); // público (lista de conjuntos, config-publica)
  app.use('/api/conjunto', conjuntoAuthRouter); // auth+tenant (/config)

  // Manejador global: TODO error sale como { code, message, details? } (ver
  // domain/errores.js). Incluye body demasiado grande (413) y JSON inválido (400).
  app.use(manejadorErrores);

  return app;
}
