import { useMemo, useState } from 'react';
import usePaquetes from './usePaquetes.js';
import { etiquetaApto } from '../../utils/apto.js';

function sinTildes(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Pendientes: sin asignar, por entregar (agrupado por apartamento) y pre-alertados, con buscador. */
export default function usePendientes() {
  const base = usePaquetes();
  const [q, setQ] = useState('');

  const filtrar = (lista) => {
    const t = sinTildes(q).trim();
    if (!t) return lista;
    return lista.filter((p) => {
      const r = p.residente;
      const pajar = [r ? etiquetaApto(r.torre, r.apto) : '', r?.nombre, p.etiquetaNombre, p.proveedor, p.transportadora, p.guia];
      return sinTildes(pajar.join(' ')).includes(t);
    });
  };

  const grupos = useMemo(() => {
    const mapa = new Map();
    for (const p of filtrar(base.porEntregar)) {
      const r = p.residente;
      const clave = r ? `${r.torre}|${r.apto}` : p.id;
      if (!mapa.has(clave)) {
        mapa.set(clave, { clave, apto: r ? etiquetaApto(r.torre, r.apto) : 'Sin dueño', nombre: r?.nombre ?? p.etiquetaNombre, paquetes: [] });
      }
      mapa.get(clave).paquetes.push(p);
    }
    return [...mapa.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base.porEntregar, q]);

  return { ...base, q, setQ, grupos, sinAsignarFiltrados: filtrar(base.sinAsignar), prealertadosFiltrados: filtrar(base.prealertados) };
}
