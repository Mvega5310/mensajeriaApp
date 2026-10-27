import { useCallback, useSyncExternalStore } from 'react';

// Tema 'dia' | 'noche'. Sin preferencia guardada sigue a prefers-color-scheme;
// el usuario puede forzarlo y se guarda por dispositivo (localStorage).
// El estado vive a nivel de módulo: todos los componentes que usan el hook
// ven el mismo valor. Aplica data-tema en <html>.
const CLAVE = 'puertaya-tema';
const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const oyentes = new Set();

function leerForzado() {
  try {
    const v = localStorage.getItem(CLAVE);
    return v === 'dia' || v === 'noche' ? v : null;
  } catch {
    return null;
  }
}

let forzado = leerForzado();

function resolver() {
  return forzado ?? (mq?.matches ? 'noche' : 'dia');
}

function aplicar() {
  const t = resolver();
  const el = document.documentElement;
  el.setAttribute('data-tema', t);
}

function avisar() {
  aplicar();
  oyentes.forEach((fn) => fn());
}

mq?.addEventListener?.('change', () => {
  if (forzado === null) avisar();
});

function suscribir(fn) {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

function fijar(t) {
  forzado = t === 'dia' || t === 'noche' ? t : null;
  try {
    if (forzado) localStorage.setItem(CLAVE, forzado);
    else localStorage.removeItem(CLAVE);
  } catch {
    /* sin almacenamiento: el tema vale solo en esta sesión */
  }
  avisar();
}

if (typeof document !== 'undefined') aplicar();

/** → { tema, forzado, setTema(t | null), alternar() }. setTema(null) vuelve a seguir al teléfono. */
export default function useTheme() {
  const tema = useSyncExternalStore(suscribir, resolver, () => 'dia');
  const alternar = useCallback(() => fijar(resolver() === 'noche' ? 'dia' : 'noche'), []);
  return { tema, forzado: forzado !== null, setTema: fijar, alternar };
}
