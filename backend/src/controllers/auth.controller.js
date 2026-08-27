import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/db.js';

// El registro público solo crea cuentas RESIDENT — el rol nunca sale del
// body de la petición. La cuenta de operador se crea aparte (ver
// prisma/seed.js), para que nadie pueda auto-asignarse ese rol.
export async function register(req, res) {
  const { email, password, nombre, telefono, torre, apto } = req.body;
  if (!email || !password || !nombre || !telefono) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: 'El correo ya está registrado' });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, passwordHash, role: 'RESIDENT', nombre, telefono, torre, apto },
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

export async function me(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const { passwordHash, ...profile } = user;
  res.json(profile);
}
