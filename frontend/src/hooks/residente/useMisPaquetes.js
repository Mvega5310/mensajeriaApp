import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../services/api.js';
import { getDomicilios } from '../../services/conjunto.js';
import { cabecerasDeSesion, limpiarSesionEnlace, modoDeSesion, tomarPrimeraVista } from './sesionEnlace.js';

const POLL_MS = 20000;

// Une las vistas de cada conjunto en una sola ("Mis paquetes" de la persona, S2.3).
function unir(vistas) {
  const paquetes = vistas.flatMap((v) => v.paquetes.map((p) => ({ ...p, conjunto: { slug: v.slug, nombre: v.nombre } })));
  const primera = vistas[0];
  return { ...primera, paquetes, vistas };
}

/** Vista "Mis paquetes" (GET /p/paquetes): sirve con la sesión normal o con la del enlace.
 *  Con sesión normal y direcciones en más de un conjunto, junta los paquetes de todos
 *  (una llamada `?conjunto=<slug>` por conjunto); cada paquete trae `conjunto:{slug,nombre}`.
 *  `datos.vistas`: [{slug, nombre, residente, franjasEntrega, metodosPago, paquetes}] (una por conjunto).
 *  `variosConjuntos`: la persona tiene paquetes o direcciones en más de un conjunto.
 *  estado: 'cargando' | 'listo' | 'error' | 'vencido' (la sesión del enlace ya no sirve). */
export default function useMisPaquetes() {
  const [modo] = useState(modoDeSesion);
  const [datos, setDatos] = useState(() => {
    if (modoDeSesion() !== 'enlace') return null;
    const v = tomarPrimeraVista();
    if (!v) return null;
    const vista = { ...v, slug: null, nombre: v.conjunto?.nombre };
    return { ...v, paquetes: v.paquetes.map((p) => ({ ...p, conjunto: { slug: null, nombre: vista.nombre } })), vistas: [vista] };
  });
  const [estado, setEstado] = useState(datos ? 'listo' : 'cargando');
  const [error, setError] = useState('');
  const slugs = useRef(null);

  const recargar = useCallback(async () => {
    try {
      const opts = { headers: cabecerasDeSesion(modo), sinCierreDeSesion: modo === 'enlace' };
      let r;
      if (modo === 'normal') {
        if (slugs.current === null) {
          const dirs = await getDomicilios().catch(() => []);
          slugs.current = [...new Map((dirs ?? []).filter((d) => d.conjunto?.slug).map((d) => [d.conjunto.slug, d.conjunto])).values()];
        }
        if (slugs.current.length > 1) {
          const vistas = await Promise.all(slugs.current.map(async (c) => {
            const v = await api(`/p/paquetes?conjunto=${encodeURIComponent(c.slug)}`, opts).catch((e) => {
              if (e.status === 404) return null; // sin direcciones activas ahí
              throw e;
            });
            return v && { ...v, slug: c.slug, nombre: c.nombre };
          }));
          r = unir(vistas.filter(Boolean));
        }
      }
      if (!r) {
        const v = await api('/p/paquetes', opts);
        const c = slugs.current?.length === 1 ? slugs.current[0] : null;
        const vista = { ...v, slug: c?.slug ?? null, nombre: v.conjunto?.nombre };
        r = { ...v, paquetes: v.paquetes.map((p) => ({ ...p, conjunto: { slug: vista.slug, nombre: vista.nombre } })), vistas: [vista] };
      }
      setDatos(r);
      setEstado('listo');
      setError('');
    } catch (e) {
      if (modo === 'enlace' && e.status === 401) {
        limpiarSesionEnlace();
        setEstado('vencido');
      } else {
        setError(e.message);
        setEstado((s) => (s === 'listo' ? s : 'error'));
      }
    }
  }, [modo]);

  useEffect(() => {
    recargar();
    // El operador cambia el estado desde otro teléfono: se revisa seguido, solo con la pestaña visible.
    const t = setInterval(() => { if (document.visibilityState === 'visible') recargar(); }, POLL_MS);
    const alVolver = () => { if (document.visibilityState === 'visible') recargar(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', alVolver); };
  }, [recargar]);

  const variosConjuntos = (slugs.current?.length ?? 0) > 1 || new Set((datos?.paquetes ?? []).map((p) => p.conjunto?.nombre)).size > 1;
  return { modo, datos, estado, error, recargar, variosConjuntos };
}
