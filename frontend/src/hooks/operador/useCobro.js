import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api.js';
import { leerLote, limpiarLote } from './loteEnMemoria.js';
import { invalidarPaquetes } from './usePaquetes.js';

/** Op-Cobrar: lote verificado (en memoria), método de pago y confirmación. */
export default function useCobro() {
  const navigate = useNavigate();
  const lote = leerLote();
  const [metodo, setMetodo] = useState(lote?.metodosPago?.[0] ?? '');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  // Revisión S3.2: el lote puede mezclar personas del mismo apartamento; solo se marcan los del
  // dueño del PIN (`seleccionado`) y el operador puede marcar/desmarcar. Sin mezcla, todo marcado.
  const [sel, setSel] = useState(() => new Set((lote?.paquetes ?? []).filter((p) => p.seleccionado !== false).map((p) => p.id)));
  const elegidos = (lote?.paquetes ?? []).filter((p) => sel.has(p.id));
  const total = elegidos.reduce((s, p) => s + p.costo, 0);
  function alternar(id) {
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function volver(aviso) {
    limpiarLote();
    navigate('/op/entregar', { replace: true, state: aviso ? { aviso } : undefined });
  }

  async function confirmar() {
    if (enviando || !lote || !elegidos.length) return;
    setEnviando(true);
    setError('');
    try {
      const r = await api('/entregas/confirmar', {
        method: 'POST',
        sinCierreDeSesion: true, // el 401 puede ser del token de entrega, no de la sesión
        body: { tokenEntrega: lote.tokenEntrega, paqueteIds: elegidos.map((p) => p.id), metodoPago: metodo },
      });
      invalidarPaquetes();
      volver({ tipo: 'info', texto: `Entregamos ${r.entregados} ${r.entregados === 1 ? 'paquete' : 'paquetes'}.` });
    } catch (e) {
      if (e.status === 401 || e.status === 409) {
        volver({ tipo: 'error', texto: `${e.message} Vuelve a ingresar el PIN.` });
        return;
      }
      setError(e.message);
      setEnviando(false);
    }
  }

  return { lote, metodo, setMetodo, enviando, error, confirmar, volver, sel, alternar, elegidos, total };
}
