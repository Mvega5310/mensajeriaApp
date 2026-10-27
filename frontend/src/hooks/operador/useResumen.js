import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api.js';

/** Contadores livianos de Recibir (GET /packages/resumen): sin traer el listado. */
export default function useResumen() {
  const [resumen, setResumen] = useState(null);
  const refrescar = useCallback(() => {
    api('/packages/resumen').then(setResumen).catch(() => setResumen(null));
  }, []);
  useEffect(() => { refrescar(); }, [refrescar]);
  return { resumen, refrescar };
}
