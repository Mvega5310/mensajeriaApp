// Entrega por lote (T2.5): verificar PIN -> token de entrega -> confirmar.
// Reglas puras en domain/entregaLote.js y domain/tokenEntrega.js; aquí solo
// lectura/escritura. Ver README ("Entrega por lote") para las decisiones.

import { prisma } from '../config/db.js';
import { AppError, CODIGOS } from '../domain/errores.js';
import { EVENTOS } from '../domain/paquete.machine.js';
import { METODOS_PAGO, esMetodoPagoValido } from '../domain/pago.js';
import { etiquetaApartamento, interpretarBusqueda } from '../domain/apartamento.js';
import { normalizarApto } from './apartamento.service.js';
import { seleccionarLote, candidatosPorDesempate, claveDeApartamento, seleccionPorDuenoDelPin, ESTADOS_ENTREGABLES } from '../domain/entregaLote.js';
import { firmarTokenEntrega, verificarTokenEntrega } from '../domain/tokenEntrega.js';
import { registrarIntentoPin } from './pin.service.js';
import { aplicarEvento, selectSinFoto } from './paquete.service.js';
import { enSegundoPlano } from './avisos.service.js';
import { conjuntoDelContexto } from './conjunto.service.js';
import { vistaResidente, SELECT_DOMICILIO_PAQUETE, filtroPaquetePorApto } from './domicilio.service.js';
import { contactoParaNotificar } from './usuario.service.js';

// Secreto dedicado si existe; si no, JWT_SECRET (el HMAC lleva prefijo de dominio).
const secretoEntrega = () => process.env.ENTREGA_SECRET || process.env.JWT_SECRET;

const SELECT_ENTREGABLE = {
  ...selectSinFoto({ conPin: true }),
  // La dirección (lo que ve el operador) sale del Domicilio; la cuenta enlazada solo es
  // el respaldo de paquetes anteriores a PLAN-conjunto S1.1.
  domicilio: SELECT_DOMICILIO_PAQUETE,
  residente: { select: { id: true, nombre: true, torre: true, apto: true } },
};

// Lee paquetes entregables y los deja con la forma `residente` {id, nombre, torre, apto}
// que usa el dominio del lote (desde el Domicilio del paquete).
async function leerEntregables(where) {
  const filas = await prisma.package.findMany({ where, select: SELECT_ENTREGABLE });
  return filas.map(({ domicilio, residente, ...p }) => ({ ...p, domicilio, residente: vistaResidente({ ...p, domicilio, residente }) }));
}
const ENTREGABLES = { estado: { in: [...ESTADOS_ENTREGABLES] }, residenteId: { not: null } };

// Filtro de residente según lo que indicó el operador (residenteId y/o apto). El
// filtro por apto en la base solo acota ("contains" de los dígitos); la igualdad
// exacta la aplican coincideApto/seleccionarLote en memoria.
function filtroApuntado({ residenteId, apto }) {
  const f = {};
  if (residenteId) f.residenteId = residenteId;
  if (apto) {
    const q = interpretarBusqueda(apto);
    // Sin dígitos de apto, coincideApto nunca acierta: no hay candidatos.
    if (q.apto) Object.assign(f, filtroPaquetePorApto(q.apto));
    else f.id = { in: [] };
  }
  return f;
}

/** Paquetes entregables que el operador apuntó (sin mirar el PIN), para contar el fallo por paquete. */
async function entregablesApuntados({ residenteId, apto }) {
  if (!residenteId && !apto) return [];
  return leerEntregables({ ...ENTREGABLES, ...filtroApuntado({ residenteId, apto }) });
}

/**
 * Entregables relevantes para un PIN: los que coinciden (filtrados en la base) más
 * los demás entregables de sus apartamentos (para armar el lote).
 */
async function entregablesParaPin({ pin, residenteId, apto }) {
  const coincidentes = await leerEntregables({ ...ENTREGABLES, pin, ...filtroApuntado({ residenteId, apto }) });
  if (!coincidentes.length) return [];
  // Un solo apartamento coincide en el caso normal; si hay varios es AMBIGUO y no se arma lote.
  const claves = new Set(coincidentes.map((p) => claveDeApartamento(p.residente)));
  if (claves.size > 1) return coincidentes;
  const aptos = [...new Set(coincidentes.map((p) => normalizarApto(p.residente.apto)).filter(Boolean))];
  const mismoApto = aptos.length
    ? await leerEntregables({ ...ENTREGABLES, OR: aptos.flatMap((a) => filtroPaquetePorApto(a).OR) })
    : [];
  const porId = new Map([...coincidentes, ...mismoApto].map((p) => [p.id, p]));
  // Cuentas con torre/apto incompletos: su "apartamento" es la cuenta sola.
  const faltan = coincidentes.filter((p) => !normalizarApto(p.residente.apto)).map((p) => p.residenteId);
  if (faltan.length) {
    for (const p of await leerEntregables({ ...ENTREGABLES, residenteId: { in: faltan } })) porId.set(p.id, p);
  }
  return [...porId.values()];
}

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

  // Sin fotoUrl desde la consulta, y el PIN se compara EN LA BASE: primero se buscan
  // los paquetes entregables con ese PIN (+ residente/apto si el operador lo indicó);
  // luego se cargan los entregables solo de los apartamentos de esos paquetes (el
  // lote es por apartamento). Antes se traían todos los entregables del conjunto.
  const entregables = await entregablesParaPin({ pin, residenteId, apto });
  const sel = seleccionarLote({ entregables, pin, residenteId, apto });

  if (sel.tipo === 'NINGUNO') {
    // Fallo ya contado por la reserva del operador. Si el operador indicó el
    // apartamento (residenteId/apto), el fallo también cuenta contra el bloqueo
    // por paquete de T1.4, igual que /confirm-delivery: así el límite por paquete
    // rige también en lote. Sin apartamento no hay a qué paquete atribuirlo.
    const apuntados = await entregablesApuntados({ residenteId, apto });
    for (const p of candidatosPorDesempate({ entregables: apuntados, residenteId, apto })) {
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

  // Revisión S3.2: si el lote mezcla personas del mismo apartamento, solo se preseleccionan
  // los del Domicilio dueño del PIN y cada paquete trae su `nombreRecibe`.
  const { seleccionados, variasPersonas } = seleccionPorDuenoDelPin({ lote: sel.lote, coincidentes: sel.coincidentes });
  const paquetes = sel.lote.map((p) => ({
    id: p.id,
    nombreRecibe: p.residente.nombre,
    seleccionado: seleccionados.has(p.id),
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
    variasPersonas,
    // Total de lo preseleccionado (con una sola persona, todo el lote).
    total: paquetes.filter((p) => p.seleccionado).reduce((s, p) => s + p.costo, 0),
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
      const actual = await tx.package.findUnique({ where: { id }, select: selectSinFoto() });
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
    // Correo de la cuenta (uso interno; el id viene del token de entrega firmado).
    const residente = await contactoParaNotificar(residenteId);
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

