import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api.js';
import { cabecerasDeSesion, limpiarSesionEnlace, modoDeSesion, tomarPrimeraVista } from './sesionEnlace.js';

const POLL_MS = 20000;

/** Vista "Mis paquetes" (GET /p/paquetes): sirve con la sesión normal o con la del enlace.
 *  estado: 'cargando' | 'listo' | 'error' | 'vencido' (la sesión del enlace ya no sirve). */
export default function useMisPaquetes() {
  const [modo] = useState(modoDeSesion);
  const [datos, setDatos] = useState(() => (modo === 'enlace' ? tomarPrimeraVista() : null));
  const [estado, setEstado] = useState(datos ? 'listo' : 'cargando');
  const [error, setError] = useState('');

  const recargar = useCallback(async () => {
    try {
      const r = await api('/p/paquetes', { headers: cabecerasDeSesion(modo), sinCierreDeSesion: modo === 'enlace' });
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

  return { modo, datos, estado, error, recargar };
}
