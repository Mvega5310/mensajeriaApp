// Pruebas de validarEntorno (T0.3). Puras: no requieren base de datos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validarEntorno, secretoEnlace } from '../env.js';

const SECRETO_LARGO = 'x'.repeat(32);
const BASE = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/puertaya',
  JWT_SECRET: SECRETO_LARGO,
  ENLACE_SECRET: 'e'.repeat(40),
  CORS_ORIGIN: 'https://app.example',
  FRONTEND_URL: 'https://app.example',
  RESEND_API_KEY: 're_realrealreal',
};

test('faltan obligatorias: el error nombra TODAS a la vez', () => {
  assert.throws(
    () => validarEntorno({}),
    (err) => {
      assert.match(err.message, /DATABASE_URL/);
      assert.match(err.message, /JWT_SECRET/);
      assert.equal(err.problemas.length, 2);
      return true;
    },
  );
});

test('vacías o solo espacios cuentan como faltantes', () => {
  assert.throws(
    () => validarEntorno({ DATABASE_URL: '   ', JWT_SECRET: '' }),
    (err) => /DATABASE_URL/.test(err.message) && /JWT_SECRET/.test(err.message),
  );
});

test('en producción, JWT corto falla y el mensaje dice el mínimo', () => {
  assert.throws(
    () => validarEntorno({ ...BASE, JWT_SECRET: 'corto', NODE_ENV: 'production' }),
    (err) => /al menos 32 caracteres/.test(err.message) && /tiene 5/.test(err.message),
  );
});

test('en producción, el valor de ejemplo de .env.example falla', () => {
  assert.throws(
    () => validarEntorno({ ...BASE, JWT_SECRET: 'replace-with-a-long-random-value', NODE_ENV: 'production' }),
    (err) => /valor de ejemplo/.test(err.message),
  );
});

test('en desarrollo, cualquier JWT_SECRET no vacío basta', () => {
  const config = validarEntorno({ DATABASE_URL: BASE.DATABASE_URL, JWT_SECRET: 'corto' });
  assert.equal(config.jwtSecret, 'corto');
  assert.equal(config.esProduccion, false);
});

// T5.1: en producción sin FOTOS_S3_* se sigue en modo legado, con aviso fuerte.
const AVISO_FOTOS_PROD = validarEntorno({ ...BASE, NODE_ENV: 'production' }).avisos.find((a) => a.includes('FOTOS_S3_'));

test('configuración válida devuelve el objeto normalizado (solo el aviso de fotos legado)', () => {
  const config = validarEntorno({ ...BASE, NODE_ENV: 'production', PORT: '8080', JWT_EXPIRES_IN: '2h' });
  assert.deepEqual(config, {
    nodeEnv: 'production',
    esProduccion: true,
    puerto: 8080,
    databaseUrl: BASE.DATABASE_URL,
    jwtSecret: SECRETO_LARGO,
    jwtExpiresIn: '2h',
    enlaceSecret: BASE.ENLACE_SECRET,
    corsOrigin: BASE.CORS_ORIGIN,
    frontendUrl: BASE.FRONTEND_URL,
    resendApiKey: 're_realrealreal',
    emailFrom: undefined,
    fotos: { modo: 'legado' },
    avisos: [AVISO_FOTOS_PROD],
  });
});

test('valores por defecto: puerto 4000 y JWT_EXPIRES_IN 8h', () => {
  const config = validarEntorno({ DATABASE_URL: BASE.DATABASE_URL, JWT_SECRET: 'x' });
  assert.equal(config.puerto, 4000);
  assert.equal(config.jwtExpiresIn, '8h');
});

test('opcional faltante: no lanza y deja aviso en el log', () => {
  const config = validarEntorno({ DATABASE_URL: BASE.DATABASE_URL, JWT_SECRET: SECRETO_LARGO });
  assert.equal(config.resendApiKey, undefined);
  assert.ok(config.avisos.some((a) => /RESEND_API_KEY/.test(a)));
  assert.ok(config.avisos.some((a) => /CORS_ORIGIN/.test(a)));
  assert.ok(config.avisos.some((a) => /FRONTEND_URL/.test(a)));
});

test('RESEND_API_KEY de ejemplo (re_xxx...) cuenta como ausente', () => {
  const config = validarEntorno({ ...BASE, RESEND_API_KEY: 're_xxxxxxxxxxxx' });
  assert.equal(config.resendApiKey, undefined);
  assert.ok(config.avisos.some((a) => /RESEND_API_KEY/.test(a)));
});

test('PORT inválido se reporta junto con los demás problemas', () => {
  assert.throws(
    () => validarEntorno({ PORT: 'abc' }),
    (err) => /PORT debe ser/.test(err.message)
      && /DATABASE_URL/.test(err.message)
      && /JWT_SECRET/.test(err.message),
  );
});

test('sin NODE_ENV avisa que el proxy no será de confianza (límite de login por IP)', () => {
  const sin = validarEntorno({ ...BASE });
  assert.ok(sin.avisos.some((a) => /NODE_ENV=production/.test(a) && /proxy/.test(a) && /IP/.test(a)));
  const con = validarEntorno({ ...BASE, NODE_ENV: 'production' });
  assert.ok(!con.avisos.some((a) => /NODE_ENV/.test(a)));
});

test('DATABASE_URL que no es Postgres falla', () => {
  assert.throws(
    () => validarEntorno({ ...BASE, DATABASE_URL: 'file:./dev.db' }),
    (err) => /postgresql:\/\//.test(err.message),
  );
});

test('T3.1: en producción ENLACE_SECRET es obligatoria, larga y distinta de JWT_SECRET', () => {
  const { ENLACE_SECRET, ...sinSecreto } = BASE;
  assert.throws(() => validarEntorno({ ...sinSecreto, NODE_ENV: 'production' }), /Falta ENLACE_SECRET/);
  assert.throws(() => validarEntorno({ ...BASE, ENLACE_SECRET: 'corta', NODE_ENV: 'production' }), /ENLACE_SECRET debe tener al menos 32/);
  assert.throws(() => validarEntorno({ ...BASE, ENLACE_SECRET: SECRETO_LARGO, NODE_ENV: 'production' }), /distinta de JWT_SECRET/);
});

test('T3.1: fuera de producción ENLACE_SECRET falta con aviso y se deriva de JWT_SECRET', () => {
  const { ENLACE_SECRET, ...sinSecreto } = BASE;
  const c = validarEntorno({ ...sinSecreto });
  assert.ok(c.avisos.some((a) => /ENLACE_SECRET/.test(a)));
  const derivado = secretoEnlace({ ...sinSecreto });
  assert.notEqual(derivado, SECRETO_LARGO);
  assert.equal(derivado, secretoEnlace({ ...sinSecreto }));
  assert.equal(secretoEnlace(BASE), BASE.ENLACE_SECRET);
  assert.throws(() => secretoEnlace({ ...sinSecreto, NODE_ENV: 'production' }), /ENLACE_SECRET/);
});
