import { useState } from 'react';
import { api } from '../../services/api.js';

/** Pre-alerta (POST /packages). Solo con sesión normal: la del enlace no puede avisar. */
export default function useAvisar() {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  async function avisar(body) {
    setEnviando(true);
    setError('');
    try {
      await api('/packages', { method: 'POST', body });
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setEnviando(false);
    }
  }
  return { avisar, enviando, error };
}
