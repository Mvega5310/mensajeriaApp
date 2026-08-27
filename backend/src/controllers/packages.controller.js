import { prisma } from '../config/db.js';
import { generatePin, verifyPin } from '../services/pin.service.js';
import { costoPara } from '../services/tariff.service.js';
import { sendNewPackageOperatorEmail, sendPrealertConfirmationEmail } from '../services/email.service.js';

// Residente: crea una pre-alerta para sí mismo. Nombre/teléfono/torre/apto
// ya no se piden en el formulario: salen del usuario autenticado, así que
// no pueden falsificarse escribiendo el nombre de otro residente.
//
// La categoría de peso que manda aquí es una ESTIMACIÓN suya (nadie más
// conoce el tamaño del paquete todavía) y solo sirve para mostrarle una
// tarifa de referencia. El precio que realmente se cobra lo fija el
// operador en checkin(), con el paquete físico en mano — este endpoint
// nunca es la fuente final de verdad del cobro. La franja/método de pago
// tampoco son definitivos: son la preferencia inicial del residente, que
// se confirma de nuevo (y puede cambiar) cuando el paquete llega — ver
// schedule().
export async function createPrealert(req, res) {
  const {
    proveedor, guia, categoriaPeso, esContraEntregaProveedor, valorProductoProveedor,
    valorDeclarado, franjaHoraria, metodoPagoServicio,
  } = req.body;
  if (!proveedor) return res.status(400).json({ error: 'El proveedor es requerido' });

  let costoServicio;
  try {
    costoServicio = costoPara(categoriaPeso || 'ESTANDAR');
  } catch {
    return res.status(400).json({ error: 'Categoría de peso inválida' });
  }

  const pkg = await prisma.package.create({
    data: {
      residenteId: req.user.sub,
      proveedor,
      guia: guia || 'Sin Guía',
      categoriaPeso: categoriaPeso || 'ESTANDAR',
      costoServicio,
      esContraEntregaProveedor: !!esContraEntregaProveedor,
      valorProductoProveedor: Number(valorProductoProveedor) || 0,
      valorDeclarado: Number(valorDeclarado) || 0,
      franjaHoraria: franjaHoraria || null,
      metodoPagoServicio: metodoPagoServicio || null,
      pin: generatePin(),
    },
  });

  // Aviso automático — no bloquea la respuesta si falla el envío (ver
  // sendEmail en email.service.js, que ya se traga sus propios errores).
  const residente = await prisma.user.findUnique({ where: { id: req.user.sub } });
  const operador = await prisma.user.findFirst({ where: { role: 'OPERATOR' } });
  if (operador) sendNewPackageOperatorEmail(operador.email, pkg, residente);
  sendPrealertConfirmationEmail(residente.email, pkg);

  res.status(201).json(pkg);
}

// Residente: solo ve sus propios paquetes (nunca los de otros) — e
// incluye siempre su PIN, porque lo necesita cada vez que abre la puerta.
export async function listMine(req, res) {
  const packages = await prisma.package.findMany({
    where: { residenteId: req.user.sub },
    orderBy: { createdAt: 'desc' },
  });
  res.json(packages);
}

// Operador: ve todos los paquetes, pero el PIN nunca viaja hacia esta vista.
export async function listAll(req, res) {
  const packages = await prisma.package.findMany({
    include: { residente: { select: { nombre: true, telefono: true, torre: true, apto: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(packages.map(({ pin, ...p }) => p));
}

// Residente: programa su propia franja de entrega — se verifica dueño.
export async function schedule(req, res) {
  const { franjaHoraria, metodoPagoServicio } = req.body;
  const pkg = await prisma.package.findUnique({ where: { id: req.params.id } });
  if (!pkg || pkg.residenteId !== req.user.sub) {
    return res.status(404).json({ error: 'Paquete no encontrado' });
  }

  const updated = await prisma.package.update({
    where: { id: pkg.id },
    data: { franjaHoraria, metodoPagoServicio, estado: 'PROGRAMADO' },
  });
  res.json(updated);
}

export async function checkin(req, res) {
  const { categoriaPeso, fotoUrl } = req.body;
  const pkg = await prisma.package.update({
    where: { id: req.params.id },
    data: {
      categoriaPeso,
      costoServicio: costoPara(categoriaPeso),
      fotoUrl,
      estado: 'EN_RECEPCION',
    },
  });
  res.json({ ...pkg, pin: undefined });
}

// El operador envía un intento; el servidor compara y responde sí/no.
// El valor correcto del PIN nunca aparece en esta respuesta.
export async function confirmDelivery(req, res) {
  const { pin } = req.body;
  const pkg = await prisma.package.findUnique({ where: { id: req.params.id } });
  if (!pkg) return res.status(404).json({ error: 'Paquete no encontrado' });

  if (!verifyPin(pin, pkg.pin)) {
    return res.status(400).json({ error: 'PIN incorrecto' });
  }

  const updated = await prisma.package.update({
    where: { id: pkg.id },
    data: { estado: 'ENTREGADO', fechaEntrega: new Date() },
  });
  res.json({ ...updated, pin: undefined });
}
