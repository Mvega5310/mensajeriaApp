import { prisma } from '../config/db.js';

const MAX_LENGTH = 1000;

export async function create(req, res) {
  const mensaje = (req.body.mensaje || '').trim();
  if (!mensaje) return res.status(400).json({ error: 'Escribe un mensaje' });
  if (mensaje.length > MAX_LENGTH) {
    return res.status(400).json({ error: `Máximo ${MAX_LENGTH} caracteres` });
  }

  const comentario = await prisma.comentario.create({
    data: { residenteId: req.user.sub, mensaje },
  });
  res.status(201).json(comentario);
}

// Residente: solo sus propios comentarios.
export async function listMine(req, res) {
  const comentarios = await prisma.comentario.findMany({
    where: { residenteId: req.user.sub },
    orderBy: { createdAt: 'desc' },
  });
  res.json(comentarios);
}

// Operador: todos, con los datos del residente para poder ubicarlo.
export async function listAll(req, res) {
  const comentarios = await prisma.comentario.findMany({
    include: { residente: { select: { nombre: true, telefono: true, torre: true, apto: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(comentarios);
}
