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
export function siguienteApto() {
  const dir = entorno().secuencia;
  const inicio = entorno().modo === 'remoto' ? Math.floor(Math.random() * 800) : 0;
  for (let n = inicio; ; n++) {
    try {
      fs.mkdirSync(path.join(dir, String(n)));
      return { torre: `Torre ${(Math.floor(n / 900) % 6) + 1}`, apto: String(100 + (n % 900)) };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
}

export const sufijo = () => crypto.randomBytes(3).toString('hex');

/** Registra un residente por la API (con el código de invitación) y entra. Nombre/correo únicos. */
export async function crearResidente({ nombre } = {}) {
  const s = sufijo();
  const { torre, apto } = siguienteApto();
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

let tokenOperador = null;
export async function sesionOperador() {
  if (tokenOperador) return tokenOperador;
  const { email, password } = entorno().operador;
  const l = await api('/auth/login', { metodo: 'POST', cuerpo: { email, password } });
  if (!l.ok) throw new Error(`No pude entrar como operador: ${l.datos.message}`);
  tokenOperador = l.datos.token;
  return tokenOperador;
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
  return browser.newContext({ baseURL, viewport, hasTouch, isMobile, locale: 'es-CO' });
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
  await c.tocar(page.locator('.op-sug', { hasText: residente.nombre }));
  await expect(page.locator('.op-tile').first()).toBeVisible();
  await sinScrollHorizontal(page, 'Tamaño');
  await c.tocar(page.locator('.op-tile').nth(1)); // paquete estándar
  if (guia) {
    await c.tocar(page.getByRole('button', { name: /guía/i }));
    await page.getByLabel('Número de guía').fill(guia);
    await c.tocar(page.getByRole('button', { name: 'Guardar guía' }));
  }
  await c.tocar(page.getByRole('button', { name: 'Guardar', exact: true }));
  await expect(page.getByRole('heading', { name: 'Guardado', exact: true })).toBeVisible();
  await sinScrollHorizontal(page, 'Guardado');
  return c;
}

export const test = base.extend({
  // La URL del frontend se conoce solo después del globalSetup: se lee aquí, no en la configuración.
  baseURL: async ({}, use) => { await use(entorno().baseUrl); },
});
