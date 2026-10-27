import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';

/** Paquetes entregados del residente (solo con sesión normal; las fotos se piden aparte). */
export default function useHistorial(activo) {
  const [lista, setLista] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!activo) return;
    api('/packages/mine')
      .then((r) => setLista(r.filter((p) => p.estado === 'ENTREGADO')
        .sort((a, b) => new Date(b.fechaEntrega ?? 0) - new Date(a.fechaEntrega ?? 0))))
      .catch((e) => setError(e.message));
  }, [activo]);
  return { lista, error };
}
