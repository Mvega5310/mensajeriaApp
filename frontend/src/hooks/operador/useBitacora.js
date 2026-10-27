import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';

export const POR_PAGINA = 20;

/** Bitácora paginada: GET /packages?pagina=&desde=&hasta=&estado=&q=. */
export default function useBitacora({ desde, hasta, estado, q }) {
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState({ items: [], total: 0 });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  // Un filtro nuevo vuelve a la primera página.
  useEffect(() => { setPagina(1); }, [desde, hasta, estado, q]);

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ pagina, porPagina: POR_PAGINA });
      if (desde) qs.set('desde', desde);
      if (hasta) qs.set('hasta', hasta);
      if (estado) qs.set('estado', estado);
      if (q.trim()) qs.set('q', q.trim());
      api(`/packages?${qs}`)
        .then((r) => vigente && (setDatos(r), setError('')))
        .catch((e) => vigente && setError(e.message))
        .finally(() => vigente && setCargando(false));
    }, 250);
    return () => { vigente = false; clearTimeout(t); };
  }, [pagina, desde, hasta, estado, q]);

  const paginas = Math.max(1, Math.ceil(datos.total / POR_PAGINA));
  return { ...datos, pagina, paginas, setPagina, cargando, error };
}
