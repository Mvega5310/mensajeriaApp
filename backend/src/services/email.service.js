import { Resend } from 'resend';

const FROM = process.env.EMAIL_FROM || 'puertaya <onboarding@resend.dev>';

export async function sendPasswordResetEmail(to, resetUrl) {
  // Se crea aquí, no al importar el módulo: si esto viviera arriba, el
  // servidor completo se caía al arrancar en cualquier entorno sin
  // RESEND_API_KEY configurada (el constructor de Resend revienta sin key).
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: FROM,
    to,
    subject: 'Restablece tu contraseña — puertaya',
    html: `
      <p>Recibimos una solicitud para restablecer tu contraseña en puertaya.</p>
      <p><a href="${resetUrl}">Haz clic aquí para crear una nueva contraseña</a></p>
      <p>Este enlace vence en 1 hora. Si no fuiste tú, ignora este correo.</p>
    `,
  });
}
