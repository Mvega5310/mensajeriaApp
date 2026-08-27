import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/db.js';
import { sendPasswordResetEmail } from '../services/email.service.js';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora
const RESET_COOLDOWN_MS = 60 * 1000; // evita reenvíos en cadena al mismo correo

// Mínimo 8 caracteres, al menos una letra y un número. Se valida aquí
// porque el minLength/patrón del formulario es solo una ayuda visual —
// cualquiera puede saltárselo pegando directo contra la API.
const PASSWORD_POLICY = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

// El registro público solo crea cuentas RESIDENT — el rol nunca sale del
// body de la petición. La cuenta de operador se crea aparte (ver
// prisma/seed.js), para que nadie pueda auto-asignarse ese rol.
export async function register(req, res) {
  const { email, password, nombre, telefono, torre, apto, acceptedTerms } = req.body;
  if (!email || !password || !nombre || !telefono) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }
  if (!PASSWORD_POLICY.test(password)) {
    return res.status(400).json({ error: 'La contraseña debe tener mínimo 8 caracteres, con al menos una letra y un número' });
  }
  // No basta con que el checkbox exista en el formulario: si alguien pega
  // directo contra la API sin aceptar, no hay cuenta. La fecha exacta
  // queda en termsAcceptedAt como constancia de la aceptación.
  if (acceptedTerms !== true) {
    return res.status(400).json({ error: 'Debes aceptar los Términos y el Aviso de Privacidad' });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: 'El correo ya está registrado' });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, passwordHash, role: 'RESIDENT', nombre, telefono, torre, apto, termsAcceptedAt: new Date() },
  });

  res.status(201).json({ id: user.id, email: user.email, role: user.role });
}

export async function login(req, res) {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  const token = jwt.sign(
    { sub: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );

  res.json({ token, user: { id: user.id, nombre: user.nombre, role: user.role } });
}

// Respuesta idéntica exista o no la cuenta — si dijera "correo no
// encontrado" cualquiera podría usar este endpoint para averiguar qué
// vecinos están registrados en la app.
const GENERIC_RESET_RESPONSE = { message: 'Si el correo existe, enviamos un enlace para restablecer la contraseña.' };

export async function forgotPassword(req, res) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'El correo es requerido' });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.json(GENERIC_RESET_RESPONSE);

  const recent = await prisma.passwordResetToken.findFirst({
    where: { userId: user.id, createdAt: { gt: new Date(Date.now() - RESET_COOLDOWN_MS) } },
  });
  if (recent) return res.json(GENERIC_RESET_RESPONSE);

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
  });

  const resetUrl = `${process.env.FRONTEND_URL}/restablecer?token=${rawToken}`;
  if (!process.env.RESEND_API_KEY || process.env.RESEND_API_KEY.startsWith('re_xxx')) {
    // Sin API key configurada (dev local): no hay a quién enviarle nada,
    // así que el enlace queda en el log para poder probar el flujo igual.
    console.log(`[dev] Enlace de restablecimiento para ${user.email}: ${resetUrl}`);
  } else {
    try {
      await sendPasswordResetEmail(user.email, resetUrl);
    } catch (err) {
      console.error('Error enviando correo de recuperación:', err);
    }
  }

  res.json(GENERIC_RESET_RESPONSE);
}

export async function resetPassword(req, res) {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Faltan datos' });
  if (!PASSWORD_POLICY.test(password)) {
    return res.status(400).json({ error: 'La contraseña debe tener mínimo 8 caracteres, con al menos una letra y un número' });
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const record = await prisma.passwordResetToken.findFirst({ where: { tokenHash } });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return res.status(400).json({ error: 'El enlace es inválido o ya venció' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    // invalida también cualquier otro enlace pendiente de esta cuenta
    prisma.passwordResetToken.deleteMany({ where: { userId: record.userId } }),
  ]);

  res.json({ message: 'Contraseña actualizada' });
}

export async function me(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const { passwordHash, ...profile } = user;
  res.json(profile);
}
