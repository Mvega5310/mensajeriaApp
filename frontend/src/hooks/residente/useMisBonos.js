import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';
import { NOMBRES_CORTOS } from '../../utils/tiers.js';

/** Saldo de bonos por conjunto y categoría (GET /bonos/mine, solo sesión normal; junta TODOS sus conjuntos):
 *  [{ clave, categoria, nombre, conjunto, restantes, total }]. */
export default function useMisBonos() {
  const [saldos, setSaldos] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/bonos/mine').then((bonos) => {
      const por = new Map();
      for (const b of bonos) {
        // Un bono es de UN conjunto: no se mezclan los saldos de conjuntos distintos.
        const clave = `${b.conjunto?.slug ?? ''}|${b.categoriaPeso}`;
        const s = por.get(clave) ?? { clave, categoria: b.categoriaPeso, nombre: NOMBRES_CORTOS[b.categoriaPeso]?.nombre ?? b.categoriaPeso, conjunto: b.conjunto?.nombre ?? null, restantes: 0, total: 0 };
        s.restantes += b.cantidadTotal - b.cantidadUsada;
        s.total += b.cantidadTotal;
        por.set(clave, s);
      }
      setSaldos([...por.values()]);
    }).catch((e) => setError(e.message));
  }, []);
  return { saldos, error };
}
