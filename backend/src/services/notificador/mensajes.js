// Une las plantillas con un transporte `enviar({ tipo, para, asunto, html })`.
// Ambas implementaciones comparten esto, así el fake y el real no divergen.
import {
  plantillaLlegada, plantillaEntrega, plantillaEnlaceAcceso, plantillaPrealerta,
  plantillaNuevaPrealerta, plantillaRecuperacion,
} from './plantillas.js';

export function construirMensajes(enviar) {
  const despachar = async (tipo, para, { asunto, html }) => {
    if (!para) return; // sin destinatario no hay nada que enviar
    await enviar({ tipo, para, asunto, html });
  };
  return {
    avisarLlegada: (d) => despachar('llegada', d.residente?.email, plantillaLlegada(d)),
    agradecerEntrega: (d) => despachar('entrega', d.residente?.email, plantillaEntrega(d)),
    enviarEnlaceAcceso: (d) => despachar('enlaceAcceso', d.email, plantillaEnlaceAcceso(d)),
    confirmarPrealerta: (d) => despachar('prealerta', d.residente?.email, plantillaPrealerta(d)),
    avisarNuevaPrealerta: (d) => despachar('nuevaPrealerta', d.operador?.email, plantillaNuevaPrealerta(d)),
    recuperarContrasena: (d) => despachar('recuperacion', d.email, plantillaRecuperacion(d)),
  };
}
