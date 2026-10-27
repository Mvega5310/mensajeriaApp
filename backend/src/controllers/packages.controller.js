import { prisma } from '../config/db.js';
import { generatePin, verifyPin, registrarIntentoPin } from '../services/pin.service.js';
import { costoPara } from '../services/tariff.service.js';
import {
  sendNewPackageOperatorEmail, sendPrealertConfirmationEmail, sendDeliveryThanksEmail,
} from '../services/email.service.js';
import { conjuntoDelContexto, operadorDelConjuntoActual } from '../services/conjunto.service.js';
import { AppError, CODIGOS } from '../domain/errores.js';
import { claveApartamento } from '../services/apartamento.service.js';
import { esPrimeraEntrega, esCategoriaValida } from '../domain/cobro.js';
import { validarFotos, mensajeMaxFotos } from '../domain/recepcion.js';
import { resolverCobro } from '../services/cobro.service.js';
import { EVENTOS, ESTADOS, transicionar } from '../domain/paquete.machine.js';
import { aplicarEvento, crearConEvento } from '../services/paquete.service.js';
import { recibirPaquete, asignarPaquete } from '../services/recepcion.service.js';

// La cortesía de primera entrega es por apartamento físico, no por
// cuenta — varias personas del mismo apto pueden registrarse con
// correos distintos (ver claveApartamento). Cuando torre/apto vienen
// incompletos no hay con qué agrupar de forma confiable, así que cada
// cuenta incompleta cae en su propia clave (nunca se agrupa con otra
// cuenta también incompleta, como si fueran el mismo apartamento).
// Un paquete sin residente (T2.1: SIN_ASIGNAR) no pertenece a ningún grupo: cae
// en el suyo propio (`paquete:<id>`) para no mezclarse con otros sin dueño.
function claveDeGrupo(residenteId, torre, apto, paqueteId) {
  if (!residenteId) return `paquete:${paqueteId}`;
  return claveApartamento(torre, apto) || `cuenta:${residenteId}`;
}

// Agrupa los createdAt por apartamento físico (ver claveDeGrupo) para
// alimentar esPrimeraEntrega() en los listados.
function createdAtPorGrupo(paquetes) {
  const grupos = new Map();
  for (const p of paquetes) {
    const clave = claveDeGrupo(p.residenteId, p.residente?.torre, p.residente?.apto, p.id);
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(p.createdAt);
  }
  return grupos;
}

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
    valorDeclarado, franjaHoraria, metodoPagoServicio, notas, pinProveedor,
  } = req.body;
  if (!proveedor) throw new AppError(CODIGOS.DATOS_INVALIDOS, 'Indica el proveedor del paquete.', 400);
  if (notas && notas.length > 500) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, 'La nota puede tener hasta 500 caracteres. Acórtala e intenta de nuevo.', 400);
  }
  if (pinProveedor && pinProveedor.length > 30) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, 'El PIN del proveedor puede tener hasta 30 caracteres.', 400);
  }

  if (!esCategoriaValida(categoriaPeso || 'ESTANDAR')) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, 'La categoría de peso no es válida. Elige una de la lista.', 400);
  }
  const costoServicio = await costoPara(categoriaPeso || 'ESTANDAR');

  const pkg = await prisma.$transaction((tx) => crearConEvento(tx, EVENTOS.PREALERTAR, {
    actorId: req.user.sub,
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
      notas: notas || null,
      pinProveedor: pinProveedor || null,
      pin: generatePin(),
    },
  }));

  // Aviso automático — no bloquea la respuesta si falla el envío (ver
  // sendEmail en email.service.js, que ya se traga sus propios errores).
  const residente = await prisma.user.findUnique({ where: { id: req.user.sub } });
  // Operador DEL CONJUNTO del residente (no el primero de la tabla). Si no hay
  // operador en el conjunto, no se envía correo y no se lanza error.
  const operador = await operadorDelConjuntoActual();
  if (operador) sendNewPackageOperatorEmail(operador.email, pkg, residente);
  sendPrealertConfirmationEmail(residente.email, pkg);

  res.status(201).json(pkg);
}

// Residente: solo ve sus propios paquetes (nunca los de otros) — e
// incluye siempre su PIN, porque lo necesita cada vez que abre la puerta.
// fotoUrl NUNCA viaja aquí: puede pesar cientos de KB por paquete (hasta
// 3 fotos en base64) y esta lista se pide cada 20s mientras el residente
// tiene la pestaña abierta — mandarla en cada sondeo fue lo que saturó
// el servidor en producción. Se pide aparte, solo al abrir el detalle
// de un paquete puntual (ver getFoto()).
export async function listMine(req, res) {
  const packages = await prisma.package.findMany({
    where: { residenteId: req.user.sub },
    orderBy: { createdAt: 'desc' },
  });
  res.json(packages.map(({ fotoUrl, ...p }) => p));
}

// Operador: ve todos los paquetes, pero el PIN nunca viaja hacia esta
// vista — y tampoco fotoUrl, por la misma razón que en listMine().
export async function listAll(req, res) {
  // Filtro opcional por estado (ej. ?estado=SIN_ASIGNAR para la sección "Sin asignar").
  const { estado } = req.query;
  if (estado !== undefined && !Object.values(ESTADOS).includes(estado)) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, 'El estado no es válido. Elige uno de la lista.', 400, { campo: 'estado' });
  }
  const packages = await prisma.package.findMany({
    where: estado ? { estado } : undefined,
    include: {
      residente: { select: { nombre: true, telefono: true, torre: true, apto: true } },
      bono: { select: { id: true, categoriaPeso: true, cantidadTotal: true, cantidadUsada: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // El primer paquete (por fecha) de cada apartamento físico (no de cada
  // cuenta — ver claveDeGrupo) es la entrega de cortesía por afiliación
  // (ver flyer de campaña) — se marca aquí para que el operador vea de
  // un vistazo a quién no debe cobrarle.
  const grupos = createdAtPorGrupo(packages);

  res.json(packages.map(({ pin, bonoId, fotoUrl, ...p }) => {
    const clave = claveDeGrupo(p.residenteId, p.residente?.torre, p.residente?.apto, p.id);
    return {
      ...p,
      // Sin residente no hay cortesía de primera entrega. `etiquetaNombre` ya
      // viaja en `p`: la vista lo muestra cuando `residente` es null.
      esPrimeraEntrega: !!p.residenteId
        && esPrimeraEntrega({ createdAt: p.createdAt, createdAtDelApto: grupos.get(clave) }),
    };
  }));
}

// Fotos aparte del listado general (ver comentario en listMine/listAll):
// el residente solo puede pedir las de su propio paquete; el operador,
// las de cualquiera.
export async function getFoto(req, res) {
  const pkg = await prisma.package.findUnique({
    where: { id: req.params.id },
    select: { fotoUrl: true, residenteId: true },
  });
  if (!pkg) throw new AppError(CODIGOS.NO_ENCONTRADO, 'No encontramos ese paquete. Actualiza la lista e intenta de nuevo.', 404);
  if (req.user.role === 'RESIDENT' && pkg.residenteId !== req.user.sub) {
    throw new AppError(CODIGOS.PROHIBIDO, 'No tienes permiso para ver este paquete.', 403);
  }
  res.json({ fotoUrl: pkg.fotoUrl });
}

// Residente: programa su propia franja de entrega — se verifica dueño.
export async function schedule(req, res) {
  const { franjaHoraria, metodoPagoServicio } = req.body;
  const updated = await prisma.$transaction(async (tx) => {
    const pkg = await tx.package.findUnique({ where: { id: req.params.id } });
    if (!pkg || pkg.residenteId !== req.user.sub) {
      throw new AppError(CODIGOS.NO_ENCONTRADO, 'No encontramos ese paquete. Actualiza la lista e intenta de nuevo.', 404);
    }
    return aplicarEvento(tx, pkg, EVENTOS.PROGRAMAR, {
      actorId: req.user.sub,
      datos: { franjaHoraria: franjaHoraria ?? null, metodoPagoServicio: metodoPagoServicio ?? null },
      cambios: { franjaHoraria, metodoPagoServicio },
    });
  });
  res.json(updated);
}

// Hasta `Conjunto.maxFotos` fotos, guardadas como JSON en la misma columna
// fotoUrl (T5.1 las moverá a un almacén). El cobro (cortesía por apartamento,
// bono atómico, tarifa) lo calcula services/cobro.service.js, la MISMA función
// que usa la recepción directa.
export async function checkin(req, res) {
  const { categoriaPeso, fotos } = req.body;
  const conjunto = await conjuntoDelContexto();
  if (fotos && !Array.isArray(fotos)) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, mensajeMaxFotos(conjunto.maxFotos), 400);
  }
  if (fotos) validarFotos(fotos, conjunto.maxFotos);

  const actual = await prisma.package.findUnique({
    where: { id: req.params.id },
    select: { residenteId: true, createdAt: true, residente: { select: { id: true, torre: true, apto: true } } },
  });
  if (!actual) throw new AppError(CODIGOS.NO_ENCONTRADO, 'No encontramos ese paquete. Actualiza la lista e intenta de nuevo.', 404);

  // Se valida antes de consultar bonos (categoriaPeso es un enum en la base);
  // calcularCobro() la vuelve a validar como defensa.
  if (!esCategoriaValida(categoriaPeso)) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, 'La categoría de peso no es válida. Elige una de la lista.', 400);
  }

  // Todo lo que cambia (bono + estado + evento) va en UNA transacción: si la
  // transición es inválida (409) o alguien más ya recibió el paquete, el crédito
  // consumido se revierte. Sin residente (SIN_ASIGNAR) la transición RECIBIR
  // falla con 409 (el camino es ASIGNAR).
  const { pkg, bono, esPrimera } = await prisma.$transaction(async (tx) => {
    const fresco = await tx.package.findUnique({ where: { id: req.params.id } });
    if (!fresco) throw new AppError(CODIGOS.NO_ENCONTRADO, 'No encontramos ese paquete. Actualiza la lista e intenta de nuevo.', 404);
    // Valida la transición ANTES de tocar el bono (un paquete ya recibido o
    // entregado no debe gastar créditos).
    transicionar(fresco.estado, EVENTOS.RECIBIR);

    const r = await resolverCobro(tx, {
      conjunto, residente: actual.residente, categoria: categoriaPeso, createdAt: actual.createdAt,
    });
    const pkg = await aplicarEvento(tx, fresco, EVENTOS.RECIBIR, {
      actorId: req.user.sub,
      datos: { categoriaPeso, motivoCobro: r.cobro.motivo, monto: r.cobro.monto, bonoId: r.bonoId },
      cambios: {
        categoriaPeso,
        costoServicio: r.cobro.monto,
        bonoId: r.bonoId,
        recibidoEn: new Date(),
        fotoUrl: fotos && fotos.length ? JSON.stringify(fotos) : null,
      },
    });
    return { pkg, bono: r.bono, esPrimera: r.esPrimeraEntrega };
  });

  res.json({
    ...pkg,
    pin: undefined,
    esPrimeraEntrega: esPrimera,
    bonoAplicado: bono,
  });
}

// Operador: recibe un paquete con o sin pre-alerta y con o sin dueño (T2.3).
// Cabecera opcional `Idempotency-Key`: un reintento devuelve el mismo paquete.
export async function recepcion(req, res) {
  const { respuesta, repetida } = await recibirPaquete({
    operadorId: req.user.sub,
    body: req.body,
    claveCabecera: req.get('Idempotency-Key'),
  });
  if (repetida) res.set('Idempotent-Replayed', 'true');
  res.status(201).json(respuesta);
}

// Operador: asigna un residente a un paquete que llegó sin dueño (T2.3).
export async function asignar(req, res) {
  res.json(await asignarPaquete({
    operadorId: req.user.sub,
    paqueteId: req.params.id,
    residenteId: req.body?.residenteId,
  }));
}

function csvEscape(value) {
  const str = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

const CSV_HEADERS = [
  'ID', 'Fecha Ingreso', 'Torre', 'Apto', 'Residente', 'Teléfono', 'Proveedor', 'Guía',
  'PIN Proveedor', 'Categoría', 'Costo Servicio', 'Motivo Gratis', 'Estado', 'Franja Horaria', 'Método Pago',
  'Cobro Contra Entrega', 'Valor Contra Entrega', 'Valor Declarado', 'Notas', 'Fecha Entrega',
];

// Solo el operador — historial completo para llevar cuentas o compartir
// con un contador. Nunca incluye el PIN ni las fotos (serían un bloque
// enorme de base64 sin ninguna utilidad dentro de un CSV).
export async function exportCsv(req, res) {
  const { desde, hasta } = req.query;
  const where = {};
  if (desde || hasta) {
    where.fechaIngreso = {};
    if (desde) where.fechaIngreso.gte = new Date(desde);
    if (hasta) where.fechaIngreso.lte = new Date(`${hasta}T23:59:59`);
  }

  const packages = await prisma.package.findMany({
    where,
    include: {
      residente: { select: { nombre: true, telefono: true, torre: true, apto: true } },
      bono: { select: { id: true } },
    },
    orderBy: { fechaIngreso: 'desc' },
  });

  // Igual que en listAll(): el motivo de un costo en $0 (primera entrega
  // vs. bono redimido) sirve para que el contador entienda por qué no se
  // cobró, sin tener que adivinar. Se recalcula sobre TODOS los
  // paquetes (sin el filtro desde/hasta), porque el primer paquete real
  // de un apartamento puede quedar fuera del rango exportado.
  const todos = await prisma.package.findMany({
    select: { id: true, createdAt: true, residenteId: true, residente: { select: { torre: true, apto: true } } },
  });
  const grupos = createdAtPorGrupo(todos);

  const rows = packages.map((p) => {
    const clave = claveDeGrupo(p.residenteId, p.residente?.torre, p.residente?.apto, p.id);
    const primera = !!p.residenteId
      && esPrimeraEntrega({ createdAt: p.createdAt, createdAtDelApto: grupos.get(clave) });
    const motivoGratis = primera ? 'Primera entrega' : p.bono ? 'Bono prepago' : '';
    return [
      p.id, p.fechaIngreso.toISOString(), p.residente?.torre ?? '', p.residente?.apto ?? '',
      p.residente?.nombre ?? p.etiquetaNombre ?? '',
      p.residente?.telefono ?? '', p.proveedor, p.guia, p.pinProveedor || '', p.categoriaPeso, p.costoServicio,
      motivoGratis, p.estado, p.franjaHoraria || '', p.metodoPagoServicio || '',
      p.esContraEntregaProveedor ? 'SI' : 'NO', p.valorProductoProveedor, p.valorDeclarado,
      p.notas || '', p.fechaEntrega ? p.fechaEntrega.toISOString() : '',
    ];
  });

  const csv = [CSV_HEADERS, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="puertaya-ipanema-paquetes.csv"');
  const BOM = '﻿'; // sin esto Excel adivina mal la codificación y daña tildes/ñ
  res.send(BOM + csv);
}

// El operador envía un intento; el servidor compara y responde sí/no.
// El valor correcto del PIN nunca aparece en esta respuesta.
function pinBloqueado(minutos) {
  return new AppError(
    CODIGOS.PIN_BLOQUEADO,
    `Demasiados intentos. Espera ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} e inténtalo de nuevo.`,
    423,
    { minutosRestantes: minutos },
  );
}

export async function confirmDelivery(req, res) {
  const { pin } = req.body;
  const pkg = await prisma.package.findUnique({ where: { id: req.params.id } });
  if (!pkg) throw new AppError(CODIGOS.NO_ENCONTRADO, 'No encontramos ese paquete. Actualiza la lista e intenta de nuevo.', 404);

  // Primero la transición: un paquete no entregable (PREALERTADO, ya ENTREGADO)
  // responde 409 sin gastar ni revelar nada sobre el PIN.
  transicionar(pkg.estado, EVENTOS.ENTREGAR);

  // Límite de intentos (T1.4). Bloqueado: 423 aunque el PIN sea correcto.
  // El fallo se persiste FUERA de la transacción de entrega (si no, el throw lo
  // revertiría). 423 Locked: el paquete queda bloqueado, no es un límite por IP.
  const ahora = new Date();
  const correcto = verifyPin(pin, pkg.pin);
  const r = await registrarIntentoPin(prisma, pkg.id, correcto, ahora);
  if (!r.permitido) {
    throw pinBloqueado(r.minutosRestantes);
  }
  if (!correcto) {
    if (r.bloquear) throw pinBloqueado(r.minutosRestantes);
    throw new AppError(
      CODIGOS.PIN_INCORRECTO,
      `PIN incorrecto. Te quedan ${r.intentosRestantes} ${r.intentosRestantes === 1 ? 'intento' : 'intentos'}.`,
      400,
      { intentosRestantes: r.intentosRestantes },
    );
  }

  // El contador ya quedó en 0 (acierto); aplicarEvento relee el estado y falla
  // con 409 si otro proceso lo cambió.
  const updated = await prisma.$transaction(async (tx) => {
    const actual = await tx.package.findUnique({ where: { id: pkg.id } });
    await aplicarEvento(tx, actual, EVENTOS.ENTREGAR, {
      actorId: req.user.sub,
      cambios: { fechaEntrega: new Date() },
    });
    return tx.package.findUnique({
      where: { id: pkg.id },
      include: { residente: { select: { email: true } } },
    });
  });

  // Un paquete sin residente no tiene a quién agradecer.
  if (updated.residente?.email) sendDeliveryThanksEmail(updated.residente.email, updated);

  const { residente, ...pkgSinResidente } = updated;
  res.json({ ...pkgSinResidente, pin: undefined });
}
