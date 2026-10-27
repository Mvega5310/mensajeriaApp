// Envío de avisos DESPUÉS de que la transacción confirmó (T2.4).
// Fire-and-forget: un fallo del correo jamás tumba la respuesta HTTP. El log no
// lleva datos personales (ni correo, ni nombre, ni teléfono): solo el tipo y el
// código del error.
import { textoLlegada, construirEnlace } from '../domain/whatsapp.js';

export function enSegundoPlano(tipo, fn) {
  let p;
  try {
    p = Promise.resolve(fn());
  } catch (err) {
    p = Promise.reject(err);
  }
  return p.catch((err) => {
    console.error(`[notificador] fallo al enviar "${tipo}" (${err?.code || err?.name || 'error'})`);
  });
}

/** Aviso (texto + enlace wa.me manual) del paquete recibido para ese residente. */
export function armarAviso({ residente, paquete, conjunto }) {
  const texto = textoLlegada({ nombre: residente.nombre, categoria: paquete.categoriaPeso, pin: paquete.pin });
  return { texto, waUrl: construirEnlace({ prefijoPais: conjunto.prefijoPais, telefono: residente.telefono, texto }) };
}

/**
 * Correo de llegada. No hace nada si falta notificador o el residente no tiene
 * correo. Devuelve la promesa del envío (los llamadores no tienen que esperarla).
 */
export function enviarAvisoLlegada(notificador, { residente, paquete, conjunto, aviso }) {
  if (!notificador || !residente?.email) return Promise.resolve();
  return enSegundoPlano('llegada', () => notificador.avisarLlegada({
    residente, paquete, conjunto, aviso: aviso ?? armarAviso({ residente, paquete, conjunto }),
  }));
}
