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

/** Texto del aviso de llegada (artboard Op-Guardado: "Hola Ana, llegó tu paquete..."). */
export function textoLlegada({ nombre, categoria, pin }) {
  const primero = String(nombre ?? '').trim().split(/\s+/)[0];
  const saludo = primero ? `Hola ${primero}` : 'Hola';
  const cat = ETIQUETAS_CATEGORIA[categoria];
  return `${saludo}, llegó tu paquete a portería${cat ? ` (${cat})` : ''}. Tu PIN de entrega es ${pin}.`;
}
