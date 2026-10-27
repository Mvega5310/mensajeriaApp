// Cola persistente de recepciones del operador (T4.5): IndexedDB nativo con
// respaldo en memoria si el navegador no lo permite (modo privado, cuota).
// La lógica (orden, backoff, clasificación, límites) vive en colaPura.js.
import { useSyncExternalStore } from 'react';
import { api } from '../services/api.js';
import { invalidarPaquetes } from '../hooks/operador/usePaquetes.js';
import { usuarioId, usuarioNombre } from '../services/auth.js';
import { almacenMemoria, clasificarError, crearCola, nuevaClave, separarPorOperador } from './colaPura.js';

export { nuevaClave };

const DB = 'puertaya-offline';
const STORE = 'recepciones';
const TIMEOUT_MS = 30_000;
const TICK_MS = 30_000;

function almacenIndexedDB() {
  let dbp;
  const abrir = () => {
    dbp ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'claveIdempotencia' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  };
  const tx = async (modo, fn) => {
    const db = await abrir();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, modo);
      const r = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(r?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };
  return {
    persistente: true,
    todos: () => tx('readonly', (s) => s.getAll()),
    guardar: (el) => tx('readwrite', (s) => s.put(el)),
    borrar: (clave) => tx('readwrite', (s) => s.delete(clave)),
  };
}

// Prueba real de escritura: en algunos navegadores indexedDB existe pero falla al usarse.
async function elegirAlmacen() {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('sin IndexedDB');
    const a = almacenIndexedDB();
    await a.guardar({ claveIdempotencia: '__prueba__' });
    await a.borrar('__prueba__');
    return a;
  } catch {
    return almacenMemoria();
  }
}

// ── estado observable ────────────────────────────────────────────────────────
let snapshot = { items: [], enviando: false, sinSenal: false, persistente: true, listo: false };
const oyentes = new Set();
const enviados = new Map(); // claveIdempotencia -> respuesta real (para Guardado abierto)
let cola = null;
let iniciando = null;
let procesando = null;

function emitir(parcial) {
  snapshot = { ...snapshot, ...parcial };
  oyentes.forEach((f) => f());
}

async function refrescar() {
  emitir({ items: cola ? await cola.listar() : [] });
}

async function iniciar() {
  iniciando ??= (async () => {
    const almacen = await elegirAlmacen();
    cola = crearCola({
      almacen,
      enviar: (el) => api('/packages/recepcion', {
        method: 'POST',
        body: el.body,
        headers: { 'Idempotency-Key': el.claveIdempotencia },
        sinCierreDeSesion: true,
        timeoutMs: TIMEOUT_MS,
      }),
      operadorActual: usuarioId,
      onEnviado: (el, resp) => { enviados.set(el.claveIdempotencia, resp); invalidarPaquetes(); },
    });
    emitir({ persistente: almacen.persistente, listo: true });
    await refrescar();
    window.addEventListener('online', () => enviarPendientes({ forzar: true }));
    window.addEventListener('offline', () => emitir({ sinSenal: true }));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') enviarPendientes({ forzar: true });
    });
    setInterval(() => enviarPendientes(), TICK_MS);
    if (!navigator.onLine) emitir({ sinSenal: true });
    enviarPendientes({ forzar: true });
  })();
  return iniciando;
}

/** Envía en orden lo pendiente. Una sola pasada a la vez; `forzar` ignora el backoff. */
export function enviarPendientes({ forzar = false } = {}) {
  if (!cola) return Promise.resolve(null);
  if (procesando) return procesando;
  procesando = (async () => {
    try {
      const hay = (await cola.listar()).some((x) => x.estado === 'pendiente');
      if (!hay) return null;
      emitir({ enviando: true });
      const r = await cola.procesar({ forzar });
      emitir({ sinSenal: r.detenido === 'red' });
      return r;
    } finally {
      emitir({ enviando: false });
      await refrescar();
      procesando = null;
    }
  })();
  return procesando;
}

/**
 * Guarda una recepción: la envía y, si no hay red (o expira), la deja en cola.
 * Devuelve { enviado: true, resultado } o { enviado: false, clave }. Un 4xx/5xx del
 * servidor NO se encola aquí: se lanza para que la pantalla muestre el mensaje.
 */
export async function guardarRecepcion({ claveIdempotencia, body, resumen }) {
  await iniciar();
  const encolar = async () => {
    await cola.encolar({ claveIdempotencia, body, resumen, operadorId: usuarioId(), operadorNombre: usuarioNombre() });
    await refrescar();
    return { enviado: false, clave: claveIdempotencia };
  };
  if (!navigator.onLine) return encolar();
  try {
    const resultado = await api('/packages/recepcion', {
      method: 'POST', body, headers: { 'Idempotency-Key': claveIdempotencia }, timeoutMs: TIMEOUT_MS,
    });
    return { enviado: true, resultado };
  } catch (e) {
    if (clasificarError(e) === 'red') return encolar(); // misma clave: un reenvío no duplica
    throw e;
  }
}

export const reintentarFallido = async (clave) => { await cola.reintentar(clave); await refrescar(); return enviarPendientes({ forzar: true }); };
export const descartar = async (clave) => { await cola.descartar(clave); await refrescar(); };
export const respuestaEnviada = (clave) => enviados.get(clave) ?? null;

function suscribir(f) {
  oyentes.add(f);
  iniciar();
  return () => oyentes.delete(f);
}

/** Estado de la cola: { items, pendientes, fallidos, ajenos, enviando, sinSenal, persistente, listo }.
 *  `pendientes` y `fallidos` son solo del operador en sesión; `ajenos` son de otra sesión y nunca se envían. */
export function useCola() {
  const s = useSyncExternalStore(suscribir, () => snapshot);
  const { propios, ajenos } = separarPorOperador(s.items, usuarioId());
  return {
    ...s,
    pendientes: propios.filter((x) => x.estado === 'pendiente'),
    fallidos: propios.filter((x) => x.estado === 'fallido'),
    ajenos,
  };
}
