import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api.js';
import { getConjuntos, getDomicilios } from '../../services/conjunto.js';

/** Direcciones guardadas de la persona (GET /domicilios, la última usada primero) y, si se pide,
 *  los conjuntos activos para el selector. Solo con sesión normal (`activo`).
 *  `conjuntosDePersona`: slugs distintos de sus direcciones. `agregar(datos)` guarda una dirección
 *  nueva (POST /domicilios), la deja primera y devuelve su id. */
export default function useDirecciones(activo = true, { conConjuntos = false } = {}) {
  const [direcciones, setDirecciones] = useState([]);
  const [conjuntos, setConjuntos] = useState([]);
  const [cargando, setCargando] = useState(activo);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!activo) return undefined;
    let vigente = true;
    setCargando(true);
    Promise.all([getDomicilios(), conConjuntos ? getConjuntos() : Promise.resolve([])])
      .then(([d, c]) => {
        if (!vigente) return;
        setDirecciones(Array.isArray(d) ? d : []);
        setConjuntos(Array.isArray(c) ? c : []);
        setError('');
      })
      .catch((e) => { if (vigente) setError(e.message || 'No pudimos cargar tus direcciones.'); })
      .finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [activo, conConjuntos]);

  const agregar = useCallback(async (datos) => {
    const d = await api('/domicilios', { method: 'POST', body: datos });
    setDirecciones((lista) => [d, ...lista.filter((x) => x.id !== d.id)]);
    return d.id;
  }, []);

  const conjuntosDePersona = [...new Set(direcciones.map((d) => d.conjunto?.slug).filter(Boolean))];
  return { direcciones, conjuntos, cargando, error, agregar, conjuntosDePersona };
}
