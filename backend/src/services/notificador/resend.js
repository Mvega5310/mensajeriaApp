// Notificador real sobre la API de Resend.
import { Resend } from 'resend';
import { construirMensajes } from './mensajes.js';

const FROM_POR_DEFECTO = 'Puertaya <onboarding@resend.dev>';

export function crearNotificadorResend({ apiKey, from }) {
  let cliente;
  const remitente = from || FROM_POR_DEFECTO;
  const base = construirMensajes(async ({ para, asunto, html }) => {
    // Cliente perezoso: el constructor de Resend revienta sin clave.
    cliente ??= new Resend(apiKey);
    const { error } = await cliente.emails.send({ from: remitente, to: para, subject: asunto, html });
    if (error) {
      const e = new Error('Resend rechazó el envío');
      e.code = error.name || 'resend_error';
      throw e;
    }
  });
  return { ...base, tipo: 'resend' };
}
