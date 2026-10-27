// Lógica pura de la cola de recepciones sin señal (T4.5). No toca IndexedDB,
// red ni DOM: el almacenamiento y el envío se inyectan, así se prueba con
// `node --test` (ver colaPura.test.js).
//
// Elemento: { claveIdempotencia, body, creadoEn, seq, intentos, ultimoError,
//             estado: 'pendiente' | 'fallido', proximoIntento, resumen }

export const LIMITE_ELEMENTOS = 50;
export const LIMITE_BYTES = 40 * 1024 * 1024;
export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_MAX_MS = 5 * 60_000;

/** 'red' (sin conexión/timeout) | 'cliente' (4xx, no se reintenta) | 'servidor' (5xx y afines, se reintenta). */
export function clasificarError(e) {
  const s = e?.status;
  if (!s) return 'red';
  // 401/408/429 son transitorios: la sesión se renueva o el servidor pide esperar.
  if (s === 401 || s === 408 || s === 429) return 'servidor';
  if (s >= 400 && s < 500) return 'cliente';
  return 'servidor';
}

/** Espera tras `intentos` fallos: 30 s, 60 s, 120 s, ... con tope de 5 min. */
export function backoffMs(intentos) {
  const n = Math.max(1, intentos);
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (n - 1));
}

export function tamanoBody(body) {
  try { return JSON.stringify(body).length; } catch { return 0; }
}

export function nuevaClave() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class ColaLlena extends Error {
  constructor(msg) { super(msg); this.name = 'ColaLlena'; this.code = 'COLA_LLENA'; }
}

/** Almacenamiento en memoria con la misma interfaz que el de IndexedDB: { todos, guardar, borrar }. */
export function almacenMemoria() {
  const m = new Map();
  return {
    persistente: false,
    async todos() { return [...m.values()].map((x) => structuredClone(x)); },
    async guardar(el) { m.set(el.claveIdempotencia, structuredClone(el)); },
    async borrar(clave) { m.delete(clave); },
  };
}

/**
 * Cola con almacén y reloj inyectables.
 * enviar(el) debe resolver con la respuesta (cualquier 2xx, replay incluido) o lanzar
 * un error con `status` (HTTP) o sin él (red).
 */
export function crearCola({ almacen, enviar, ahora = () => Date.now(), onEnviado = () => {} }) {
  let secuencia = 0;

  const ordenar = (lista) => lista.sort((a, b) => a.creadoEn - b.creadoEn || (a.seq ?? 0) - (b.seq ?? 0));

  async function listar() { return ordenar(await almacen.todos()); }

  async function encolar({ claveIdempotencia, body, resumen = null }) {
    const lista = await listar();
    if (lista.length >= LIMITE_ELEMENTOS) {
      throw new ColaLlena(`Ya hay ${LIMITE_ELEMENTOS} registros sin enviar. Conéctate para enviarlos antes de guardar más.`);
    }
    const bytes = lista.reduce((t, x) => t + tamanoBody(x.body), 0) + tamanoBody(body);
    if (bytes > LIMITE_BYTES) {
      throw new ColaLlena('Hay demasiadas fotos sin enviar. Conéctate para enviarlas antes de guardar más.');
    }
    const el = {
      claveIdempotencia, body, resumen, creadoEn: ahora(), seq: ++secuencia,
      intentos: 0, ultimoError: null, estado: 'pendiente', proximoIntento: 0,
    };
    await almacen.guardar(el);
    return el;
  }

  /**
   * Envía en orden los pendientes. `forzar` ignora el backoff (evento online / botón reintentar).
   * Si falla por red/5xx se detiene (conserva el orden); un 4xx pasa a 'fallido' y sigue con el siguiente.
   * Devuelve { enviados, fallidos, detenido }.
   */
  async function procesar({ forzar = false } = {}) {
    const res = { enviados: 0, fallidos: 0, detenido: null };
    for (const el of await listar()) {
      if (el.estado !== 'pendiente') continue;
      if (!forzar && el.proximoIntento > ahora()) { res.detenido = 'espera'; break; }
      try {
        const resp = await enviar(el);
        await almacen.borrar(el.claveIdempotencia);
        res.enviados += 1;
        onEnviado(el, resp);
      } catch (e) {
        const tipo = clasificarError(e);
        el.intentos += 1;
        el.ultimoError = e?.message || 'No se pudo enviar';
        if (tipo === 'cliente') {
          el.estado = 'fallido';
          await almacen.guardar(el);
          res.fallidos += 1;
          continue;
        }
        el.proximoIntento = ahora() + backoffMs(el.intentos);
        await almacen.guardar(el);
        res.detenido = tipo;
        break;
      }
    }
    return res;
  }

  /** Un fallido vuelve a pendiente con la MISMA clave. */
  async function reintentar(clave) {
    const el = (await almacen.todos()).find((x) => x.claveIdempotencia === clave);
    if (!el) return;
    el.estado = 'pendiente'; el.proximoIntento = 0;
    await almacen.guardar(el);
  }

  async function descartar(clave) { await almacen.borrar(clave); }

  return { listar, encolar, procesar, reintentar, descartar };
}
