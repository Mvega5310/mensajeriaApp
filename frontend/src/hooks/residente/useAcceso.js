import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';

const canjes = new Map();

/** /acceso/:token: canje automático (POST, nunca GET); guarda la sesión como el login.
 *  estado: 'entrando' | 'listo' | 'invalido'. */
export function useCanjearAcceso(token) {
  const [estado, setEstado] = useState('entrando');
  useEffect(() => {
    let vigente = true;
    // StrictMode ejecuta el efecto dos veces y el enlace es de un solo uso: se canjea una vez.
    if (!canjes.has(token)) {
      canjes.set(token, api('/auth/enlace/canjear', { method: 'POST', body: { token }, sinCierreDeSesion: true })
        .then((r) => { localStorage.setItem('token', r.token); return true; })
        .catch(() => false));
    }
    canjes.get(token).then((ok) => vigente && setEstado(ok ? 'listo' : 'invalido'));
    return () => { vigente = false; };
  }, [token]);
  return estado;
}

/** /acceso: pide el enlace por correo. La respuesta es genérica y se muestra tal cual. */
export function usePedirEnlace() {
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');

  async function pedir(email) {
    setEnviando(true);
    setError('');
    try {
      const r = await api('/auth/enlace', { method: 'POST', body: { email }, sinCierreDeSesion: true });
      setMensaje(r.message || r.mensaje || '');
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setEnviando(false);
    }
  }
  return { pedir, enviando, mensaje, error, reiniciar: () => setMensaje('') };
}
