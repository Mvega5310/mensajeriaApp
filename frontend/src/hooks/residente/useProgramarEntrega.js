import { useState } from 'react';
import { api } from '../../services/api.js';
import { cabecerasDeSesion } from './sesionEnlace.js';

/** Programa franja y método de pago en cada paquete (una llamada por paquete).
 *  programar() devuelve { fallidos: ids que no se pudieron programar, mensaje: del primer error }. */
export default function useProgramarEntrega(modo) {
  const [enviando, setEnviando] = useState(false);

  async function programar(ids, franjaHoraria, metodoPagoServicio) {
    setEnviando(true);
    const headers = cabecerasDeSesion(modo);
    const resultados = await Promise.allSettled(ids.map((id) => api(`/packages/${id}/schedule`, {
      method: 'PATCH', body: { franjaHoraria, metodoPagoServicio }, headers, sinCierreDeSesion: modo === 'enlace',
    })));
    setEnviando(false);
    const fallidos = ids.filter((_, i) => resultados[i].status === 'rejected');
    const primero = resultados.find((r) => r.status === 'rejected');
    return { fallidos, mensaje: primero?.reason?.message ?? '' };
  }

  return { programar, enviando };
}
