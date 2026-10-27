// Suite E2E del recorrido principal (T6.1). Ver README, sección "Pruebas E2E".
// El entorno (base Postgres desechable + backend + vite, o URLs remotas) lo gestiona
// e2e/entorno.mjs; las URLs llegan a los tests por la fixture `baseURL` (no se conocen al cargar este archivo).
import { defineConfig } from '@playwright/test';
import { chromium } from '@playwright/test';
import fs from 'node:fs';

// Chromium preinstalado: si la versión del paquete no encuentra su navegador, se usa
// PW_CHROMIUM_PATH o, en su defecto, /opt/pw-browsers/chromium. Nunca se ejecuta `playwright install`.
function rutaChromium() {
  if (process.env.PW_CHROMIUM_PATH) return process.env.PW_CHROMIUM_PATH;
  let propio = '';
  try { propio = chromium.executablePath(); } catch { /* sin navegador del paquete */ }
  if (propio && fs.existsSync(propio)) return undefined;
  return fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
}

// Modo remoto (despliegue real, p. ej. Railway): red y bcrypt reales, datos compartidos.
// Los tiempos se amplían SOLO aquí; lo que se verifica no cambia. Un solo worker: los escenarios
// comparten el mismo conjunto DEMO y el operador, y en paralelo se estorban (latencia, "Pendientes").
const REMOTO = !!(process.env.E2E_BASE_URL && process.env.E2E_API_URL);

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.mjs',
  globalSetup: './e2e/entorno.mjs',
  timeout: REMOTO ? 120_000 : 60_000,
  expect: { timeout: REMOTO ? 25_000 : 10_000 },
  fullyParallel: false,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : (REMOTO ? 1 : 2),
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    ...(REMOTO ? { actionTimeout: 30_000, navigationTimeout: 45_000 } : {}),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'es-CO',
    launchOptions: { executablePath: rutaChromium() },
  },
  projects: [
    { name: 'movil', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
    { name: 'escritorio', use: { viewport: { width: 1280, height: 800 } } },
  ],
});
