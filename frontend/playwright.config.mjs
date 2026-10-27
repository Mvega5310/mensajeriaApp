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

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.mjs',
  globalSetup: './e2e/entorno.mjs',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 2,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
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
