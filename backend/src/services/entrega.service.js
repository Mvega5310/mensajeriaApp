// Entrega por lote (T2.5): verificar PIN -> token de entrega -> confirmar.
// Reglas puras en domain/entregaLote.js y domain/tokenEntrega.js; aquí solo
// lectura/escritura. Ver README ("Entrega por lote") para las decisiones.

import { prisma } from '../config/db.js';
import { AppError, CODIGOS } from '../domain/errores.js';
import { EVENTOS } from '../domain/paquete.machine.js';
import { METODOS_PAGO, esMetodoPagoValido } from '../domain/pago.js';
import { etiquetaApartamento } from '../domain/apartamento.js';
import { seleccionarLote, candidatosPorDesempate, ESTADOS_ENTREGABLES } from '../domain/entregaLote.js';
import { firmarTokenEntrega, verificarTokenEntrega } from '../domain/tokenEntrega.js';
import { registrarIntentoPin } from './pin.service.js';
import { aplicarEvento } from './paquete.service.js';
import { enSegundoPlano } from './avisos.service.js';
import { conjuntoDelContexto } from './conjunto.service.js';

// Secreto dedicado si existe; si no, JWT_SECRET (el HMAC lleva prefijo de dominio).
const secretoEntrega = () => process.env.ENTREGA_SECRET || process.env.JWT_SECRET;

const pinBloqueado = (minutos) => new AppError(
  CODIGOS.PIN_BLOQUEADO,
  `Demasiados intentos. Espera ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} e inténtalo de nuevo.`,
  423,
  { minutosRestantes: minutos },
);

/**
 * @param {{operadorId:string, pin:string, residenteId?:string, apto?:string, limitador:object, res?:object}} p
 * limitador: crearLimitadorMemoria; clave por operador (20 fallos / 10 min). `intentar` se llama
 * SÍNCRONO antes de cualquier await (reserva atómica).
 */
export async function verificarPinLote({ operadorId, conjuntoId, pin, residenteId, apto, limitador, ahora = new Date() }) {
  const clave = `entrega:${operadorId}`;
  const intento = limitador.intentar(clave);
  if (!intento.permitido) {
    throw Object.assign(new AppError(
      CODIGOS.DEMASIADOS_INTENTOS,
      `Muchos PIN incorrectos seguidos. Espera ${intento.minutosRestantes} ${intento.minutosRestantes === 1 ? 'minuto' : 'minutos'} o entrega desde Pendientes.`,
      429,
      { minutosRestantes: intento.minutosRestantes },
    ), { retryAfter: intento.segundosRestantes });
  }

  const entregables = await prisma.package.findMany({
    where: { estado: { in: [...ESTADOS_ENTREGABLES] }, residenteId: { not: null } },
    include: { residente: { select: { id: true, nombre: true, torre: true, apto: true } } },
  });
  const sel = seleccionarLote({ entregables, pin, residenteId, apto });

  if (sel.tipo === 'NINGUNO') {
    // Fallo ya contado por la reserva del operador. Si el operador indicó el
    // apartamento (residenteId/apto), el fallo también cuenta contra el bloqueo
    // por paquete de T1.4, igual que /confirm-delivery: así el límite por paquete
    // rige también en lote. Sin apartamento no hay a qué paquete atribuirlo.
    for (const p of candidatosPorDesempate({ entregables, residenteId, apto })) {
      const r = await registrarIntentoPin(prisma, p.id, false, ahora);
      if (r && (!r.permitido || r.bloquear)) throw pinBloqueado(r.minutosRestantes);
    }
    throw new AppError(CODIGOS.PIN_INCORRECTO, 'PIN incorrecto. Revísalo con el residente e inténtalo de nuevo.', 400);
  }
  // El PIN existe: no es un fallo, se devuelve la reserva.
  limitador.devolver(clave, intento.reserva);

  if (sel.tipo === 'AMBIGUO') {
    throw new AppError(
      CODIGOS.PIN_AMBIGUO,
      'Ese PIN coincide con más de un apartamento. Elige el apartamento del residente.',
      409,
      { opciones: sel.opciones },
    );
  }

  // Bloqueo por paquete (de los paquetes cuyo PIN coincidió).
  const bloqueado = sel.coincidentes.find((p) => p.pinBloqueadoHasta && p.pinBloqueadoHasta > ahora);
  if (bloqueado) {
    throw pinBloqueado(Math.max(1, Math.ceil((bloqueado.pinBloqueadoHasta - ahora) / 60000)));
  }
  // Acierto: reinicia el contador de cada paquete coincidente (CAS fuera de tx).
  for (const p of sel.coincidentes) {
    const r = await registrarIntentoPin(prisma, p.id, true, ahora);
    if (r && !r.permitido) throw pinBloqueado(r.minutosRestantes);
  }

  const ids = sel.lote.map((p) => p.id);
  const eventos = await prisma.paqueteEvento.findMany({
    where: { paqueteId: { in: ids }, tipo: { in: [EVENTOS.RECIBIR, EVENTOS.ASIGNAR] } },
    orderBy: { creadoEn: 'desc' },
  });
  const motivo = new Map();
  for (const e of eventos) if (!motivo.has(e.paqueteId)) motivo.set(e.paqueteId, e.datos?.motivoCobro ?? null);

  const paquetes = sel.lote.map((p) => ({
    id: p.id,
    categoriaPeso: p.categoriaPeso,
    transportadora: p.transportadora,
    proveedor: p.proveedor,
    recibidoEn: p.recibidoEn,
    costo: p.costoServicio,
    motivoCobro: motivo.get(p.id) ?? null,
    estado: p.estado,
  }));
  const { token, venceEn } = firmarTokenEntrega(
    { operadorId, conjuntoId, residenteId: sel.residente.id, paqueteIds: ids },
    { secreto: secretoEntrega(), ahora },
  );
  return {
    residente: {
      id: sel.residente.id,
      nombre: sel.residente.nombre,
      etiquetaApto: etiquetaApartamento(sel.residente.torre, sel.residente.apto),
    },
    paquetes,
    total: paquetes.reduce((s, p) => s + p.costo, 0),
    metodosPago: [...METODOS_PAGO],
    tokenEntrega: token,
    venceEn,
  };
}

const tokenInvalido = (vencido) => new AppError(
  CODIGOS.SESION_INVALIDA,
  vencido
    ? 'La verificación del PIN venció. Vuelve a ingresar el PIN.'
    : 'No pudimos validar la verificación del PIN. Vuelve a ingresar el PIN.',
  401,
);

export async function confirmarLote({ operadorId, conjuntoId, tokenEntrega, paqueteIds, metodoPago, notificador, ahora = new Date() }) {
  if (!esMetodoPagoValido(metodoPago)) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, 'Elige el método de pago: efectivo o transferencia.', 400, { campo: 'metodoPago', validos: [...METODOS_PAGO] });
  }
  if (!Array.isArray(paqueteIds) || !paqueteIds.length || !paqueteIds.every((x) => typeof x === 'string')) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, 'Elige al menos un paquete para entregar.', 400, { campo: 'paqueteIds' });
  }
  const t = verificarTokenEntrega(tokenEntrega, { secreto: secretoEntrega(), ahora });
  if (!t.ok) throw tokenInvalido(t.motivo === 'VENCIDO');
  if (t.operadorId !== operadorId || t.conjuntoId !== conjuntoId) {
    throw new AppError(CODIGOS.PROHIBIDO, 'Esta verificación pertenece a otro operador. Vuelve a ingresar el PIN.', 403);
  }
  const ids = [...new Set(paqueteIds)];
  if (!ids.every((id) => t.paqueteIds.includes(id))) {
    throw new AppError(CODIGOS.PROHIBIDO, 'Hay paquetes que no pertenecen a esta verificación. Vuelve a ingresar el PIN.', 403);
  }
  ids.sort(); // mismo orden de bloqueo en toda transacción: evita interbloqueos

  const resultado = await prisma.$transaction(async (tx) => {
    let total = 0;
    for (const id of ids) {
      const actual = await tx.package.findUnique({ where: { id } });
      if (!actual) {
        throw new AppError(CODIGOS.TRANSICION_INVALIDA, 'Un paquete cambió mientras entregabas. Vuelve a ingresar el PIN.', 409);
      }
      await aplicarEvento(tx, actual, EVENTOS.ENTREGAR, {
        actorId: operadorId,
        cambios: { metodoPago, fechaEntrega: ahora },
        datos: { metodoPago, lote: ids.length },
      });
      total += actual.costoServicio;
    }
    return { entregados: ids.length, total, metodoPago };
  });

  // Punto único post-commit para efectos secundarios (T2.4 conecta aquí el
  // correo de agradecimiento del lote). NO lanzar desde aquí: la entrega ya
  // quedó confirmada.
  await despuesDeEntregarLote({ notificador, residenteId: t.residenteId, paqueteIds: ids });

  return resultado;
}

// Correo de agradecimiento del lote (un solo correo con todos los paquetes).
// Nunca lanza: la entrega ya quedó confirmada; un fallo solo queda en el log.
async function despuesDeEntregarLote({ notificador, residenteId, paqueteIds }) {
  if (!notificador) return;
  try {
    const residente = await prisma.user.findUnique({
      where: { id: residenteId },
      select: { nombre: true, email: true },
    });
    if (!residente?.email) return;
    const [paquetes, conjunto] = await Promise.all([
      // Solo lo que usa el correo: nada de fotoUrl (puede pesar cientos de KB) ni PIN.
      prisma.package.findMany({ where: { id: { in: paqueteIds } }, select: { id: true, proveedor: true, categoriaPeso: true } }),
      conjuntoDelContexto(),
    ]);
    enSegundoPlano('entrega', () => notificador.agradecerEntrega({ residente, paquetes, conjunto }));
  } catch (err) {
    console.error('Aviso de entrega por lote no enviado:', err?.code ?? err?.name);
  }
}

