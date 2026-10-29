// Auditoría de accesibilidad y textos de Puertayá (T4.6).
//
// Recorre TODAS las pantallas del operador y del residente (login, registro, recuperar,
// acceso, términos, recibir, pesar, guardado, entregar, cobrar, pendientes, hojas "Más",
// bitácora, buzón, invitar, residente, estados de error/vacío e indicador de cola sin señal)
// a 390x844 y 1280x800, en día y en noche, y por cada una:
//   - corre axe-core (WCAG 2.0/2.1/2.2 A y AA + buenas prácticas). FALLA con cualquier
//     violación "serious" o "critical". moderate/minor se listan como informativas.
//   - verifica a mano: controles >= 48x48 px (salvo enlaces dentro de texto corrido), foco
//     visible al navegar con Tab, aria-label en botones de solo ícono, lang="es", título de
//     página propio, sin scroll horizontal a 390 px, textos >= 16 px en contenido (14 px solo
//     para apoyo: insignias, sellos, pestañas, ayudas), hojas con foco atrapado y Esc.
//   - con prefers-reduced-motion: reduce comprueba que no queda ninguna animación activa.
//   - revisa el contraste de los pares de tokens (--muted sobre --raised, etc.) leyendo
//     src/design/tokens.css.
//
// REQUISITOS
//   - Un frontend sirviendo la app (build + `vite preview`, o cualquier servidor que sirva
//     frontend/dist con fallback a index.html y proxy de /api al backend) y su backend con una
//     base Postgres DESECHABLE ya migrada y con el seed del operador:
//       cd backend && npx prisma migrate deploy
//       OPERATOR_EMAIL=op@a11y.test OPERATOR_PASSWORD=ClaveSegura123 npm run seed
//   - `playwright` (global o en node_modules) con Chromium y `@axe-core/playwright`
//     (devDependency de frontend). Si Playwright no resuelve, se busca en `npm root -g`.
//   - La script siembra sus datos de prueba vía API (residentes, paquetes, comentario, entrega).
//     Es idempotente: si los residentes ya existen, los reutiliza.
//
// USO (desde frontend/)
//   BASE_URL=http://localhost:5173 CODIGO_INVITACION=<codigo del seed> \
//   OP_EMAIL=op@a11y.test OP_PASSWORD=ClaveSegura123 \
//   node e2e/a11y.audit.mjs
//
// VARIABLES (todas opcionales salvo CODIGO_INVITACION)
//   BASE_URL            URL del frontend (def. http://localhost:5173)
//   API_URL             URL base de la API (def. BASE_URL + /api)
//   CODIGO_INVITACION   código de invitación del conjunto (lo imprime el seed)
//   OP_EMAIL / OP_PASSWORD   cuenta de operador del seed
//   SALIDA              carpeta de capturas y resultados.json (def. ./a11y-salida; NO se commitea)
//   PREFIJO             prefijo de las capturas (def. a11y-)
//   SOLO                subcadena: audita solo las pantallas cuyo id la contenga
//   SIN_CAPTURAS=1      no guarda PNG
//
// SALIDA: tabla por pantalla y variante, resultados.json, y código de salida 1 si hay
// violaciones serias/críticas de axe o fallos manuales.

import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';

const require = createRequire(import.meta.url);
function cargarPlaywright() {
  try { return require('@playwright/test'); } catch { /* sigue */ }
  try { return require('playwright'); } catch { /* sigue */ }
  const raiz = execSync('npm root -g').toString().trim();
  return require(path.join(raiz, 'playwright'));
}
const { chromium } = cargarPlaywright();

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const API = (process.env.API_URL || `${BASE}/api`).replace(/\/$/, '');
const CODIGO = process.env.CODIGO_INVITACION || '';
const OP_EMAIL = process.env.OP_EMAIL || 'op@a11y.test';
const OP_PASSWORD = process.env.OP_PASSWORD || 'ClaveSegura123';
const SALIDA = path.resolve(process.env.SALIDA || path.join(process.cwd(), 'a11y-salida'));
const PREFIJO = process.env.PREFIJO ?? 'a11y-';
const SOLO = process.env.SOLO || '';
const CAPTURAS = !process.env.SIN_CAPTURAS;
fs.mkdirSync(SALIDA, { recursive: true });

if (!CODIGO) { console.error('Falta CODIGO_INVITACION (lo imprime `npm run seed`).'); process.exit(2); }

const VARIANTES = [
  { id: '390-dia', ancho: 390, alto: 844, tema: 'dia', reducir: false },
  { id: '390-noche', ancho: 390, alto: 844, tema: 'noche', reducir: false },
  { id: '1280-dia', ancho: 1280, alto: 800, tema: 'dia', reducir: false },
  { id: '1280-noche', ancho: 1280, alto: 800, tema: 'noche', reducir: false },
  { id: '390-dia-reducido', ancho: 390, alto: 844, tema: 'dia', reducir: true },
];

// ── API y datos de prueba ───────────────────────────────────────────────────
async function api(ruta, { metodo = 'GET', token, cuerpo, cabeceras } = {}) {
  const r = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...cabeceras },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, datos };
}

// PNG de 1x1 para que haya fotos reales sin pesar nada.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function sembrar() {
  const op = await api('/auth/login', { metodo: 'POST', cuerpo: { email: OP_EMAIL, password: OP_PASSWORD } });
  if (!op.ok) throw new Error(`No pude entrar como operador: ${op.datos.message}`);
  const tokenOp = op.datos.token;
  const residentes = [
    { clave: 'res1', nombre: 'Ana Pérez', email: 'ana@a11y.test', telefono: '3001112233', torre: 'Torre 2', apto: '304' },
    { clave: 'res2', nombre: 'Luis Gómez', email: 'luis@a11y.test', telefono: '3004445566', torre: 'Torre 1', apto: '101' },
    { clave: 'res3', nombre: 'Marta Ríos', email: 'marta@a11y.test', telefono: '3007778899', torre: 'Torre 3', apto: '502' },
    // S3.2: dos personas en el mismo apartamento (lote que mezcla, "Desactivar dirección") y una
    // homónima de Ana en su mismo apartamento (aviso de duplicado en la búsqueda del operador).
    { clave: 'res4', nombre: 'Carlos Mora', email: 'carlos@a11y.test', telefono: '3001239999', torre: 'Torre 4', apto: '405' },
    { clave: 'res5', nombre: 'Sofía Mora', email: 'sofia@a11y.test', telefono: '3001238888', torre: 'Torre 4', apto: '405' },
    { clave: 'res6', nombre: 'Ana Pérez', email: 'ana2@a11y.test', telefono: '3009994567', torre: 'Torre 2', apto: '304' },
  ];
  const datos = { op: { token: tokenOp, id: op.datos.user.id }, residentes: {} };
  for (const r of residentes) {
    await api('/auth/register', {
      metodo: 'POST',
      cuerpo: { ...r, password: 'ClaveSegura123', acceptedTerms: true, codigoInvitacion: CODIGO },
    });
    const l = await api('/auth/login', { metodo: 'POST', cuerpo: { email: r.email, password: 'ClaveSegura123' } });
    if (!l.ok) throw new Error(`No pude entrar como ${r.email}: ${l.datos.message}`);
    datos.residentes[r.clave] = { ...r, token: l.datos.token, id: l.datos.user.id };
  }
  const recibir = (cuerpo) => api('/packages/recepcion', {
    metodo: 'POST', token: tokenOp, cuerpo, cabeceras: { 'Idempotency-Key': crypto.randomUUID() },
  });

  const yaTiene = await api('/p/paquetes', { token: datos.residentes.res1.token });
  if (!(yaTiene.datos.paquetes?.length > 0)) {
    const r1 = await recibir({ residenteId: datos.residentes.res1.id, categoriaPeso: 'ESTANDAR', transportadora: 'Servientrega', guia: 'SV123456', fotos: [PNG] });
    datos.enlace = /https?:\/\/\S+\/p#[\w.-]+/.exec(r1.datos?.aviso?.texto ?? r1.datos?.aviso?.waUrl ?? '')?.[0]
      ?? decodeURIComponent(r1.datos?.aviso?.waUrl ?? '').match(/https?:\/\/\S+\/p#[\w.-]+/)?.[0];
    await recibir({ residenteId: datos.residentes.res1.id, categoriaPeso: 'MANO' });
    await recibir({ residenteId: null, etiquetaNombre: 'Carlos M.', categoriaPeso: 'VOLUMEN' });
    await api('/packages', { metodo: 'POST', token: datos.residentes.res1.token, cuerpo: { proveedor: 'Mercado Libre', guia: 'ML998877', categoriaPeso: 'ESTANDAR' } });
    await api('/comments', { metodo: 'POST', token: datos.residentes.res1.token, cuerpo: { mensaje: 'Gracias por avisar rápido. ¿Pueden dejar los paquetes grandes en la bodega?' } });
    // Marta: un paquete entregado (historial) y otro por entregar (cobro con PIN real).
    const m1 = await recibir({ residenteId: datos.residentes.res3.id, categoriaPeso: 'ESTANDAR' });
    await recibir({ residenteId: datos.residentes.res3.id, categoriaPeso: 'PESADO' });
    void m1;
    await recibir({ residenteId: datos.residentes.res4.id, categoriaPeso: 'ESTANDAR' });
    await recibir({ residenteId: datos.residentes.res5.id, categoriaPeso: 'MANO' });
    const vista = await api('/p/paquetes', { token: datos.residentes.res3.token });
    const pin = vista.datos.paquetes?.find((p) => p.pin)?.pin;
    if (pin) {
      const v = await api('/entregas/verificar-pin', { metodo: 'POST', token: tokenOp, cuerpo: { pin, residenteId: datos.residentes.res3.id } });
      if (v.ok) {
        const ids = [v.datos.paquetes[0].id];
        await api('/entregas/confirmar', { metodo: 'POST', token: tokenOp, cuerpo: { tokenEntrega: v.datos.tokenEntrega, paqueteIds: ids, metodoPago: v.datos.metodosPago?.[0] ?? 'EFECTIVO' } });
      }
    }
  }
  if (!datos.enlace) {
    const extra = await recibir({ residenteId: datos.residentes.res1.id, categoriaPeso: 'MANO' });
    const texto = `${extra.datos?.aviso?.texto ?? ''} ${decodeURIComponent(extra.datos?.aviso?.waUrl ?? '')}`;
    datos.enlace = /https?:\/\/\S+\/p#[\w.-]+/.exec(texto)?.[0] ?? null;
  }
  // PIN vigente de Marta para la pantalla de cobro y enlace de WhatsApp de Ana.
  const vm = await api('/p/paquetes', { token: datos.residentes.res3.token });
  datos.pinMarta = vm.datos.paquetes?.find((p) => p.pin)?.pin ?? '0000';
  const vc = await api('/p/paquetes', { token: datos.residentes.res4.token });
  datos.pinCarlos = vc.datos.paquetes?.find((p) => p.pin)?.pin ?? '0000';
  return datos;
}

// ── contraste de tokens ─────────────────────────────────────────────────────
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

function contrasteDeTokens() {
  const css = fs.readFileSync(path.join(AQUI, '../src/design/tokens.css'), 'utf8');
  const bloque = (re) => {
    const m = re.exec(css); const vars = {};
    for (const [, k, v] of m[1].matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})/g)) vars[k] = v;
    return vars;
  };
  const dia = bloque(/:root,\s*\.pt\.dia\s*\{([\s\S]*?)\n\}/);
  const noche = bloque(/\[data-tema="noche"\],\s*\.pt\.noche\s*\{([\s\S]*?)\n\}/);
  const texto = [['ink', 'bg'], ['ink', 'surface'], ['ink', 'raised'], ['muted', 'bg'], ['muted', 'surface'], ['muted', 'raised'],
    ['action', 'bg'], ['action', 'surface'], ['action', 'raised'], ['on-action', 'action'], ['on-wa', 'wa'],
    ['gift', 'bg'], ['gift', 'surface'], ['warn', 'bg'], ['warn', 'surface'], ['warn', 'raised'], ['danger', 'bg'],
    ['danger', 'surface'], ['danger', 'raised'], ['pin', 'surface'], ['pin', 'bg']];
  const control = [['line-strong', 'bg'], ['line-strong', 'surface'], ['line-strong', 'raised']];
  const filas = [];
  for (const [tema, v] of [['dia', dia], ['noche', noche]]) {
    for (const [a, b] of texto) filas.push({ tema, par: `${a} / ${b}`, minimo: 4.5, valor: ratio(v[a], v[b]) });
    for (const [a, b] of control) filas.push({ tema, par: `${a} / ${b}`, minimo: 3, valor: ratio(v[a], v[b]) });
  }
  return filas.map((f) => ({ ...f, ok: f.valor >= f.minimo }));
}

// ── comprobaciones dentro de la página ─────────────────────────────────────
// Se serializa tal cual en el navegador: no puede usar nada de fuera.
function revisarEnPagina({ ancho }) {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    if (el.closest('.ds-sr-only, [aria-hidden="true"], [hidden], [inert]')) return false;
    return true;
  };
  const dialogo = document.querySelector('[role="dialog"][aria-modal="true"]');
  const dentro = (el) => !dialogo || dialogo.contains(el);
  const nombre = (el) => (el.getAttribute('aria-label') || el.innerText || el.value || el.title || el.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const marca = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/)[0]}` : ''}`;

  const sel = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="radio"], [role="checkbox"], [role="tab"], [role="switch"]';
  const pequenos = [];
  const sinNombre = [];
  for (const el of document.querySelectorAll(sel)) {
    if (!visible(el) && !(['checkbox', 'radio'].includes(el.type) && el.labels?.[0] && visible(el.labels[0]))) continue;
    if (!dentro(el)) continue;
    let caja = el;
    if (['checkbox', 'radio'].includes(el.type) && el.labels?.[0]) caja = el.labels[0];
    const r = caja.getBoundingClientRect();
    if (el.tagName === 'A') {
      const padre = el.parentElement;
      const corrido = padre && ['P', 'LI', 'SPAN', 'LABEL'].includes(padre.tagName)
        && padre.textContent.trim().length > el.textContent.trim().length + 3;
      if (corrido) continue;
    }
    if (r.width < 47.5 || r.height < 47.5) pequenos.push({ el: marca(el), nombre: nombre(el), w: Math.round(r.width), h: Math.round(r.height) });
    if (['BUTTON', 'A'].includes(el.tagName) || el.getAttribute('role') === 'button') {
      if (!nombre(el)) sinNombre.push({ el: marca(el) });
    }
  }

  // Textos: 16 px; 14 px solo para apoyo.
  const APOYO = /ds-badge|ds-stamp|ds-nav__tab|ds-field__ayuda|ds-label__hora|ds-toast__cerrar/;
  const chicos = new Map();
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || !visible(el) || !dentro(el) || ['SCRIPT', 'STYLE'].includes(el.tagName)) continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px >= 16) continue;
    const apoyo = !!el.closest('[class*="ds-badge"], [class*="ds-stamp"], [class*="ds-nav__tab"], [class*="ds-field__ayuda"], [class*="ds-label__hora"]') || APOYO.test(el.className || '');
    if (apoyo && px >= 14) continue;
    const k = `${marca(el)}|${px}`;
    if (!chicos.has(k)) chicos.set(k, { el: marca(el), px, texto: n.textContent.trim().slice(0, 40) });
  }

  const scrollH = document.documentElement.scrollWidth > window.innerWidth + 1 && ancho <= 400;
  return {
    pequenos, sinNombre,
    textosChicos: [...chicos.values()],
    scrollHorizontal: scrollH,
    lang: document.documentElement.lang,
    titulo: document.title,
    h1: document.querySelectorAll('h1').length,
  };
}

function animacionesActivas() {
  const salida = [];
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    const anim = cs.animationName !== 'none' && parseFloat(cs.animationDuration) * (cs.animationDuration.endsWith('ms') ? 1 : 1000) > 1;
    const trans = parseFloat(cs.transitionDuration) * (cs.transitionDuration.endsWith('ms') ? 1 : 1000) > 1;
    if (anim || trans) salida.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} ${anim ? cs.animationName + ' ' + cs.animationDuration : 'transición ' + cs.transitionDuration}`);
    if (salida.length > 5) break;
  }
  return salida;
}

// Foco con Tab: orden, visibilidad del anillo, que el foco no se pierda ni quede fuera de la hoja.
async function recorrerTab(page, maximo = 60) {
  const hallazgos = { sinAnillo: [], fueraDeHoja: [], orden: [], pasos: 0 };
  let previo = null; let primero = null; const vistos = new Set();
  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
  for (let i = 0; i < maximo; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const dlg = document.querySelector('[role="dialog"][aria-modal="true"]');
      // En un campo de fecha, Tab recorre día/mes/año y el botón del calendario (ver components.css): se omite.
      const anillo = el.type === 'date' || (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2) || (cs.boxShadow && cs.boxShadow !== 'none');
      return {
        id: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}:${(el.getAttribute('aria-label') || el.innerText || el.value || '').trim().slice(0, 25)}`,
        anillo: !!anillo, x: r.x, y: r.y, w: r.width, h: r.height,
        enHoja: dlg ? dlg.contains(el) : null,
        visible: r.width > 0 && r.height > 0,
      };
    });
    if (!info) continue;
    hallazgos.pasos += 1;
    if (primero && info.id === primero.id) break;
    primero ??= info;
    const yaVisto = vistos.has(info.id); vistos.add(info.id); void yaVisto;
    if (!info.anillo) hallazgos.sinAnillo.push(info.id);
    if (info.enHoja === false) hallazgos.fueraDeHoja.push(info.id);
    if (!info.visible) hallazgos.orden.push(`${info.id} (sin caja visible)`);
    else if (previo && !yaVisto && info.y + 1 < previo.y - 40 && info.enHoja !== true) hallazgos.orden.push(`${previo.id} -> ${info.id} (salta hacia arriba)`);
    previo = info;
  }
  return hallazgos;
}

async function revisarHoja(page, disparador) {
  const r = { abierta: false, focoDentro: false, atrapado: true, cierraConEsc: false, devuelveFoco: false };
  const dlg = page.locator('[role="dialog"][aria-modal="true"]').first();
  r.abierta = await dlg.count() > 0;
  if (!r.abierta) return r;
  r.focoDentro = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press(i % 5 === 4 ? 'Shift+Tab' : 'Tab');
    const dentro = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
    if (!dentro) { r.atrapado = false; break; }
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  r.cierraConEsc = (await page.locator('[role="dialog"][aria-modal="true"]').count()) === 0;
  if (disparador) {
    r.devuelveFoco = await disparador.evaluate((el) => document.activeElement === el).catch(() => false);
  }
  return r;
}

// ── pantallas ───────────────────────────────────────────────────────────────
const esperar = (page, ms = 350) => page.waitForTimeout(ms);
const ir = async (page, ruta) => { await page.goto(`${BASE}${ruta}`, { waitUntil: 'domcontentloaded' }); await page.waitForLoadState('networkidle').catch(() => {}); await esperar(page); };
const tocarTecla = async (page, digitos) => { for (const d of digitos) await page.locator('.ds-key', { hasText: new RegExp(`^${d}$`) }).first().click(); };
const boton = (page, nombre) => page.getByRole('button', { name: nombre }).first();

// Cada pantalla: { id, rol, preparar(page, datos) -> { hoja?: Locator } | void }.
// `hoja` = el control que abrió una hoja: se verifica foco atrapado, Esc y retorno de foco.
const PANTALLAS = [
  // Públicas
  { id: 'login', rol: 'publico', preparar: (p) => ir(p, '/login') },
  { id: 'login-error', rol: 'publico', async preparar(p) {
    await ir(p, '/login'); await p.getByLabel('Correo').fill('nadie@a11y.test'); await p.getByLabel('Contraseña', { exact: true }).fill('incorrecta1');
    await boton(p, 'Entrar').click(); await p.locator('.ds-toast--error').waitFor(); await esperar(p);
  } },
  { id: 'registro', rol: 'publico', preparar: (p) => ir(p, `/registro?c=${CODIGO}`) },
  { id: 'registro-conjunto', rol: 'publico', preparar: (p) => ir(p, '/registro') },
  { id: 'registro-error', rol: 'publico', async preparar(p) {
    await ir(p, `/registro?c=${CODIGO}`);
    await p.getByLabel('Nombre completo').fill('Ana Pérez'); await p.getByLabel('Correo').fill('ana@a11y.test');
    await p.getByLabel('Contraseña', { exact: true }).fill('ClaveSegura123'); await p.getByLabel('Teléfono (WhatsApp)').fill('3001112233');
    await p.getByLabel('Apartamento').fill('304'); await p.getByRole('checkbox', { name: /Acepto/ }).check();
    await boton(p, 'Crear cuenta').click(); await p.locator('.ds-toast--error').waitFor(); await esperar(p);
  } },
  { id: 'recuperar', rol: 'publico', preparar: (p) => ir(p, '/recuperar') },
  { id: 'recuperar-enviado', rol: 'publico', async preparar(p) {
    await ir(p, '/recuperar'); await p.getByLabel('Correo').fill('ana@a11y.test'); await boton(p, 'Enviar enlace').click(); await p.getByRole('status').waitFor(); await esperar(p);
  } },
  { id: 'restablecer-sin-token', rol: 'publico', preparar: (p) => ir(p, '/restablecer') },
  { id: 'restablecer', rol: 'publico', preparar: (p) => ir(p, '/restablecer?token=abc') },
  { id: 'terminos', rol: 'publico', preparar: (p) => ir(p, `/terminos?c=${CODIGO}`) },
  { id: 'acceso', rol: 'publico', preparar: (p) => ir(p, '/acceso') },
  { id: 'acceso-enviado', rol: 'publico', async preparar(p) {
    await ir(p, '/acceso'); await p.getByLabel('Correo').fill('ana@a11y.test'); await p.locator('button[type=submit]').click(); await p.getByRole('heading', { name: /correo/i }).waitFor(); await esperar(p);
  } },
  { id: 'acceso-enlace-vencido', rol: 'publico', preparar: (p) => ir(p, '/acceso/tokeninvalido') },
  { id: 'enlace-invalido', rol: 'publico', preparar: (p) => ir(p, '/p/tokeninvalido') },
  { id: 'enlace-sin-token', rol: 'publico', preparar: (p) => ir(p, '/p') },

  // Operador
  { id: 'op-recibir', rol: 'op', preparar: (p) => ir(p, '/op/recibir') },
  { id: 'op-recibir-busqueda', rol: 'op', async preparar(p) { await ir(p, '/op/recibir'); await tocarTecla(p, '304'); await p.locator('.op-sug').first().waitFor(); await esperar(p); } },
  { id: 'op-recibir-sin-resultados', rol: 'op', async preparar(p) { await ir(p, '/op/recibir'); await tocarTecla(p, '999'); await p.locator('.op-vacio').waitFor(); await esperar(p); } },
  { id: 'op-recibir-sin-dueno', rol: 'op', async preparar(p) { await ir(p, '/op/recibir'); await p.locator('.op-link').click(); await esperar(p); } },
  { id: 'op-peso', rol: 'op', async preparar(p) {
    await ir(p, '/op/recibir'); await tocarTecla(p, '304'); await p.locator('.op-sug').first().click(); await p.locator('.op-tile').first().waitFor(); await esperar(p);
  } },
  { id: 'op-peso-guia', rol: 'op', async preparar(p) {
    await ir(p, '/op/recibir'); await tocarTecla(p, '304'); await p.locator('.op-sug').first().click(); await p.locator('.op-tile').first().waitFor();
    const d = p.locator('.op-extra--chica'); await d.click(); await esperar(p, 500); return { hoja: d };
  } },
  { id: 'op-peso-error', rol: 'op', async preparar(p) {
    await ir(p, '/op/recibir'); await tocarTecla(p, '304'); await p.locator('.op-sug').first().click(); await p.locator('.op-tile').first().waitFor();
    await p.route('**/api/packages/recepcion', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'ERROR_INTERNO', message: 'No pudimos guardar el paquete. Intenta de nuevo.' }) }));
    await p.waitForTimeout(600); await p.locator('.op__acciones .ds-btn').click(); await p.locator('.ds-toast--error').waitFor(); await esperar(p);
    await p.unroute('**/api/packages/recepcion');
  } },
  { id: 'op-guardado', rol: 'op', async preparar(p) {
    await ir(p, '/op/recibir'); await tocarTecla(p, '304'); await p.locator('.op-sug').first().click(); await p.locator('.op-tile').first().waitFor();
    await p.waitForTimeout(600); await p.locator('.op__acciones .ds-btn').click(); await p.locator('.op-ok').waitFor(); await esperar(p);
  } },
  { id: 'op-guardado-sin-dueno', rol: 'op', async preparar(p) {
    await ir(p, '/op/recibir'); await p.locator('.op-link').click(); await p.getByLabel('Nombre en la etiqueta').fill('Carlos M.'); await boton(p, 'Continuar').click();
    await p.locator('.op-tile').first().waitFor(); await p.waitForTimeout(600); await p.locator('.op__acciones .ds-btn').click(); await p.locator('.op-ok').waitFor(); await esperar(p);
  } },
  { id: 'op-entregar', rol: 'op', preparar: (p) => ir(p, '/op/entregar') },
  { id: 'op-entregar-error', rol: 'op', async preparar(p) { await ir(p, '/op/entregar'); await tocarTecla(p, '0001'); await p.locator('.ds-toast--error').waitFor(); await esperar(p); } },
  { id: 'op-cobrar', rol: 'op', async preparar(p, d) { await ir(p, '/op/entregar'); await tocarTecla(p, d.pinMarta); await p.locator('.op-total').waitFor(); await esperar(p); } },
  // S3.2: lote de un apartamento con dos personas (aviso, casillas, "Entregar lo marcado").
  { id: 'op-cobrar-varias', rol: 'op', async preparar(p, d) { await ir(p, '/op/entregar'); await tocarTecla(p, d.pinCarlos); await p.locator('.op-sel').first().waitFor(); await esperar(p); } },
  { id: 'op-pendientes', rol: 'op', async preparar(p) { await ir(p, '/op/pendientes'); await p.locator('.op-fila').first().waitFor(); await esperar(p); } },
  { id: 'op-pendientes-sin-resultados', rol: 'op', async preparar(p) { await ir(p, '/op/pendientes'); await p.getByLabel('Buscar').fill('zzzz'); await esperar(p, 600); } },
  { id: 'op-pendientes-detalle', rol: 'op', async preparar(p) {
    await ir(p, '/op/pendientes'); const f = p.locator('button.op-fila').first(); await f.waitFor(); await f.click(); await esperar(p, 500);
    return p.viewportSize().width < 1024 ? { hoja: f } : undefined;
  } },
  // S3.2: "Desactivar dirección" con su confirmación (detalle del apartamento de dos personas).
  { id: 'op-pendientes-desactivar', rol: 'op', async preparar(p) {
    await ir(p, '/op/pendientes'); const f = p.locator('button.op-fila', { hasText: 'Mora' }).first(); await f.waitFor(); await f.click(); await esperar(p, 500);
    await p.getByRole('button', { name: /Desactivar dirección/ }).first().click(); await esperar(p, 400);
    return p.viewportSize().width < 1024 ? { hoja: f } : undefined;
  } },
  { id: 'op-pendientes-fotos', rol: 'op', async preparar(p) {
    await ir(p, '/op/pendientes'); const f = p.locator('button.op-fila').first(); await f.waitFor(); await f.click(); await esperar(p, 400);
    const v = p.getByRole('button', { name: 'Ver fotos' }).first(); if (await v.count()) { await v.click(); await esperar(p, 600); }
  } },
  { id: 'op-pendientes-asignar', rol: 'op', async preparar(p) {
    await ir(p, '/op/pendientes'); const a = p.locator('.op-asignar').first(); await a.waitFor(); await a.click(); await esperar(p, 500); return { hoja: a };
  } },
  { id: 'op-pendientes-error', rol: 'op', async preparar(p) {
    await p.route('**/api/packages**', (r) => (r.request().method() === 'GET' ? r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'ERROR_INTERNO', message: 'No pudimos cargar los paquetes. Revisa tu conexión e intenta de nuevo.' }) }) : r.continue()));
    await ir(p, '/op/pendientes'); await esperar(p, 600);
    await p.unroute('**/api/packages**');
  } },
  { id: 'op-mas', rol: 'op', async preparar(p) { await ir(p, '/op/recibir'); const m = p.locator('.op-mas').first(); const d = (await m.isVisible()) ? m : boton(p, 'Más'); await d.click(); await esperar(p, 500); return { hoja: d }; } },
  { id: 'op-mas-bitacora', rol: 'op', async preparar(p) { await abrirMas(p); await boton(p, 'Bitácora').click(); await esperar(p, 700); } },
  { id: 'op-mas-buzon', rol: 'op', async preparar(p) { await abrirMas(p); await boton(p, 'Abrir buzón').click(); await esperar(p, 700); } },
  { id: 'op-mas-invitar', rol: 'op', async preparar(p) { await abrirMas(p); await boton(p, 'Invitar residentes').click(); await p.locator('.op-qr').waitFor(); await esperar(p, 400); } },
  { id: 'op-mas-salir-confirmar', rol: 'op', opcional: true, async preparar(p) {
    // Solo existe con la corrección de la cola (T4.6): con pendientes, "Salir" pide confirmación.
    await encolarSinSenal(p); await p.locator('.op__acciones a').first().click(); await esperar(p, 400);
    const m = p.locator('.op-mas').first(); await ((await m.isVisible()) ? m : boton(p, 'Más')).click(); await esperar(p, 400);
    await boton(p, /^Salir$/).click(); await esperar(p, 500);
  }, sinSenal: true },
  { id: 'op-cola-guardado-pendiente', rol: 'op', sinSenal: true, async preparar(p) { await encolarSinSenal(p); } },
  { id: 'op-cola-indicador', rol: 'op', sinSenal: true, async preparar(p) { await encolarSinSenal(p); await p.getByRole('link', { name: /Recibir/ }).first().click().catch(() => {}); await esperar(p, 500); } },
  { id: 'op-cola-hoja', rol: 'op', sinSenal: true, async preparar(p) {
    await ir(p, '/op/recibir'); await sembrarAjeno(p); await encolarSinSenal(p); const ind = p.locator('.op-cola__btn'); await ind.waitFor(); await ind.click(); await esperar(p, 600); return { hoja: ind };
  } },

  // Residente
  { id: 'res-mis-paquetes', rol: 'res1', async preparar(p) { await ir(p, '/paquetes'); await p.locator('.res-card').first().waitFor(); await esperar(p); } },
  { id: 'res-mis-paquetes-vacio', rol: 'res2', async preparar(p) { await ir(p, '/paquetes'); await esperar(p, 600); } },
  { id: 'res-mis-paquetes-error', rol: 'res1', async preparar(p) {
    await p.route('**/api/p/paquetes', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'ERROR_INTERNO', message: 'No pudimos cargar tus paquetes.' }) }));
    await ir(p, '/paquetes'); await esperar(p, 600); await p.unroute('**/api/p/paquetes');
  } },
  { id: 'res-mis-paquetes-enlace', rol: 'publico', requiereEnlace: true, async preparar(p, d) { await ir(p, new URL(d.enlace).pathname + new URL(d.enlace).hash); await p.locator('.res-card').first().waitFor(); await esperar(p); } },
  { id: 'res-mas', rol: 'res1', async preparar(p) { await ir(p, '/paquetes'); const m = boton(p, 'Más'); await m.click(); await esperar(p, 500); return { hoja: m }; } },
  { id: 'res-fotos', rol: 'res1', async preparar(p) {
    await ir(p, '/paquetes'); const f = p.getByRole('button', { name: 'Ver fotos del paquete' }).first();
    if (await f.count()) { await f.click(); await esperar(p, 600); return { hoja: f }; }
  } },
  { id: 'res-pedir-entrega', rol: 'res1', async preparar(p) { await ir(p, '/paquetes/entrega'); await p.locator('.res-chip').first().waitFor(); await esperar(p); } },
  { id: 'res-avisar', rol: 'res1', preparar: (p) => ir(p, '/paquetes/avisar') },
  { id: 'res-avisar-cambiar', rol: 'res1', async preparar(p) { await ir(p, '/paquetes/avisar'); const c = boton(p, 'Cambiar'); await c.click(); await esperar(p, 500); return { hoja: c }; } },
  { id: 'res-avisar-otra', rol: 'res1', async preparar(p) { await ir(p, '/paquetes/avisar'); const c = boton(p, 'Cambiar'); await c.click(); await p.getByRole('radio', { name: 'Otra dirección' }).click(); await esperar(p, 500); return { hoja: c }; } },
  { id: 'res-avisar-detalles', rol: 'res1', async preparar(p) { await ir(p, '/paquetes/avisar'); await p.getByRole('button', { name: /Agregar detalles/ }).click(); await p.getByLabel('Es contra entrega').check(); await esperar(p); } },
  { id: 'res-historial', rol: 'res3', async preparar(p) { await ir(p, '/paquetes/historial'); await p.locator('.res-hist').first().waitFor(); await esperar(p); } },
  { id: 'res-historial-vacio', rol: 'res2', async preparar(p) { await ir(p, '/paquetes/historial'); await esperar(p, 600); } },
  { id: 'res-historial-fotos', rol: 'res3', async preparar(p) {
    await ir(p, '/paquetes/historial'); const f = p.getByRole('button', { name: 'Ver fotos del paquete' }).first(); await f.waitFor(); await f.click(); await esperar(p, 600); return { hoja: f };
  } },
  { id: 'res-mis-direcciones', rol: 'res1', async preparar(p) {
    await ir(p, '/paquetes');
    await p.evaluate(async () => { await fetch('/api/domicilios', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` }, body: JSON.stringify({ conjunto: (await (await fetch('/api/conjuntos')).json())[0].slug, torre: '2', apto: '808', nombreRecibe: 'Amigo A11y', telefono: '3005550000' }) }); });
    await ir(p, '/paquetes'); const m = boton(p, 'Más'); await m.click(); await boton(p, 'Mis direcciones').click(); await esperar(p, 500); return { hoja: m };
  } },
  { id: 'res-buzon', rol: 'res1', async preparar(p) { await ir(p, '/paquetes/buzon'); await esperar(p, 500); } },
];

async function abrirMas(p) {
  await ir(p, '/op/recibir');
  const m = p.locator('.op-mas').first();
  await ((await m.isVisible()) ? m : boton(p, 'Más')).click();
  await esperar(p, 400);
}

// Recepción hecha sin señal: queda en la cola de IndexedDB y se ve "Guardado en el teléfono".
async function encolarSinSenal(p) {
  await ir(p, '/op/recibir'); await tocarTecla(p, '304'); await p.locator('.op-sug').first().click(); await p.locator('.op-tile').first().waitFor();
  await p.context().setOffline(true); await p.waitForTimeout(500);
  await p.locator('.op__acciones .ds-btn').click(); await p.locator('.op-ok').waitFor(); await esperar(p);
}

// Un pendiente que pertenece a otro operador (otra sesión del mismo dispositivo).
async function sembrarAjeno(p) {
  await p.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('puertaya-offline', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('recepciones', { keyPath: 'claveIdempotencia' });
    req.onsuccess = () => {
      const tx = req.result.transaction('recepciones', 'readwrite');
      tx.objectStore('recepciones').put({
        claveIdempotencia: 'ajeno-a11y', body: { residenteId: null, categoriaPeso: 'MANO', etiquetaNombre: 'Pedro R.' },
        resumen: { residenteId: null, nombre: null, etiquetaApto: null, etiquetaNombre: 'Pedro R.', categoriaPeso: 'MANO' },
        creadoEn: Date.now(), seq: 99, intentos: 0, ultimoError: null, estado: 'pendiente', proximoIntento: 0,
        operadorId: 'otro-operador', operadorNombre: 'Camila Torres',
      });
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  }));
  // La lista en pantalla se refresca cuando la cola guarda el siguiente registro (encolarSinSenal).
}

// ── ejecución ───────────────────────────────────────────────────────────────
async function main() {
  const datos = await sembrar();
  // Mismo criterio que playwright.config.mjs: Chromium preinstalado si el del paquete no está.
  const ruta = process.env.PW_CHROMIUM_PATH || (fs.existsSync(chromium.executablePath()) ? undefined : '/opt/pw-browsers/chromium');
  const navegador = await chromium.launch({ executablePath: ruta });
  const filas = [];
  const titulos = new Map();
  const ctxCache = new Map();

  async function contexto(v, rol, sinSenal) {
    const clave = `${v.id}|${rol}|${sinSenal ? 'cola' : ''}`;
    if (!sinSenal && ctxCache.has(clave)) return ctxCache.get(clave);
    const ctx = await navegador.newContext({
      viewport: { width: v.ancho, height: v.alto },
      reducedMotion: v.reducir ? 'reduce' : 'no-preference',
      serviceWorkers: 'block',
      locale: 'es-CO',
    });
    const token = rol === 'op' ? datos.op.token : datos.residentes[rol]?.token;
    await ctx.addInitScript(({ tema, token: t }) => {
      try { localStorage.setItem('puertaya-tema', tema); } catch { /* ignorar */ }
      try { if (t && !sessionStorage.getItem('__a11y_sesion_cerrada')) localStorage.setItem('token', t); } catch { /* ignorar */ }
    }, { tema: v.tema, token });
    // Las fuentes de Google no son parte de la auditoría y retrasan la carga sin red abierta.
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    if (!sinSenal) ctxCache.set(clave, ctx);
    return ctx;
  }

  for (const v of VARIANTES) {
    for (const def of PANTALLAS) {
      if (SOLO && !def.id.includes(SOLO)) continue;
      if (def.requiereEnlace && !datos.enlace) { filas.push({ id: def.id, variante: v.id, omitida: 'sin enlace de WhatsApp en la siembra' }); continue; }
      const ctx = await contexto(v, def.rol, def.sinSenal);
      let page; try { page = await ctx.newPage(); } catch (e) { console.error('newPage falló en', def.id, v.id, def.rol, ctxCache.size); throw e; }
      const fila = { id: def.id, variante: v.id, axe: [], axeInfo: [], manual: [], avisos: [] };
      try {
        const extra = await def.preparar(page, datos);
        await esperar(page, 250);
        if (CAPTURAS) await page.screenshot({ path: path.join(SALIDA, `${PREFIJO}${def.id}-${v.id}.png`) });

        if (v.reducir) {
          const anim = await page.evaluate(animacionesActivas);
          if (anim.length) fila.manual.push(`movimiento con reduced-motion: ${anim.join('; ')}`);
        } else {
          const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
          for (const x of r.violations) {
            const e = { regla: x.id, impacto: x.impact, nodos: x.nodes.length, ejemplo: x.nodes[0]?.target?.join(' '), resumen: x.nodes[0]?.failureSummary?.split('\n')[1]?.trim() };
            (['serious', 'critical'].includes(x.impact) ? fila.axe : fila.axeInfo).push(e);
          }
          const rev = await page.evaluate(revisarEnPagina, { ancho: v.ancho });
          if (rev.pequenos.length) fila.manual.push(`controles < 48 px: ${rev.pequenos.map((x) => `${x.el} "${x.nombre}" ${x.w}x${x.h}`).join(' | ')}`);
          if (rev.sinNombre.length) fila.manual.push(`botón o enlace sin nombre: ${rev.sinNombre.map((x) => x.el).join(', ')}`);
          if (rev.textosChicos.length) fila.manual.push(`texto < 16 px: ${rev.textosChicos.map((x) => `${x.el} ${x.px}px "${x.texto}"`).join(' | ')}`);
          if (rev.scrollHorizontal) fila.manual.push('scroll horizontal a 390 px');
          if (rev.lang !== 'es') fila.manual.push(`lang="${rev.lang}"`);
          if (!rev.titulo || /Ipanema/i.test(rev.titulo)) fila.manual.push(`título de página genérico o con nombre fijo: "${rev.titulo}"`);
          if (rev.h1 !== 1) fila.avisos.push(`h1: ${rev.h1}`);
          if (v.id === '390-dia') titulos.set(def.id, rev.titulo);

          const foco = await recorrerTab(page);
          if (foco.sinAnillo.length) fila.manual.push(`foco sin anillo visible: ${[...new Set(foco.sinAnillo)].join(', ')}`);
          if (foco.fueraDeHoja.length) fila.manual.push(`foco fuera de la hoja: ${foco.fueraDeHoja.join(', ')}`);
          if (foco.orden.length) fila.avisos.push(`orden de foco a revisar: ${foco.orden.slice(0, 3).join(' ; ')}`);
          fila.tabs = foco.pasos;

          if (extra?.hoja || (await page.locator('[role="dialog"][aria-modal="true"]').count())) {
            const h = await revisarHoja(page, extra?.hoja);
            if (h.abierta && !(h.focoDentro && h.atrapado && h.cierraConEsc)) fila.manual.push(`hoja: foco dentro=${h.focoDentro} atrapado=${h.atrapado} Esc cierra=${h.cierraConEsc}`);
            if (h.abierta && extra?.hoja && !h.devuelveFoco) fila.manual.push('hoja: el foco no vuelve al control que la abrió');
            fila.hoja = h;
          }
        }
      } catch (e) {
        fila.manual.push(`no se pudo preparar la pantalla: ${String(e.message).split('\n')[0]}`);
        if (def.opcional) { fila.manual.pop(); fila.omitida = 'pantalla opcional no disponible'; }
      }
      filas.push(fila);
      await page.close();
      if (def.sinSenal) await page.context().close();
    }
  }
  for (const c of ctxCache.values()) await c.close();
  await navegador.close();

  // Títulos: únicos por pantalla (las variantes de una misma pantalla pueden compartir).
  const porTitulo = new Map();
  for (const [id, t] of titulos) porTitulo.set(t, [...(porTitulo.get(t) ?? []), id]);
  const titulosRepetidos = [...porTitulo].filter(([, ids]) => ids.length > 1);

  const contraste = contrasteDeTokens();

  // Informe
  let serias = 0; let manuales = 0;
  console.log('\nPantalla'.padEnd(34) + 'variante'.padEnd(20) + 'axe serias/críticas  manuales');
  for (const f of filas) {
    if (f.omitida) { console.log(`${f.id.padEnd(33)} ${f.variante.padEnd(19)} omitida (${f.omitida})`); continue; }
    serias += f.axe.length; manuales += f.manual.length;
    console.log(`${f.id.padEnd(33)} ${f.variante.padEnd(19)} ${String(f.axe.length).padStart(3)}                  ${f.manual.length}`);
    for (const e of f.axe) console.log(`     axe ${e.impacto} ${e.regla} (${e.nodos}) ${e.ejemplo}: ${e.resumen ?? ''}`);
    for (const m of f.manual) console.log(`     manual: ${m}`);
  }
  console.log('\nInformativas (axe moderate/minor y avisos):');
  const vistas = new Set();
  for (const f of filas) {
    for (const e of f.axeInfo ?? []) { const k = `${e.regla}|${f.id}`; if (!vistas.has(k)) { vistas.add(k); console.log(`  ${f.id}: ${e.impacto} ${e.regla} (${e.nodos}) ${e.ejemplo}`); } }
    for (const a of f.avisos ?? []) { const k = `${a}|${f.id}`; if (!vistas.has(k)) { vistas.add(k); console.log(`  ${f.id}: ${a}`); } }
  }
  console.log('\nContraste de tokens (texto >= 4,5; controles >= 3):');
  for (const c of contraste) console.log(`  ${c.ok ? 'ok ' : 'FALLA'} ${c.tema.padEnd(6)} ${c.par.padEnd(22)} ${c.valor.toFixed(2)} (mín. ${c.minimo})`);
  const falloContraste = contraste.filter((c) => !c.ok).length;
  if (titulosRepetidos.length) console.log('\nTítulos repetidos entre pantallas distintas:', titulosRepetidos.map(([t, ids]) => `"${t}": ${ids.join(', ')}`).join(' | '));

  fs.writeFileSync(path.join(SALIDA, 'resultados.json'), JSON.stringify({ filas, contraste, titulos: Object.fromEntries(titulos) }, null, 2));
  console.log(`\nTotales: axe serias/críticas = ${serias}; fallos manuales = ${manuales}; contraste de tokens fuera de rango = ${falloContraste}; títulos compartidos por varios estados de una pantalla = ${titulosRepetidos.length} (informativo)`);
  process.exit(serias + manuales + falloContraste > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
