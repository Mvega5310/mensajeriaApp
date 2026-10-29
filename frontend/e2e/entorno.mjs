// Orquestador del entorno E2E (T6.1).
//
// Se usa de dos formas:
//   - como globalSetup/globalTeardown de Playwright (export default = setup, devuelve el teardown);
//   - desde otros scripts (a11y.run.mjs): `const entorno = await levantarEntorno(); ... await entorno.detener()`.
//
// MODO LOCAL (por defecto): crea una base Postgres desechable con el rol `puertaya_test`
// (igual que backend/scripts/test-db.sh), aplica `prisma migrate deploy`, corre `npm run seed`
// con datos de prueba, arranca el backend (NODE_ENV=development, correo y fotos `fake`) y
// `vite` en puertos libres, y al terminar mata ambos procesos por PID y borra la base.
//
// MODO REMOTO: si existen E2E_BASE_URL y E2E_API_URL NO se levanta nada; las pruebas corren
// contra esas URLs (p. ej. el despliegue de Railway). Credenciales: E2E_OPERADOR_EMAIL,
// E2E_OPERADOR_PASSWORD y E2E_CODIGO_INVITACION. Los escenarios que necesitan leer correos o
// tocar la base (enlace mágico, PIN ambiguo) se omiten con su razón.
//
// El resultado se publica en process.env.E2E_ENTORNO (JSON) para que lo lean los workers.

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(AQUI, '..');
const BACKEND = path.resolve(FRONTEND, '../backend');

const DB_ROL = 'puertaya_test';
const DB_PASS = 'puertaya_test';
const DB_HOST = process.env.TEST_DB_HOST || '127.0.0.1';
const DB_PORT = process.env.TEST_DB_PORT || '5432';

const OPERADOR = { email: 'operador@e2e.test', password: 'ClaveSegura123' };

const log = (...a) => console.log('[e2e:entorno]', ...a);

// ── Postgres ────────────────────────────────────────────────────────────────
function psql(url, sql) {
  return execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-q', '-At', '-c', sql], { encoding: 'utf8' });
}

/** Ejecuta SQL contra la base de pruebas (la usan los escenarios que siembran PIN o tokens). */
export function sqlEnBase(dbUrl, sql) {
  return psql(dbUrl, sql).trim();
}

function adminUrl() {
  return `postgresql://${DB_ROL}:${DB_PASS}@${DB_HOST}:${DB_PORT}/postgres`;
}

/** Crea la base desechable. El rol puertaya_test (CREATEDB) hace todo; si el rol aún no existe se
 *  intenta crearlo con TEST_DB_ADMIN_URL o, siendo root, con `su postgres`. */
function crearBase(nombre) {
  try {
    psql(adminUrl(), `CREATE DATABASE "${nombre}"`);
    return;
  } catch (e) {
    log('no pude entrar con el rol puertaya_test; intento crearlo con un administrador…');
    const crearRol = `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${DB_ROL}') THEN CREATE ROLE ${DB_ROL} LOGIN CREATEDB PASSWORD '${DB_PASS}'; END IF; END $$;`;
    if (process.env.TEST_DB_ADMIN_URL) {
      psql(process.env.TEST_DB_ADMIN_URL, crearRol);
    } else if (process.getuid?.() === 0) {
      execFileSync('su', ['postgres', '-c', `psql -p ${DB_PORT} -d postgres -v ON_ERROR_STOP=1 -q`], { input: crearRol, encoding: 'utf8' });
    } else {
      throw new Error(`No pude conectar a Postgres (${DB_HOST}:${DB_PORT}). ¿Está encendido? (pg_ctlcluster 16 main start). ${e.message}`);
    }
    psql(adminUrl(), `CREATE DATABASE "${nombre}"`);
  }
}

function borrarBase(nombre) {
  try {
    psql(adminUrl(), `DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`);
  } catch (e) {
    log(`AVISO: no pude borrar la base ${nombre}; bórrala a mano.`, e.message.split('\n')[0]);
  }
}

// ── Procesos ────────────────────────────────────────────────────────────────
function puertoLibre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

async function esperarUrl(url, { intentos = 120, nombre = url } = {}) {
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch { /* aún no escucha */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${nombre} no respondió a tiempo en ${url}`);
}

function entornoLimpio(extra) {
  // Sin variables heredadas que cambien el comportamiento (correo real, bucket, etc.).
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(RESEND_|EMAIL_FROM|FOTOS_S3_|ENLACE_SECRET|ENTREGA_SECRET|RAILWAY_|TRUST_PROXY|DATABASE_URL|PORT$|NODE_ENV$)/.test(k)) delete env[k];
  }
  return { ...env, ...extra };
}

function correr(comando, args, { cwd, env }) {
  return execFileSync(comando, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function lanzar(nombre, comando, args, { cwd, env, hijos, salida }) {
  const hijo = spawn(comando, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  hijo.stdout.on('data', (d) => salida.push(`[${nombre}] ${d}`));
  hijo.stderr.on('data', (d) => salida.push(`[${nombre}] ${d}`));
  hijo.on('exit', (code, sig) => { hijo.salio = true; salida.push(`[${nombre}] terminó (code=${code} sig=${sig})\n`); });
  hijos.push(hijo);
  return hijo;
}

function matar(hijo) {
  return new Promise((resolve) => {
    if (!hijo || hijo.salio || hijo.exitCode !== null) return resolve();
    hijo.once('exit', () => resolve());
    hijo.kill('SIGTERM');
    setTimeout(() => { if (!hijo.salio) hijo.kill('SIGKILL'); }, 4000).unref();
  });
}

// ── API pública ─────────────────────────────────────────────────────────────
/** `opciones.segundoConjunto`: además del conjunto A ("Conjunto E2E", slug `e2e`) siembra un conjunto B
 *  (slug `e2e-b`, "Conjunto B") con su propio operador; así hay 2 conjuntos activos (solo modo local).
 *  Se usa en e2e/dos-conjuntos.spec.mjs, que levanta su propia pila para no alterar los escenarios de 1 conjunto. */
export async function levantarEntorno(opciones = {}) {
  const baseRemota = (process.env.E2E_BASE_URL || '').replace(/\/$/, '');
  const apiRemota = (process.env.E2E_API_URL || '').replace(/\/$/, '');

  if (baseRemota && apiRemota) {
    const faltan = ['E2E_OPERADOR_EMAIL', 'E2E_OPERADOR_PASSWORD', 'E2E_CODIGO_INVITACION'].filter((k) => !process.env[k]);
    if (faltan.length) throw new Error(`Modo remoto: faltan ${faltan.join(', ')}.`);
    const info = {
      modo: 'remoto',
      baseUrl: baseRemota,
      apiUrl: apiRemota,
      operador: { email: process.env.E2E_OPERADOR_EMAIL, password: process.env.E2E_OPERADOR_PASSWORD },
      codigo: process.env.E2E_CODIGO_INVITACION,
      dbUrl: null,
      secuencia: fs.mkdtempSync(path.join(os.tmpdir(), 'puertaya-e2e-seq-')),
    };
    process.env.E2E_ENTORNO = JSON.stringify(info);
    log(`modo remoto: web ${info.baseUrl}, api ${info.apiUrl}`);
    return { ...info, detener: async () => { fs.rmSync(info.secuencia, { recursive: true, force: true }); } };
  }

  const hijos = [];
  const salida = [];
  const nombreBase = `puertaya_e2e_${process.pid}_${Date.now().toString(36)}`;
  let baseCreada = false;
  let detenido = false;

  const detener = async () => {
    if (detenido) return;
    detenido = true;
    await Promise.all(hijos.map(matar));
    if (baseCreada) borrarBase(nombreBase);
    fs.rmSync(info?.secuencia ?? '', { recursive: true, force: true });
    log('entorno detenido y base borrada');
  };
  // Si el runner muere de forma brusca, no dejamos procesos sueltos.
  const alSalir = () => { for (const h of hijos) { try { h.kill('SIGKILL'); } catch { /* ya terminó */ } } };
  process.once('exit', alSalir);
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { detener().finally(() => process.exit(130)); });

  let info;
  try {
    crearBase(nombreBase);
    baseCreada = true;
    const dbUrl = `postgresql://${DB_ROL}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${nombreBase}`;
    const apiPort = await puertoLibre();
    const webPort = await puertoLibre();
    const baseUrl = `http://127.0.0.1:${webPort}`;
    const apiUrl = `http://127.0.0.1:${apiPort}`;

    const envBackend = entornoLimpio({
      DATABASE_URL: dbUrl,
      JWT_SECRET: 'secreto-e2e-solo-de-pruebas-locales',
      NODE_ENV: 'development',
      PORT: String(apiPort),
      FRONTEND_URL: baseUrl,
      CORS_ORIGIN: baseUrl,
      SEED_CONJUNTO_SLUG: 'e2e',
      SEED_CONJUNTO_NOMBRE: 'Conjunto E2E',
      OPERATOR_EMAIL: OPERADOR.email,
      OPERATOR_PASSWORD: OPERADOR.password,
      OPERATOR_NOMBRE: 'Operador E2E',
      OPERATOR_TELEFONO: '3000000000',
    });

    log(`base ${nombreBase}: migrate deploy + seed…`);
    correr('npx', ['prisma', 'migrate', 'deploy'], { cwd: BACKEND, env: envBackend });
    const seed = correr('npm', ['run', 'seed'], { cwd: BACKEND, env: envBackend });
    const codigo = /Código de invitación:\s*(\S+)/.exec(seed)?.[1];
    if (!codigo) throw new Error(`El seed no imprimió el código de invitación:\n${seed}`);
    let b = null;
    if (opciones.segundoConjunto) {
      const operadorB = { email: 'operador-b@e2e.test', password: 'ClaveSegura123' };
      const seedB = correr('npm', ['run', 'seed'], {
        cwd: BACKEND,
        env: { ...envBackend, SEED_CONJUNTO_SLUG: 'e2e-b', SEED_CONJUNTO_NOMBRE: 'Conjunto B', OPERATOR_EMAIL: operadorB.email, OPERATOR_PASSWORD: operadorB.password, OPERATOR_NOMBRE: 'Operador B' },
      });
      b = { slug: 'e2e-b', nombre: 'Conjunto B', operador: operadorB, codigo: /Código de invitación:\s*(\S+)/.exec(seedB)?.[1] };
    }

    lanzar('api', process.execPath, ['src/index.js'], { cwd: BACKEND, env: envBackend, hijos, salida });
    const envVite = entornoLimpio({ VITE_PROXY_TARGET: apiUrl });
    lanzar('web', process.execPath, [path.join(FRONTEND, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'],
      { cwd: FRONTEND, env: envVite, hijos, salida });

    await esperarUrl(`${apiUrl}/health`, { nombre: 'backend' });
    await esperarUrl(`${baseUrl}/`, { nombre: 'vite' });
    // Calienta el proxy y la compilación inicial de vite para que el primer escenario no pague el arranque.
    await esperarUrl(`${baseUrl}/api/conjuntos/config-publica?c=${encodeURIComponent(codigo)}`, { nombre: 'proxy /api', intentos: 20 });

    info = {
      modo: 'local', baseUrl, apiUrl, dbUrl, operador: OPERADOR, codigo, a: { slug: 'e2e', nombre: 'Conjunto E2E' }, b,
      secuencia: fs.mkdtempSync(path.join(os.tmpdir(), 'puertaya-e2e-seq-')),
      pids: hijos.map((h) => h.pid),
    };
    process.env.E2E_ENTORNO = JSON.stringify(info);
    log(`listo: web ${baseUrl} (pid ${hijos[1].pid}), api ${apiUrl} (pid ${hijos[0].pid}), base ${nombreBase}`);
    return { ...info, salida, detener };
  } catch (e) {
    console.error(salida.join(''));
    await detener();
    throw e;
  }
}

// Playwright: globalSetup (export default) devuelve el teardown.
export default async function globalSetup() {
  const entorno = await levantarEntorno();
  return () => entorno.detener();
}
