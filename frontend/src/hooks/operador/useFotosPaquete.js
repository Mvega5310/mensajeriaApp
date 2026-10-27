import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';
import { fotoUrlDeRespuesta } from '../../utils/fotos.js';

/** Fotos de un paquete, pedidas aparte al abrir el detalle (URLs firmadas de 10 min: no se cachean). */
export default function useFotosPaquete(id, activo) {
  const [fotoUrl, setFotoUrl] = useState(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!activo || !id) return undefined;
    let vigente = true;
    setCargando(true);
    setFotoUrl(null);
    api(`/packages/${id}/foto`)
      .then((r) => vigente && setFotoUrl(fotoUrlDeRespuesta(r)))
      .catch(() => {})
      .finally(() => vigente && setCargando(false));
    return () => { vigente = false; };
  }, [id, activo]);

  return { fotoUrl, cargando };
}
