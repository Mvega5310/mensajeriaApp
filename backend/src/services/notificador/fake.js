// Notificador en memoria: no envía nada, guarda cada mensaje para inspeccionarlo.
import { construirMensajes } from './mensajes.js';

export function crearNotificadorFake() {
  const enviados = [];
  const base = construirMensajes(async (mensaje) => { enviados.push({ ...mensaje, enviadoEn: new Date() }); });
  return {
    ...base,
    tipo: 'fake',
    obtenerEnviados: () => enviados.slice(),
    limpiar: () => { enviados.length = 0; },
  };
}
