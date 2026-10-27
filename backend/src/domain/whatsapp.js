// Enlace y texto del aviso de llegada por WhatsApp (T2.3, provisional).
// Funciones puras. T2.4 lo completa (correo, enlace firmado de T3.1).
// WhatsApp es MANUAL: se arma un enlace wa.me con el mensaje precargado y el
// operador solo toca Enviar (decisión fija del proyecto).

const soloDigitos = (v) => String(v ?? '').replace(/\D/g, '');

/**
 * https://wa.me/<prefijo><telefono>?text=<texto codificado>.
 * Sin teléfono utilizable => null. Un teléfono que ya empieza con el prefijo y
 * tiene más de 10 dígitos no se vuelve a prefijar.
 */
export function construirEnlace({ prefijoPais, telefono, texto }) {
  const tel = soloDigitos(telefono).replace(/^0+/, '');
  if (!tel) return null;
  const prefijo = soloDigitos(prefijoPais);
  const numero = prefijo && !(tel.startsWith(prefijo) && tel.length > 10) ? `${prefijo}${tel}` : tel;
  return `https://wa.me/${numero}?text=${encodeURIComponent(String(texto ?? ''))}`;
}

export const ETIQUETAS_CATEGORIA = Object.freeze({
  MANO: 'Artículo de mano',
  ESTANDAR: 'Paquete estándar',
  VOLUMEN: 'Paquete voluminoso',
  PESADO: 'Carga especial',
});

/**
 * Texto del aviso de llegada (artboard Op-Guardado: "Hola Ana, llegó tu paquete...").
 * NUNCA lleva el PIN: el WhatsApp pasa por el teléfono del operador y el PIN solo
 * lo ve el residente, dentro del enlace (o en su app/correo).
 */
export function textoLlegada({ nombre, categoria, enlace }) {
  const primero = String(nombre ?? '').trim().split(/\s+/)[0];
  const saludo = primero ? `Hola ${primero}` : 'Hola';
  const cat = ETIQUETAS_CATEGORIA[categoria];
  const base = `${saludo}, llegó tu paquete a portería${cat ? ` (${cat})` : ''}.`;
  // T3.1: enlace a "Mis paquetes" (sin contraseña, vence en 7 días); el token va en
  // el fragmento (#) para que no viaje al servidor. Ahí está el PIN.
  return enlace
    ? `${base} Tu PIN de entrega está aquí: ${enlace}`
    : `${base} Consulta tu PIN de entrega en la app de Puertaya.`;
}
