import { AppError, CODIGOS } from '../domain/errores.js';
import { prisma } from '../config/db.js';

const MAX_LENGTH = 1000;

export async function create(req, res) {
  const mensaje = (req.body.mensaje || '').trim();
  if (!mensaje) throw new AppError(CODIGOS.DATOS_INVALIDOS, 'Escribe un mensaje antes de enviar.', 400);
  if (mensaje.length > MAX_LENGTH) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, `El mensaje puede tener hasta ${MAX_LENGTH} caracteres. Acórtalo e intenta de nuevo.`, 400);
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
