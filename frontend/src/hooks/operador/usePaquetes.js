import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api.js';

// Listado de paquetes del operador (sin fotos ni PIN). Cache de módulo de 20 s para
// que cambiar de pantalla no vuelva a pedirlo; `refrescar()` fuerza la lectura.
let cache = { datos: null, en: 0 };
const VIGENCIA_MS = 20000;

export function invalidarPaquetes() {
  cache = { datos: null, en: 0 };
}

function esHoy(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  const h = new Date();
  return d.getFullYear() === h.getFullYear() && d.getMonth() === h.getMonth() && d.getDate() === h.getDate();
}

export default function usePaquetes() {
  const [paquetes, setPaquetes] = useState(cache.datos ?? []);
  const [cargando, setCargando] = useState(!cache.datos);
  const [error, setError] = useState('');

  const refrescar = useCallback(async () => {
    try {
      const lista = await api('/packages');
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
  const recibidosHoy = paquetes.filter((p) => p.estado !== 'PREALERTADO' && esHoy(p.recibidoEn ?? p.fechaIngreso)).length;

  return { paquetes, porEntregar, sinAsignar, prealertados, recibidosHoy, cargando, error, refrescar };
}
