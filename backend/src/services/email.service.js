import { Resend } from 'resend';

const FROM = process.env.EMAIL_FROM || 'Puertaya Ipanema <onboarding@resend.dev>';

// Centraliza el fallback de desarrollo y el manejo de errores: ningún
// llamador necesita su propio try/catch ni chequear si hay API key.
async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY || process.env.RESEND_API_KEY.startsWith('re_xxx')) {
    console.log(`[dev] Correo no enviado (sin RESEND_API_KEY) — para: ${to} — asunto: ${subject}`);
    return;
  }
  try {
    // Se crea aquí, no al importar el módulo: si esto viviera arriba, el
    // servidor completo se caía al arrancar en cualquier entorno sin
    // RESEND_API_KEY configurada (el constructor de Resend revienta sin key).
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({ from: FROM, to, subject, html });
  } catch (err) {
    console.error(`Error enviando correo a ${to}:`, err);
  }
}

export async function sendPasswordResetEmail(to, resetUrl) {
  await sendEmail({
    to,
    subject: 'Restablece tu contraseña — Puertaya Ipanema',
    html: `
      <p>Recibimos una solicitud para restablecer tu contraseña en Puertaya Ipanema.</p>
      <p><a href="${resetUrl}">Haz clic aquí para crear una nueva contraseña</a></p>
      <p>Este enlace vence en 1 hora. Si no fuiste tú, ignora este correo.</p>
    `,
  });
}

export async function sendNewPackageOperatorEmail(operatorEmail, pkg, residente) {
  await sendEmail({
    to: operatorEmail,
    subject: `📦 Nuevo paquete — ${residente.torre} Apto ${residente.apto}`,
    html: `
      <p><strong>${residente.nombre}</strong> (${residente.torre} - Apto ${residente.apto}, ${residente.telefono})
      notificó un paquete nuevo.</p>
      <p>Proveedor: ${pkg.proveedor}<br>Guía: ${pkg.guia}</p>
      <p>Franja preferida: ${pkg.franjaHoraria || 'sin indicar'}</p>
      ${pkg.esContraEntregaProveedor
        ? `<p>⚠️ Cobro contra entrega: $${pkg.valorProductoProveedor.toLocaleString('es-CO')}</p>`
        : ''}
      ${pkg.notas ? `<p>📝 Nota del residente: <strong>${pkg.notas}</strong></p>` : ''}
    `,
  });
}

export async function sendPrealertConfirmationEmail(residenteEmail, pkg) {
  await sendEmail({
    to: residenteEmail,
    subject: `Recibimos tu pre-alerta — ${pkg.proveedor}`,
    html: `
      <p>Registramos tu paquete de <strong>${pkg.proveedor}</strong>. Te avisaremos cuando llegue a recepción.</p>
      <p>Franja preferida: ${pkg.franjaHoraria || 'sin indicar'}</p>
      <p>Puedes ver el estado y tu PIN de entrega en la app en cualquier momento.</p>
    `,
  });
}
