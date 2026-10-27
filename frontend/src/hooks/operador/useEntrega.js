import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api.js';
import { guardarLote } from './loteEnMemoria.js';

/** Op-Entregar: arma el PIN de 4 dígitos y, al completarlo, lo verifica. */
export default function useEntrega() {
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [opciones, setOpciones] = useState(null); // PIN_AMBIGUO: [{ residenteId, etiquetaApto }]
  const [verificando, setVerificando] = useState(false);

  async function verificar(valor, residenteId) {
    setVerificando(true);
    setError('');
    try {
      const lote = await api('/entregas/verificar-pin', {
        method: 'POST',
        body: { pin: valor, ...(residenteId ? { residenteId } : {}) },
      });
      guardarLote({ ...lote, pin: undefined });
      navigate('/op/entregar/lote');
    } catch (e) {
      if (e.code === 'PIN_AMBIGUO' && e.details?.opciones) {
        setOpciones(e.details.opciones);
      } else {
        setError(e.message);
        setOpciones(null);
        setPin('');
      }
    } finally {
      setVerificando(false);
    }
  }

  function tecla(k) {
    if (verificando) return;
    if (k === 'limpiar') { setPin(''); setError(''); setOpciones(null); return; }
    if (k === 'borrar') { setPin(pin.slice(0, -1)); setError(''); return; }
    if (pin.length >= 4) return;
    const nuevo = pin + k;
    setPin(nuevo);
    setError('');
    if (nuevo.length === 4) verificar(nuevo);
  }

  return { pin, error, opciones, verificando, tecla, elegir: (id) => verificar(pin, id) };
}
