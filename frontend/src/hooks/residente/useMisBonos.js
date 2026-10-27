import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';
import { NOMBRES_CORTOS } from '../../utils/tiers.js';

/** Saldo de bonos por categoría (GET /bonos/mine, solo sesión normal): [{ categoria, nombre, restantes, total }]. */
export default function useMisBonos() {
  const [saldos, setSaldos] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/bonos/mine').then((bonos) => {
      const por = new Map();
      for (const b of bonos) {
        const s = por.get(b.categoriaPeso) ?? { categoria: b.categoriaPeso, nombre: NOMBRES_CORTOS[b.categoriaPeso]?.nombre ?? b.categoriaPeso, restantes: 0, total: 0 };
        s.restantes += b.cantidadTotal - b.cantidadUsada;
        s.total += b.cantidadTotal;
        por.set(b.categoriaPeso, s);
      }
      setSaldos([...por.values()]);
    }).catch((e) => setError(e.message));
  }, []);
  return { saldos, error };
}
