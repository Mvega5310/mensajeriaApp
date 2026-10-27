// Validación de variables de entorno al arrancar (T0.3).
//
// `validarEntorno(env)` es pura: no lee process.env por su cuenta, no toca
// archivos ni la red. index.js la llama antes de cargar la app y de escuchar.
// Si hay problemas, lanza UN solo Error que los lista todos a la vez, para que
// quien despliega arregle todo de una vez y no vaya corrigiendo de a uno.
//
// Devuelve la configuración normalizada más `avisos`: opcionales ausentes que
// la app tolera (correo simulado, CORS abierto, etc.). index.js los escribe en
// el log como advertencia; no detienen el arranque.

const JWT_MIN_PRODUCCION = 32;
// Valor de ejemplo de backend/.env.example: no sirve como secreto real.
const JWT_PLACEHOLDERS = ['replace-with-a-long-random-value'];

function leer(env, nombre) {
  const valor = env[nombre];
  if (typeof valor !== 'string') return undefined;
  const limpio = valor.trim();
  return limpio === '' ? undefined : limpio;
}

/** Clave de Resend utilizable, o undefined. El valor de ejemplo "re_xxx..." cuenta como ausente. */
export function claveResendValida(env = process.env) {
  const clave = leer(env, 'RESEND_API_KEY');
  return clave && !clave.startsWith('re_xxx') ? clave : undefined;
}

export function validarEntorno(env = process.env) {
  const problemas = [];
  const avisos = [];

  const nodeEnvCrudo = leer(env, 'NODE_ENV');
  const nodeEnv = nodeEnvCrudo || 'development';
  const esProduccion = nodeEnv === 'production';

  // Obligatorias.
  const databaseUrl = leer(env, 'DATABASE_URL');
  if (!databaseUrl) {
    problemas.push('Falta DATABASE_URL: la dirección de la base Postgres (postgresql://usuario:clave@host:puerto/base).');
  } else if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    problemas.push('DATABASE_URL debe empezar por postgresql:// (la app funciona solo con Postgres).');
  }

  const jwtSecret = leer(env, 'JWT_SECRET');
  if (!jwtSecret) {
    problemas.push('Falta JWT_SECRET: la clave con la que se firman las sesiones.');
  } else if (esProduccion && JWT_PLACEHOLDERS.includes(jwtSecret)) {
    problemas.push('JWT_SECRET tiene el valor de ejemplo: en producción usa una clave aleatoria propia.');
  } else if (esProduccion && jwtSecret.length < JWT_MIN_PRODUCCION) {
    problemas.push(`JWT_SECRET debe tener al menos ${JWT_MIN_PRODUCCION} caracteres en producción (tiene ${jwtSecret.length}).`);
  }

  // Con valor por defecto en el código.
  const puertoCrudo = leer(env, 'PORT');
  let puerto = 4000;
  if (puertoCrudo !== undefined) {
    const numero = Number(puertoCrudo);
    if (Number.isInteger(numero) && numero >= 1 && numero <= 65535) {
      puerto = numero;
    } else {
      problemas.push(`PORT debe ser un número entre 1 y 65535 (recibido: "${puertoCrudo}").`);
    }
  }
  const jwtExpiresIn = leer(env, 'JWT_EXPIRES_IN') || '8h';

  // Opcionales: si faltan, la app sigue, pero se avisa en el log.
  if (!nodeEnvCrudo) {
    avisos.push('NODE_ENV no está definida: define NODE_ENV=production en Railway; sin él no se confía en el proxy y todos los usuarios comparten IP para el límite de login.');
  }
  const corsOrigin = leer(env, 'CORS_ORIGIN');
  if (!corsOrigin) {
    avisos.push('CORS_ORIGIN no está definida: la API acepta peticiones desde cualquier origen. Ponla con la URL del frontend.');
  }

  const frontendUrl = leer(env, 'FRONTEND_URL');
  if (!frontendUrl) {
    avisos.push('FRONTEND_URL no está definida: los enlaces de los correos (registro, restablecer contraseña) quedarán rotos.');
  }

  // Misma regla que services/notificador: el valor de ejemplo "re_xxx..." cuenta como ausente.
  const resendApiKey = claveResendValida(env);
  if (!resendApiKey) {
    avisos.push('RESEND_API_KEY no está definida: el correo se simula y no se envía nada.');
  }

  if (problemas.length > 0) {
    const error = new Error(
      'Configuración del servidor inválida. Revisa las variables de entorno '
      + '(backend/.env en local, pestaña Variables en Railway):\n'
      + problemas.map((p) => `  - ${p}`).join('\n'),
    );
    error.problemas = problemas;
    throw error;
  }

  return {
    nodeEnv,
    esProduccion,
    puerto,
    databaseUrl,
    jwtSecret,
    jwtExpiresIn,
    corsOrigin,
    frontendUrl,
    resendApiKey,
    emailFrom: leer(env, 'EMAIL_FROM'),
    avisos,
  };
}
