import { AppError, CODIGOS } from '../domain/errores.js';
import { prisma } from '../config/db.js';
import { esCategoriaValida } from '../services/tariff.service.js';
import { conjuntoDelContexto } from '../services/conjunto.service.js';

// Operador: registra que un residente pagó por adelantado un lote de
// entregas en una categoría de peso — monto y cantidad libres, el
// operador decide el descuento caso a caso (no hay tarifas fijas aquí,
// a diferencia de costoPara()).
export async function create(req, res) {
  // Gate de bonos por conjunto: única fuente Conjunto.bonosHabilitados (del
  // contexto de tenant), false por defecto.
  const conjunto = await conjuntoDelContexto();
  if (!conjunto.bonosHabilitados) {
    throw new AppError(CODIGOS.FUNCION_DESHABILITADA, 'Los bonos prepago no están disponibles en este conjunto por ahora.', 403);
  }

  const { residenteId, categoriaPeso, cantidad, precioPagado } = req.body;

  if (!esCategoriaValida(categoriaPeso)) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, 'La categoría de peso no es válida. Elige una de la lista.', 400);
  }
  const cantidadNum = Number(cantidad);
  if (!Number.isInteger(cantidadNum) || cantidadNum < 1) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, 'La cantidad debe ser un número entero mayor que cero.', 400);
  }
  const precioNum = Number(precioPagado);
  if (!Number.isInteger(precioNum) || precioNum < 0) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, 'El precio pagado no es válido. Escribe un valor numérico.', 400);
  }

  const residente = await prisma.user.findUnique({ where: { id: residenteId } });
  if (!residente || residente.role !== 'RESIDENT') {
    throw new AppError(CODIGOS.NO_ENCONTRADO, 'No encontramos a ese residente en tu conjunto. Revisa e intenta de nuevo.', 404);
  }

  const bono = await prisma.bono.create({
    data: {
      residenteId,
      categoriaPeso,
      cantidadTotal: cantidadNum,
      precioPagado: precioNum,
    },
  });
  res.status(201).json(bono);
}

// Operador: saldo de bonos de un residente (para decidir si vender uno
// nuevo o cuánto le queda del que ya tiene).
export async function listForResident(req, res) {
  const bonos = await prisma.bono.findMany({
    where: { residenteId: req.params.residenteId },
    orderBy: { createdAt: 'desc' },
  });
  res.json(bonos);
}

// Residente: sus propios bonos, para saber cuántas entregas prepagas le quedan.
export async function listMine(req, res) {
  const bonos = await prisma.bono.findMany({
    where: { residenteId: req.user.sub },
    orderBy: { createdAt: 'desc' },
  });
  res.json(bonos);
}
