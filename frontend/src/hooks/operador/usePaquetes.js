import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api.js';

// Listado de paquetes ABIERTOS del operador (sin fotos ni PIN). Pide solo los estados
// abiertos: así el servidor no lee toda la historia (revisión final T8.1, A1). El
// historial va por la bitácora (paginada) y el CSV. Cache de módulo de 20 s para
// que cambiar de pantalla no vuelva a pedirlo; `refrescar()` fuerza la lectura.
let cache = { datos: null, en: 0 };
const VIGENCIA_MS = 20000;
export const ESTADOS_ABIERTOS = ['EN_RECEPCION', 'PROGRAMADO', 'SIN_ASIGNAR', 'PREALERTADO'];

export function invalidarPaquetes() {
  cache = { datos: null, en: 0 };
}


export default function usePaquetes() {
  const [paquetes, setPaquetes] = useState(cache.datos ?? []);
  const [cargando, setCargando] = useState(!cache.datos);
  const [error, setError] = useState('');

  const refrescar = useCallback(async () => {
    try {
      const lista = await api(`/packages?estado=${ESTADOS_ABIERTOS.join(',')}`);
      cache = { datos: lista, en: Date.now() };
      setPaquetes(lista);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (!cache.datos || Date.now() - cache.en > VIGENCIA_MS) refrescar();
  }, [refrescar]);

  const porEntregar = paquetes.filter((p) => p.estado === 'EN_RECEPCION' || p.estado === 'PROGRAMADO');
  const sinAsignar = paquetes.filter((p) => p.estado === 'SIN_ASIGNAR');
  const prealertados = paquetes.filter((p) => p.estado === 'PREALERTADO');

  return { paquetes, porEntregar, sinAsignar, prealertados, cargando, error, refrescar };
}
