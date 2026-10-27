import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api.js';

/** Bonos prepago de un residente (solo si el conjunto los habilita). */
export default function useBonos(residenteId) {
  const [bonos, setBonos] = useState([]);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setBonos(await api(`/bonos/residente/${residenteId}`));
    } catch (e) {
      setError(e.message);
    }
  }, [residenteId]);

  useEffect(() => { cargar(); }, [cargar]);

  async function crear({ categoriaPeso, cantidad, precioPagado }) {
    setGuardando(true);
    setError('');
    try {
      await api('/bonos', {
        method: 'POST',
        body: { residenteId, categoriaPeso, cantidad: Number(cantidad), precioPagado: Number(precioPagado) },
      });
      await cargar();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setGuardando(false);
    }
  }

  return { bonos, error, guardando, crear };
}
