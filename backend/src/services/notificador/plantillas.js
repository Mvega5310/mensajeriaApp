// Plantillas de correo (T2.4). Funciones PURAS: reciben datos, devuelven
// { asunto, html }. Todo valor interpolado pasa por escaparHtml; nada del
// conjunto está fijo en el código: el nombre y los datos salen de `conjunto`.
// Tono: español, tuteo, sin emoji ni exclamaciones.

const ENTIDADES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapa un valor para ponerlo en HTML (texto o atributo entre comillas). */
export function escaparHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ENTIDADES[c]);
}

// El asunto es una cabecera: sin saltos de línea.
const limpiarAsunto = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();

const nombreConjunto = (conjunto) => String(conjunto?.nombre ?? '').trim() || 'tu conjunto';
const primerNombre = (nombre) => String(nombre ?? '').trim().split(/\s+/)[0] || '';
const saludo = (nombre) => {
  const p = primerNombre(nombre);
  return p ? `Hola ${escaparHtml(p)},` : 'Hola,';
};

// Convierte las URL http(s) de un texto YA escapado en enlaces. Las comillas
// quedaron escapadas, así que la URL no puede cerrar el atributo.
function autoenlazar(escapado) {
  return escapado.replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`);
}

function envolver(conjunto, cuerpo) {
  return `${cuerpo}\n<p style="color:#666;font-size:12px">Puertaya &middot; ${escaparHtml(nombreConjunto(conjunto))}</p>`;
}

export function plantillaLlegada({ residente, paquete, conjunto, aviso }) {
  const texto = aviso?.texto ?? '';
  const lugar = conjunto?.puntoRecepcion
    ? `<p>Puedes recogerlo en ${escaparHtml(conjunto.puntoRecepcion)}.</p>` : '';
  return {
    asunto: limpiarAsunto(`Llegó tu paquete: ${nombreConjunto(conjunto)}`),
    html: envolver(conjunto, `
      <p>${saludo(residente?.nombre)}</p>
      <p>${autoenlazar(escaparHtml(texto))}</p>
      ${paquete?.proveedor ? `<p>Proveedor: ${escaparHtml(paquete.proveedor)}</p>` : ''}
      ${lugar}
    `),
  };
}

export function plantillaEntrega({ residente, paquetes, conjunto }) {
  const lista = Array.isArray(paquetes) ? paquetes : [];
  const unico = lista.length === 1;
  const detalle = lista.map((p) => `<li>${escaparHtml(p?.proveedor || 'Paquete')}</li>`).join('');
  return {
    asunto: limpiarAsunto(unico ? 'Entregamos tu paquete' : 'Entregamos tus paquetes'),
    html: envolver(conjunto, `
      <p>${saludo(residente?.nombre)}</p>
      <p>${unico ? 'Tu paquete ya fue entregado.' : 'Tus paquetes ya fueron entregados.'}</p>
      ${lista.length ? `<ul>${detalle}</ul>` : ''}
      <p>Gracias por confiar en ${escaparHtml(nombreConjunto(conjunto))}.</p>
    `),
  };
}

export function plantillaEnlaceAcceso({ url, conjunto }) {
  const u = escaparHtml(url);
  return {
    asunto: limpiarAsunto(`Tu enlace de acceso a ${nombreConjunto(conjunto)}`),
    html: envolver(conjunto, `
      <p>Usa este enlace para entrar a Puertaya:</p>
      <p><a href="${u}">${u}</a></p>
      <p>Si no lo pediste tú, ignora este correo.</p>
    `),
  };
}

export function plantillaPrealerta({ residente, paquete, conjunto }) {
  return {
    asunto: limpiarAsunto(`Recibimos tu pre-alerta: ${paquete?.proveedor ?? ''}`),
    html: envolver(conjunto, `
      <p>${saludo(residente?.nombre)}</p>
      <p>Registramos tu paquete de <strong>${escaparHtml(paquete?.proveedor)}</strong>. Te avisaremos cuando llegue a recepción.</p>
      <p>Franja preferida: ${escaparHtml(paquete?.franjaHoraria || 'sin indicar')}</p>
      <p>Puedes ver el estado y tu PIN de entrega en la app cuando quieras.</p>
    `),
  };
}

export function plantillaNuevaPrealerta({ residente, paquete, conjunto }) {
  const cobro = paquete?.esContraEntregaProveedor
    ? `<p>Cobro contra entrega: $${escaparHtml(Number(paquete.valorProductoProveedor || 0).toLocaleString('es-CO'))}</p>` : '';
  const nota = paquete?.notas
    ? `<p>Nota del residente: <strong>${escaparHtml(paquete.notas)}</strong></p>` : '';
  return {
    asunto: limpiarAsunto(`Nueva pre-alerta: ${residente?.torre ?? ''} apto ${residente?.apto ?? ''}`),
    html: envolver(conjunto, `
      <p><strong>${escaparHtml(residente?.nombre)}</strong> (${escaparHtml(residente?.torre)} - apto ${escaparHtml(residente?.apto)}, ${escaparHtml(residente?.telefono)})
      avisó que viene un paquete.</p>
      <p>Proveedor: ${escaparHtml(paquete?.proveedor)}<br>Guía: ${escaparHtml(paquete?.guia)}</p>
      <p>Franja preferida: ${escaparHtml(paquete?.franjaHoraria || 'sin indicar')}</p>
      ${cobro}
      ${nota}
    `),
  };
}

export function plantillaRecuperacion({ url, conjunto }) {
  const u = escaparHtml(url);
  return {
    asunto: limpiarAsunto(`Restablece tu contraseña: ${nombreConjunto(conjunto)}`),
    html: envolver(conjunto, `
      <p>Recibimos una solicitud para restablecer tu contraseña en Puertaya.</p>
      <p><a href="${u}">Crea una nueva contraseña aquí</a></p>
      <p>Este enlace vence en 1 hora. Si no fuiste tú, ignora este correo.</p>
    `),
  };
}
