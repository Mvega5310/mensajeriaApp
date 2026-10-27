import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';
import { guardarSesionEnlace, modoDeSesion } from './sesionEnlace.js';

// StrictMode monta dos veces: la primera lectura quita el fragmento de la barra, así que
// la promesa se conserva a nivel de módulo para que la segunda no vea un /p vacío.
let pendiente = null;

/** Pantalla /p: toma el token del fragmento (`/p#<token>`), lo borra de la barra de
 *  direcciones y lo canjea por POST /p/abrir. Un enlace viejo con el token en la ruta
 *  (/p/<token>) no se canjea: se trata como inválido. estado: 'abriendo' | 'listo' | 'invalido'. */
export default function useAbrirEnlace() {
  const [estado, setEstado] = useState('abriendo');
  useEffect(() => {
    let vigente = true;
    if (!pendiente) {
      const token = decodeURIComponent(location.hash.replace(/^#/, '')).trim();
      window.history.replaceState(null, '', '/p');
      pendiente = (token
        ? api('/p/abrir', { method: 'POST', body: { token }, sinCierreDeSesion: true })
          .then((vista) => { guardarSesionEnlace(vista.sesion, vista); return true; })
          .catch(() => false)
        : Promise.resolve(!!modoDeSesion())) // sin token: sirve si ya hay una sesión abierta
        .finally(() => { setTimeout(() => { pendiente = null; }, 0); });
    }
    pendiente.then((ok) => vigente && setEstado(ok ? 'listo' : 'invalido'));
    return () => { vigente = false; };
  }, []);
  return estado;
}
