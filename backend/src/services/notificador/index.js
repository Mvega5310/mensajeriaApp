// Notificador (T2.4): interfaz de avisos por correo con dos implementaciones,
// `resend` (real) y `fake` (memoria, para pruebas y desarrollo sin clave).
//
// Interfaz (todas async; LANZAN si el envío falla, el llamador decide qué hacer,
// ver services/avisos.service.js):
//   avisarLlegada({ residente, paquete, conjunto, aviso })      usa residente.email
//   agradecerEntrega({ residente, paquetes, conjunto })
//   enviarEnlaceAcceso({ email, url, conjunto })                (T3.2)
//   confirmarPrealerta({ residente, paquete, conjunto })
//   avisarNuevaPrealerta({ operador, residente, paquete, conjunto })
//   recuperarContrasena({ email, url, conjunto })
// El fake además expone obtenerEnviados() y limpiar().

import { claveResendValida } from '../../config/env.js';
import { crearNotificadorFake } from './fake.js';
import { crearNotificadorResend } from './resend.js';

let avisado = false;

/** Elige la implementación según el entorno: sin clave válida de Resend => fake. */
export function crearNotificadorDesdeEntorno(env = process.env, { log = console.warn } = {}) {
  const apiKey = claveResendValida(env);
  if (apiKey) return crearNotificadorResend({ apiKey, from: env.EMAIL_FROM });
  if (!avisado) {
    avisado = true;
    log('AVISO: sin RESEND_API_KEY válida, los correos se guardan en memoria y no se envían.');
  }
  return crearNotificadorFake();
}

export { crearNotificadorFake, crearNotificadorResend };
