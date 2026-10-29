// Fixtures y ayudas comunes de la suite E2E (T6.1).
import { test as base, expect } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sqlEnBase } from './entorno.mjs';

export { expect };

export const entorno = () => JSON.parse(process.env.E2E_ENTORNO || '{}');

// ── API directa (datos de cada escenario) ───────────────────────────────────
export async function api(ruta, { metodo = 'GET', token, cuerpo, cabeceras } = {}) {
  const r = await fetch(`${entorno().apiUrl}/api${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...cabeceras },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, datos };
}

/** Apartamento único en toda la corrida (aunque corran varios workers y ambos proyectos):
 *  `mkdir` es atómico, así dos escenarios nunca comparten apartamento (la cortesía y el lote
 *  son por apartamento). 3 dígitos (100-999) en la torre 1; al agotarse, sigue con la torre 2, etc. */
export async function siguienteApto() {
  const dir = entorno().secuencia;
  const remoto = entorno().modo === 'remoto';
  const inicio = remoto ? Math.floor(Math.random() * 900) : 0;
  for (let i = 0; i < 900; i++) {
    const n = (inicio + i) % 900;
    try {
      fs.mkdirSync(path.join(dir, String(n)));
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      continue;
    }
    const apto = String(100 + n);
    // Entorno compartido (Railway): el conjunto DEMO conserva residentes de corridas anteriores. Un apto
    // ya ocupado haría que la búsqueda (máx. 5) devuelva a otros residentes y que cortesía/lote
    // se mezclen con paquetes ajenos: se descarta y se sigue con el siguiente.
    if (remoto && await aptoOcupado(apto)) continue;
    return { torre: 'Torre 1', apto };
  }
  throw new Error('No quedan apartamentos libres de 3 dígitos en este conjunto de pruebas.');
}

/** ¿Hay algún residente con ese apartamento (en cualquier torre)? Lee /residentes/buscar con la sesión del operador. */
async function aptoOcupado(apto) {
  const r = await api(`/residentes/buscar?q=${encodeURIComponent(apto)}`, { token: await sesionOperador() });
  if (!r.ok) throw new Error(`No pude verificar el apartamento ${apto}: ${r.datos.message}`);
  const lista = Array.isArray(r.datos) ? r.datos : (r.datos.residentes ?? []);
  return lista.some((u) => u.apto === apto);
}

export const sufijo = () => crypto.randomBytes(3).toString('hex');

/** Registra un residente por la API (con el código de invitación) y entra. Nombre/correo únicos. */
export async function crearResidente({ nombre } = {}) {
  const s = sufijo();
  const { torre, apto } = await siguienteApto();
  const datos = {
    nombre: nombre ?? `Residente ${s}`,
    email: `res-${s}@e2e.test`,
    password: 'ClaveSegura123',
    telefono: '3001234567',
    torre,
    apto,
  };
  const reg = await api('/auth/register', {
    metodo: 'POST',
    cuerpo: { ...datos, acceptedTerms: true, codigoInvitacion: entorno().codigo },
  });
  if (!reg.ok) throw new Error(`No pude registrar al residente: ${reg.datos.message}`);
  const l = await api('/auth/login', { metodo: 'POST', cuerpo: { email: datos.email, password: datos.password } });
  if (!l.ok) throw new Error(`No pude entrar como residente: ${l.datos.message}`);
  const etiqueta = `T${torre.replace(/\D/g, "")} · ${apto}`;
  return { ...datos, id: l.datos.user.id, token: l.datos.token, etiqueta };
}

const tokensOperador = new Map();
/** Sesión de un operador (por defecto el del conjunto A / único). Se guarda por API+correo: cada pila de E2E tiene la suya. */
export async function sesionOperador(operador = entorno().operador) {
  const clave = `${entorno().apiUrl}|${operador.email}`;
  if (tokensOperador.has(clave)) return tokensOperador.get(clave);
  const l = await api('/auth/login', { metodo: 'POST', cuerpo: { email: operador.email, password: operador.password } });
  if (!l.ok) throw new Error(`No pude entrar como operador: ${l.datos.message}`);
  tokensOperador.set(clave, l.datos.token);
  return l.datos.token;
}

/** Recepción por API (datos de apoyo; el escenario que prueba la pantalla usa la UI). */
export async function recibirPorApi(cuerpo) {
  const token = await sesionOperador();
  const r = await api('/packages/recepcion', {
    metodo: 'POST', token, cuerpo: { categoriaPeso: 'ESTANDAR', ...cuerpo }, cabeceras: { 'Idempotency-Key': crypto.randomUUID() },
  });
  if (!r.ok) throw new Error(`Recepción por API falló: ${r.datos.message}`);
  return r.datos;
}

/** Vista del residente (con PIN) por la API, con su sesión normal. */
export async function misPaquetes(residente) {
  const r = await api('/p/paquetes', { token: residente.token });
  if (!r.ok) throw new Error(`No pude leer los paquetes de ${residente.email}: ${r.datos.message}`);
  return r.datos.paquetes;
}

export const pinDe = async (residente) => (await misPaquetes(residente)).find((p) => p.pin)?.pin;

/** Extrae el enlace `/p#token` de un texto (aviso.texto o waUrl decodificado). */
export function enlaceDe(texto) {
  const t = decodeURIComponent(texto ?? '');
  return /https?:\/\/[^\s]+\/p#[\w.\-%]+/.exec(t)?.[0] ?? null;
}

export const sql = (consulta) => sqlEnBase(entorno().dbUrl, consulta);

export const sinPin = (texto, pin) => !new RegExp(`(?<!\\d)${pin}(?!\\d)`).test(texto);

// ── Navegador ───────────────────────────────────────────────────────────────
/** Deja la sesión (JWT) y, si se pide, el tema, antes de que cargue cualquier página del contexto. */
export async function iniciarSesion(context, token, { tema } = {}) {
  await context.addInitScript(([t, th]) => {
    try {
      if (t) localStorage.setItem('token', t);
      if (th) localStorage.setItem('puertaya-tema', th);
    } catch { /* sin almacenamiento */ }
  }, [token, tema ?? null]);
}

/** Contexto nuevo con el mismo tamaño que el proyecto en curso. */
export async function contextoNuevo(browser, testInfo, baseURL) {
  const { viewport, hasTouch, isMobile } = testInfo.project.use;
  const ctx = await browser.newContext({ baseURL, viewport, hasTouch, isMobile, locale: 'es-CO' });
  await calentarServiceWorker(ctx, baseURL);
  return ctx;
}

/** Contexto limpio (primera visita real) sin calentar: solo para probar el comportamiento de la primera visita. */
export async function contextoVirgen(browser, testInfo, baseURL) {
  const { viewport, hasTouch, isMobile } = testInfo.project.use;
  return browser.newContext({ baseURL, viewport, hasTouch, isMobile, locale: 'es-CO' });
}

/** En remoto (build de producción con PWA) un contexto nuevo registra el service worker en su primera
 *  visita. Las versiones desplegadas antes del arreglo de `main.jsx` recargaban la página cuando el SW
 *  reclamaba la pestaña (`controllerchange`), borrando lo que la prueba ya había tecleado. Para que las
 *  pruebas no dependan de esa carrera se visita `/` una vez y se espera al controlador ANTES del escenario.
 *  No cambia lo que se verifica. En local (vite dev, sin SW) no hace nada. */
export async function calentarServiceWorker(context, baseURL) {
  if (entorno().modo !== 'remoto') return;
  const p = await context.newPage();
  try {
    await p.goto(baseURL || entorno().baseUrl, { waitUntil: 'load' });
    for (let i = 0; i < 40; i++) {
      try {
        const listo = await p.evaluate(() => !('serviceWorker' in navigator) || !!navigator.serviceWorker.controller);
        if (listo) break;
      } catch { /* la página se está recargando por el controllerchange: reintentar */ }
      await p.waitForTimeout(500);
    }
    await p.waitForLoadState('load').catch(() => {});
    await p.waitForTimeout(500);
  } finally {
    await p.close();
  }
}

/** Aserción reutilizable: la página no se desplaza en horizontal. */
export async function sinScrollHorizontal(page, donde = '') {
  const r = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    ventana: window.innerWidth,
    cuerpo: document.body.scrollWidth,
  }));
  expect(r.scroll, `scroll horizontal en ${donde || page.url()}`).toBeLessThanOrEqual(r.ventana + 1);
  expect(r.cuerpo, `scroll horizontal del body en ${donde || page.url()}`).toBeLessThanOrEqual(r.ventana + 1);
}

/** Cuenta toques: cada clic hecho por el operador pasa por aquí. */
export function contadorDeToques() {
  const c = { n: 0 };
  c.tocar = async (localizador, opciones) => { await localizador.click(opciones); c.n += 1; };
  return c;
}

export async function teclear(page, digitos, c) {
  for (const d of digitos) {
    const tecla = page.locator('.ds-key', { hasText: new RegExp(`^${d}$`) }).first();
    if (c) await c.tocar(tecla); else await tecla.click();
  }
}

/** Recepción completa por la UI, de /op/recibir hasta "Guardado". Devuelve la cuenta de toques. */
export async function recibirPorUI(page, residente, { guia, nuevaPagina = true } = {}) {
  const c = contadorDeToques();
  if (nuevaPagina) await page.goto('/op/recibir');
  await expect(page.getByRole('heading', { name: 'Recibir' })).toBeVisible();
  await sinScrollHorizontal(page, 'Recibir');
  await teclear(page, residente.apto, c);
  const sug = page.locator('.op-sug', { hasText: residente.nombre });
  await expect(sug).toBeVisible();
  const guardar = page.getByRole('button', { name: 'Guardar', exact: true });
  if (!guia && await guardar.isVisible()) {
    // Camino corto (T8.1): una sola sugerencia con apto completo -> "Guardar" directo (Estándar preseleccionado).
    c.corto = true;
  } else {
    await c.tocar(sug);
    await expect(page.locator('.op-tile').first()).toBeVisible();
    await sinScrollHorizontal(page, 'Tamaño');
    await c.tocar(page.locator('.op-tile').nth(1)); // paquete estándar
    if (guia) {
      await c.tocar(page.getByRole('button', { name: /guía/i }));
      await page.getByLabel('Número de guía').fill(guia);
      await c.tocar(page.getByRole('button', { name: 'Guardar guía' }));
    }
  }
  await c.tocar(page.getByRole('button', { name: 'Guardar', exact: true }));
  await expect(page.getByRole('heading', { name: 'Guardado', exact: true })).toBeVisible();
  await sinScrollHorizontal(page, 'Guardado');
  return c;
}

export const test = base.extend({
  // `context` del proyecto: en remoto se calienta el service worker antes de abrir la página del escenario.
  context: async ({ context, baseURL }, use) => {
    await calentarServiceWorker(context, baseURL);
    await use(context);
  },
  // La URL del frontend se conoce solo después del globalSetup: se lee aquí, no en la configuración.
  baseURL: async ({}, use) => { await use(entorno().baseUrl); },
});
