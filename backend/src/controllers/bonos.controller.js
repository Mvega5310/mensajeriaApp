import { prisma } from '../config/db.js';
import { TARIFAS } from '../services/tariff.service.js';

// Operador: registra que un residente pagó por adelantado un lote de
// entregas en una categoría de peso — monto y cantidad libres, el
// operador decide el descuento caso a caso (no hay tarifas fijas aquí,
// a diferencia de costoPara()).
export async function create(req, res) {
  const { residenteId, categoriaPeso, cantidad, precioPagado } = req.body;

  if (!(categoriaPeso in TARIFAS)) {
    return res.status(400).json({ error: 'Categoría de peso inválida' });
  }
  const cantidadNum = Number(cantidad);
  if (!Number.isInteger(cantidadNum) || cantidadNum < 1) {
    return res.status(400).json({ error: 'La cantidad debe ser un entero positivo' });
  }
  const precioNum = Number(precioPagado);
  if (!Number.isInteger(precioNum) || precioNum < 0) {
    return res.status(400).json({ error: 'El precio pagado no es válido' });
  }

  const residente = await prisma.user.findUnique({ where: { id: residenteId } });
  if (!residente || residente.role !== 'RESIDENT') {
    return res.status(404).json({ error: 'Residente no encontrado' });
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
