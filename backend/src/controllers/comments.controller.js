import { AppError, CODIGOS } from '../domain/errores.js';
import { prisma } from '../config/db.js';
import { nulaSiVacia } from '../services/domicilio.service.js';

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

// Operador: todos los del conjunto, con los datos del residente para poder ubicarlo. De la
// persona solo se muestra lo que hay en su Domicilio de ESTE conjunto (nombre, teléfono,
// torre, apto), nunca datos de la cuenta ni de otros conjuntos (PLAN-conjunto S1.2). Sin
// Domicilio aquí solo se muestra su nombre.
export async function listAll(req, res) {
  const comentarios = await prisma.comentario.findMany({
    include: { residente: { select: { nombre: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const ids = [...new Set(comentarios.map((c) => c.residenteId))];
  const domicilios = ids.length
    ? await prisma.domicilio.findMany({
      where: { usuarioId: { in: ids }, activo: true },
      orderBy: [{ ultimoUsoEn: 'asc' }, { creadoEn: 'asc' }], // el más reciente queda al final y gana
      select: { usuarioId: true, nombreRecibe: true, telefono: true, torre: true, apto: true },
    })
    : [];
  const porPersona = new Map(domicilios.map((d) => [d.usuarioId, d]));
  res.json(comentarios.map((c) => {
    const d = porPersona.get(c.residenteId);
    return {
      ...c,
      residente: d
        ? { nombre: d.nombreRecibe, telefono: d.telefono, torre: nulaSiVacia(d.torre), apto: nulaSiVacia(d.apto) }
        : { nombre: c.residente?.nombre ?? '', telefono: '', torre: null, apto: null },
    };
  }));
}
