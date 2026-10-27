import { prisma } from '../config/db.js';
import { generatePin, verifyPin, registrarIntentoPin } from '../services/pin.service.js';
import { costoPara } from '../services/tariff.service.js';
import {
  sendNewPackageOperatorEmail, sendPrealertConfirmationEmail, sendDeliveryThanksEmail,
} from '../services/email.service.js';
import { conjuntoDelContexto, operadorDelConjuntoActual, tarifasDe } from '../services/conjunto.service.js';
import { AppError, CODIGOS } from '../domain/errores.js';
import { claveApartamento } from '../services/apartamento.service.js';
import { esPrimeraEntrega, calcularCobro, esCategoriaValida, MOTIVOS_COBRO } from '../domain/cobro.js';
import { EVENTOS, transicionar } from '../domain/paquete.machine.js';
import { aplicarEvento, crearConEvento } from '../services/paquete.service.js';

// La cortesía de primera entrega es por apartamento físico, no por
// cuenta — varias personas del mismo apto pueden registrarse con
// correos distintos (ver claveApartamento). Cuando torre/apto vienen
// incompletos no hay con qué agrupar de forma confiable, así que cada
// cuenta incompleta cae en su propia clave (nunca se agrupa con otra
// cuenta también incompleta, como si fueran el mismo apartamento).
function claveDeGrupo(residenteId, torre, apto) {
  return claveApartamento(torre, apto) || `cuenta:${residenteId}`;
}

// Agrupa los createdAt por apartamento físico (ver claveDeGrupo) para
// alimentar esPrimeraEntrega() en los listados.
function createdAtPorGrupo(paquetes) {
  const grupos = new Map();
  for (const p of paquetes) {
    const clave = claveDeGrupo(p.residenteId, p.residente.torre, p.residente.apto);
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
  const packages = await prisma.package.findMany({
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
    const clave = claveDeGrupo(p.residenteId, p.residente.torre, p.residente.apto);
    return {
      ...p,
      esPrimeraEntrega: esPrimeraEntrega({ createdAt: p.createdAt, createdAtDelApto: grupos.get(clave) }),
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

// Hasta 3 fotos, guardadas como JSON en la misma columna fotoUrl — evita
// una migración de esquema para algo que sigue siendo, en esencia, "la
// evidencia visual de este paquete".
export async function checkin(req, res) {
  const { categoriaPeso, fotos } = req.body;
  if (fotos && (!Array.isArray(fotos) || fotos.length > 3)) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, 'Puedes adjuntar hasta 3 fotos. Quita las que sobren e intenta de nuevo.', 400);
  }

  const actual = await prisma.package.findUnique({
    where: { id: req.params.id },
    select: { residenteId: true, createdAt: true, residente: { select: { torre: true, apto: true } } },
  });
  if (!actual) throw new AppError(CODIGOS.NO_ENCONTRADO, 'No encontramos ese paquete. Actualiza la lista e intenta de nuevo.', 404);

  // Se valida antes de consultar bonos (categoriaPeso es un enum en la base);
  // calcularCobro() la vuelve a validar como defensa.
  if (!esCategoriaValida(categoriaPeso)) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, 'La categoría de peso no es válida. Elige una de la lista.', 400);
  }
  const conjunto = await conjuntoDelContexto();

  // Si este es el primer paquete pre-alertado por cualquier cuenta de
  // este mismo apartamento físico, es la entrega de cortesía por
  // afiliación (campaña de lanzamiento): gratis sin importar la
  // categoría de peso elegida. Si torre/apto vienen incompletos, no hay
  // con qué agrupar de forma confiable — se mantiene el comportamiento
  // anterior, por cuenta sola.
  const clave = claveApartamento(actual.residente.torre, actual.residente.apto);
  let idsRelevantes = [actual.residenteId];
  if (clave) {
    const residentes = await prisma.user.findMany({
      where: { role: 'RESIDENT' },
      select: { id: true, torre: true, apto: true },
    });
    idsRelevantes = residentes
      .filter((u) => claveApartamento(u.torre, u.apto) === clave)
      .map((u) => u.id);
  }

  const primerPaquete = await prisma.package.findFirst({
    where: { residenteId: { in: idsRelevantes } },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });
  // La regla vive en domain/cobro.js; aquí solo se leen los datos.
  const primera = esPrimeraEntrega({
    createdAt: actual.createdAt,
    createdAtDelApto: primerPaquete ? [primerPaquete.createdAt] : [],
  });

  // Todo lo que cambia (bono + estado + evento) va en UNA transacción: si la
  // transición es inválida (409) o alguien más ya recibió el paquete, el crédito
  // consumido se revierte.
  const { pkg, bono } = await prisma.$transaction(async (tx) => {
    const fresco = await tx.package.findUnique({ where: { id: req.params.id } });
    if (!fresco) throw new AppError(CODIGOS.NO_ENCONTRADO, 'No encontramos ese paquete. Actualiza la lista e intenta de nuevo.', 404);
    // Valida la transición ANTES de tocar el bono (un paquete ya recibido o
    // entregado no debe gastar créditos).
    transicionar(fresco.estado, EVENTOS.RECIBIR);

    // Candidatos: bonos del residente en esta categoría con crédito, el más
    // antiguo primero (un bono de otra categoría no aplica).
    let candidatos = [];
    if (!primera && conjunto.bonosHabilitados) {
      candidatos = (await tx.bono.findMany({
        where: { residenteId: actual.residenteId, categoriaPeso },
        orderBy: { createdAt: 'asc' },
      })).filter((b) => b.cantidadUsada < b.cantidadTotal);
    }
    let cobro = calcularCobro({
      tarifas: tarifasDe(conjunto),
      categoria: categoriaPeso,
      esPrimeraEntrega: primera,
      bonosHabilitados: conjunto.bonosHabilitados,
      creditosBono: candidatos.length,
    });

    // Decremento CONDICIONAL: solo si aún queda crédito en la base (count === 1).
    // Si otra transacción concurrente se lo llevó, se prueba el siguiente bono;
    // si ninguno cede crédito, el cobro se recalcula como TARIFA (decisión: no se
    // bloquea al operador en portería; se cobra tarifa normal y queda en el evento).
    let bono = null;
    let usadoTras = 0;
    if (cobro.consumeBono) {
      for (const c of candidatos) {
        const { count } = await tx.bono.updateMany({
          where: { id: c.id, cantidadUsada: { lt: c.cantidadTotal } },
          data: { cantidadUsada: { increment: 1 } },
        });
        if (count === 1) {
          bono = c;
          usadoTras = (await tx.bono.findUnique({ where: { id: c.id } })).cantidadUsada;
          break;
        }
      }
      if (!bono) {
        cobro = { monto: tarifasDe(conjunto)[categoriaPeso], motivo: MOTIVOS_COBRO.TARIFA, consumeBono: false };
      }
    }

    const pkg = await aplicarEvento(tx, fresco, EVENTOS.RECIBIR, {
      actorId: req.user.sub,
      datos: { categoriaPeso, motivoCobro: cobro.motivo, monto: cobro.monto, bonoId: bono?.id ?? null },
      cambios: {
        categoriaPeso,
        costoServicio: cobro.monto,
        bonoId: bono?.id || null,
        fotoUrl: fotos && fotos.length ? JSON.stringify(fotos) : null,
      },
    });
    return { pkg, bono: bono && { id: bono.id, quedan: bono.cantidadTotal - usadoTras }, cobro };
  });

  res.json({
    ...pkg,
    pin: undefined,
    esPrimeraEntrega: primera,
    bonoAplicado: bono,
  });
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
    const clave = claveDeGrupo(p.residenteId, p.residente.torre, p.residente.apto);
    const primera = esPrimeraEntrega({ createdAt: p.createdAt, createdAtDelApto: grupos.get(clave) });
    const motivoGratis = primera ? 'Primera entrega' : p.bono ? 'Bono prepago' : '';
    return [
      p.id, p.fechaIngreso.toISOString(), p.residente.torre, p.residente.apto, p.residente.nombre,
      p.residente.telefono, p.proveedor, p.guia, p.pinProveedor || '', p.categoriaPeso, p.costoServicio,
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

  sendDeliveryThanksEmail(updated.residente.email, updated);

  const { residente, ...pkgSinResidente } = updated;
  res.json({ ...pkgSinResidente, pin: undefined });
}
