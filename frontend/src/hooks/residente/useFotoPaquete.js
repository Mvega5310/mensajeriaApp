import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';
import { cabecerasDeSesion } from './sesionEnlace.js';

/** Fotos de un paquete (GET /packages/:id/foto; URLs firmadas que caducan, no se cachean).
 *  Devuelve [] mientras carga o si no hay. Los listados no las traen a propósito. */
export default function useFotoPaquete(id, modo, activo = true) {
  const [urls, setUrls] = useState([]);
  useEffect(() => {
    if (!id || !activo) return undefined;
    let vigente = true;
    api(`/packages/${id}/foto`, { headers: cabecerasDeSesion(modo), sinCierreDeSesion: true })
      .then((r) => vigente && setUrls((r.fotos ?? []).map((f) => f.url)))
      .catch(() => {});
    return () => { vigente = false; };
  }, [id, modo, activo]);
  return urls;
}
