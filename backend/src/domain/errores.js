// Formato único de error de la API (T0.2).
//
// Toda respuesta de error es `{ code, message, details? }`:
//  - `code`: constante estable en MAYÚSCULAS; el cliente decide por ella, nunca
//    por el texto.
//  - `message`: español listo para mostrar al usuario (qué pasó + qué hacer,
//    sin culpar y sin exclamaciones).
//  - `details`: opcional, datos de apoyo (p. ej. campos inválidos).
//
// Los handlers lanzan `AppError`; el manejador global de app.js lo traduce a
// JSON. Rutas async: envolver SIEMPRE con `asyncHandler` (Express 4 no envía
// los rechazos de promesas a `next`).

export const CODIGOS = Object.freeze({
  NO_AUTENTICADO: 'NO_AUTENTICADO',
  SESION_INVALIDA: 'SESION_INVALIDA',
  CREDENCIALES_INVALIDAS: 'CREDENCIALES_INVALIDAS',
  PROHIBIDO: 'PROHIBIDO',
  NO_ENCONTRADO: 'NO_ENCONTRADO',
  DATOS_INVALIDOS: 'DATOS_INVALIDOS',
  CONFLICTO: 'CONFLICTO',
  INVITACION_INVALIDA: 'INVITACION_INVALIDA',
  ENLACE_INVALIDO: 'ENLACE_INVALIDO',
  PIN_INCORRECTO: 'PIN_INCORRECTO',
  PIN_BLOQUEADO: 'PIN_BLOQUEADO',
  DEMASIADOS_INTENTOS: 'DEMASIADOS_INTENTOS',
  FUNCION_DESHABILITADA: 'FUNCION_DESHABILITADA',
  CARGA_DEMASIADO_GRANDE: 'CARGA_DEMASIADO_GRANDE',
  TRANSICION_INVALIDA: 'TRANSICION_INVALIDA',
  ERROR_INTERNO: 'ERROR_INTERNO',
});

export class AppError extends Error {
  /**
   * @param {string} code    Uno de CODIGOS.
   * @param {string} message Texto en español para el usuario.
   * @param {number} status  Código HTTP.
   * @param {object} [details] Datos de apoyo opcionales.
   */
  constructor(code, message, status = 400, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

// Envuelve un handler (async o no) y manda cualquier rechazo/excepción a next().
export function asyncHandler(fn) {
  return function handlerEnvuelto(req, res, next) {
    return Promise.resolve()
      .then(() => fn(req, res, next))
      .catch(next);
  };
}

// Manejador global de errores (se monta al final de app.js).
// eslint-disable-next-line no-unused-vars
export function manejadorErrores(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof AppError) {
    const body = { code: err.code, message: err.message };
    if (err.details !== undefined) body.details = err.details;
    return res.status(err.status).json(body);
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      code: CODIGOS.CARGA_DEMASIADO_GRANDE,
      message: 'El archivo o la foto es demasiado pesado. Prueba con uno más liviano.',
    });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({
      code: CODIGOS.DATOS_INVALIDOS,
      message: 'No pudimos leer los datos enviados. Revisa el formulario e intenta de nuevo.',
    });
  }

  // Errores 4xx de middlewares (body-parser: charset no soportado, 415, etc.):
  // traen su propio status; se devuelve ese, nunca un 500.
  const st = err?.status ?? err?.statusCode;
  if (Number.isInteger(st) && st >= 400 && st < 500) {
    return res.status(st).json({
      code: CODIGOS.DATOS_INVALIDOS,
      message: 'No pudimos leer los datos enviados. Revisa el formulario e intenta de nuevo.',
    });
  }

  // Cualquier otro error: se registra y se responde genérico, sin stack ni
  // detalles internos. No se vuelca el objeto completo: los errores de Prisma
  // traen `meta`/parámetros que pueden contener datos personales.
  console.error('Error no controlado:', {
    name: err?.name, message: err?.message, code: err?.code, stack: err?.stack,
  });
  return res.status(500).json({
    code: CODIGOS.ERROR_INTERNO,
    message: 'Algo salió mal de nuestro lado. Intenta de nuevo en unos minutos.',
  });
}
