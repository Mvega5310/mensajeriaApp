import { prisma } from '../config/db.js';
import { generatePin, verifyPin, registrarIntentoPin } from '../services/pin.service.js';
import { costoPara } from '../services/tariff.service.js';
import { enSegundoPlano, enviarAvisoLlegada } from '../services/avisos.service.js';
import { conjuntoDelContexto, operadorDelConjuntoActual } from '../services/conjunto.service.js';
import { AppError, CODIGOS } from '../domain/errores.js';
import { esCategoriaValida } from '../domain/cobro.js';
import { validarFotos, mensajeMaxFotos } from '../domain/recepcion.js';
import { resolverCobro, idsPrimeraEntrega } from '../services/cobro.service.js';
import { EVENTOS, ESTADOS, transicionar } from '../domain/paquete.machine.js';
import { aplicarEvento, crearConEvento, motivosDeCobro, selectSinFoto } from '../services/paquete.service.js';
import { recibirPaquete, asignarPaquete, armarRespuesta } from '../services/recepcion.service.js';
import { subirFotos, registrarFotos, descartarSubidas, fotosDelPaquete } from '../services/fotos.service.js';
import { decodificarDataUri } from '../services/almacen/index.js';
import { rangoHoyBogota, parsearFiltroFecha } from '../domain/fechas.js';
import { interpretarBusqueda } from '../domain/apartamento.js';
import { contactoParaNotificar, obtenerCuentaPropia } from '../services/usuario.service.js';
import {
  crearOReutilizarDomicilio, domicilioDePersona, vistaResidente, nulaSiVacia,
  SELECT_DOMICILIO_PAQUETE, porCadaConjuntoDePersona, listarDomiciliosDePersona, domicilioPropioPorId,
  guardarDireccionDePersona, direccionDeCuerpo, usarDomicilio,
} from '../services/domicilio.service.js';
import { runWithTenant } from '../config/tenantContext.js';
import { conjuntoActivoPorSlug } from '../services/conjunto.service.js';

// Residente: crea una pre-alerta. PLAN-conjunto S1.3 — el conjunto es el de la dirección
// elegida: `{ domicilioId }` (una propia, en cualquiera de sus conjuntos), o `{ conjunto
// (slug), torre, apto, nombreRecibe?, telefono? }` (crea o reutiliza la dirección en ese
// conjunto), o nada (la dirección más reciente: regla de oro, 0 campos). Todo corre en el
// contexto de ESE conjunto y el aviso va al operador de ESE conjunto. Nombre/teléfono ya no
// se piden en el formulario: salen de la dirección/cuenta, así que no pueden falsificarse
// escribiendo el nombre de otro residente.
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
    proveedor: proveedorBody, transportadora: transportadoraBody, guia, categoriaPeso, esContraEntregaProveedor, valorProductoProveedor,
    valorDeclarado, franjaHoraria, metodoPagoServicio, notas, pinProveedor,
  } = req.body;
  const transportadora = typeof transportadoraBody === 'string' ? transportadoraBody.trim() : '';
  if (transportadoraBody !== undefined && transportadoraBody !== null && typeof transportadoraBody !== 'string') {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, 'La transportadora no es válida. Escríbela como texto.', 400);
  }
  if (transportadora.length > 60) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, 'La transportadora puede tener hasta 60 caracteres.', 400);
  }
  // `proveedor` (tienda) sigue siendo obligatorio, salvo que venga la transportadora
  // (T2.8: el residente puede avisar solo "quién lo trae"); entonces va "Sin especificar".
  const proveedor = typeof proveedorBody === 'string' && proveedorBody.trim()
    ? proveedorBody.trim()
    : (transportadora ? 'Sin especificar' : '');
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
  const destino = await destinoDePrealerta(req.user.sub, req.body);
  const correr = (fn) => (destino.conjuntoId
    ? runWithTenant({ conjuntoId: destino.conjuntoId, role: 'RESIDENT' }, fn)
    : fn()); // sin ninguna dirección (cuenta anterior a S1.1): conjunto base
  const pkg = await correr(() => crearPrealertaEn(req, destino, {
    proveedor, transportadora, guia, categoriaPeso, esContraEntregaProveedor, valorProductoProveedor,
    valorDeclarado, franjaHoraria, metodoPagoServicio, notas, pinProveedor,
  }));
  res.status(201).json(pkg);
}

// Dentro del contexto del conjunto de la dirección elegida.
async function crearPrealertaEn(req, destino, d) {
  const {
    proveedor, transportadora, guia, categoriaPeso, esContraEntregaProveedor, valorProductoProveedor,
    valorDeclarado, franjaHoraria, metodoPagoServicio, notas, pinProveedor,
  } = d;
  const costoServicio = await costoPara(categoriaPeso || 'ESTANDAR');
  const domicilio = await domicilioParaPrealerta(req.user.sub, destino);

  const pkg = await prisma.$transaction((tx) => crearConEvento(tx, EVENTOS.PREALERTAR, {
    actorId: req.user.sub,
    data: {
      residenteId: req.user.sub,
      domicilioId: domicilio.id,
      proveedor,
      transportadora: transportadora || null,
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

  // Avisos automáticos: no bloquean ni tumban la respuesta si falla el envío.
  // Correo del residente: de su cuenta (uso interno). El operador recibe solo la dirección.
  const residente = await contactoParaNotificar(req.user.sub);
  const residenteParaOperador = {
    id: req.user.sub, nombre: domicilio.nombreRecibe, telefono: domicilio.telefono,
    torre: nulaSiVacia(domicilio.torre), apto: nulaSiVacia(domicilio.apto),
  };
  const conjunto = await conjuntoDelContexto();
  const { notificador } = req.app.locals;
  // Operador DEL CONJUNTO del residente (no el primero de la tabla). Si no hay
  // operador en el conjunto, no se envía correo y no se lanza error.
  const operador = await operadorDelConjuntoActual();
  if (operador) {
    enSegundoPlano('nuevaPrealerta', () => notificador.avisarNuevaPrealerta({ operador, residente: residenteParaOperador, paquete: pkg, conjunto }));
  }
  enSegundoPlano('prealerta', () => notificador.confirmarPrealerta({ residente, paquete: pkg, conjunto }));

  return pkg;
}

const sinValor = (v) => v === undefined || v === null || v === '';

// A qué conjunto/dirección va la pre-alerta (ver comentario de createPrealert). Resuelve el
// conjunto SIN abrir contexto: devuelve { conjuntoId, domicilio } (dirección ya existente),
// { conjuntoId, direccion } (a crear) o { conjuntoId: null } (cuenta sin ninguna dirección).
async function destinoDePrealerta(usuarioId, body) {
  const { domicilioId, conjunto: slug } = body ?? {};
  if (!sinValor(domicilioId)) {
    const d = await domicilioPropioPorId(usuarioId, domicilioId);
    if (!d) throw new AppError(CODIGOS.NO_ENCONTRADO, 'No encontramos esa dirección. Elige una de tus direcciones guardadas.', 404);
    if (!sinValor(slug) && String(slug).trim() !== d.conjunto.slug) {
      throw new AppError(CODIGOS.DATOS_INVALIDOS, 'La dirección no es de ese conjunto.', 400, { campo: 'conjunto' });
    }
    return { conjuntoId: d.conjunto.id, domicilio: d };
  }
  if (!sinValor(slug)) {
    const c = await conjuntoActivoPorSlug(slug);
    if (sinValor(body.torre) && sinValor(body.apto)) {
      // Solo el conjunto: la dirección más reciente de la persona ahí (si no tiene, se pide).
      const propia = (await listarDomiciliosDePersona(usuarioId)).find((x) => x.conjunto.id === c.id);
      if (propia) return { conjuntoId: c.id, domicilio: propia };
    }
    return { conjuntoId: c.id, direccion: direccionDeCuerpo(body) };
  }
  // Regla de oro: sin nada en la solicitud, la dirección más reciente de la persona.
  const [reciente] = await listarDomiciliosDePersona(usuarioId);
  return reciente ? { conjuntoId: reciente.conjunto.id, domicilio: reciente } : { conjuntoId: null };
}

// Ya dentro del contexto del conjunto elegido. Deja la dirección como la última usada y el
// conjunto como el "último conjunto" de la cuenta.
async function domicilioParaPrealerta(usuarioId, destino) {
  if (destino.domicilio) return usarDomicilio(usuarioId, destino.domicilio.id);
  if (destino.direccion) return guardarDireccionDePersona(usuarioId, destino.direccion);
  // Cuenta anterior a S1.1 sin ninguna dirección: se crea desde los datos de su cuenta.
  const existente = await domicilioDePersona(usuarioId);
  if (existente) return usarDomicilio(usuarioId, existente.id);
  const cuenta = await obtenerCuentaPropia(usuarioId);
  if (!cuenta) throw new AppError(CODIGOS.NO_ENCONTRADO, 'No encontramos tu usuario. Inicia sesión de nuevo.', 404);
  return crearOReutilizarDomicilio({
    usuarioId, torre: cuenta.torre, apto: cuenta.apto, nombreRecibe: cuenta.nombre, telefono: cuenta.telefono,
  });
}

// Residente: solo ve sus propios paquetes (nunca los de otros) — e
// incluye siempre su PIN, porque lo necesita cada vez que abre la puerta.
// fotoUrl NUNCA viaja aquí: puede pesar cientos de KB por paquete (hasta
// 3 fotos en base64) y esta lista se pide cada 20s mientras el residente
// tiene la pestaña abierta — mandarla en cada sondeo fue lo que saturó
// el servidor en producción. Se pide aparte, solo al abrir el detalle
// de un paquete puntual (ver getFoto()).
export async function listMine(req, res) {
  // PLAN-conjunto S1.2: los paquetes de la persona en TODOS sus conjuntos. Una consulta por
  // conjunto, cada una dentro del runWithTenant de ese conjunto (la extensión filtra; no hay
  // GLOBAL_LOOKUP ni SQL crudo). Cada paquete trae su conjunto ({ slug, nombre }).
  const filas = await porCadaConjuntoDePersona(req.user.sub, async (c) => {
    const packages = await prisma.package.findMany({
      where: { residenteId: req.user.sub },
      select: selectSinFoto({ conPin: true }), // la foto ni se lee de la base
      orderBy: { createdAt: 'desc' },
    });
    // motivoCobro (CORTESIA/BONO/...) sale del último evento RECIBIR/ASIGNAR, igual que
    // en listAll y en /api/p/paquetes: el historial no debe inferir "Gratis" por costo 0.
    const motivos = await motivosDeCobro(packages.map((p) => p.id));
    return packages.map((p) => ({ ...p, motivoCobro: motivos.get(p.id) ?? null, conjunto: { slug: c.slug, nombre: c.nombre } }));
  });
  filas.sort((a, b) => b.createdAt - a.createdAt);
  res.json(filas);
}

// `residente` que ve el operador en listados/CSV: solo lo que hay en el Domicilio.
function residenteParaOperador(p) {
  const v = vistaResidente(p);
  return v ? { nombre: v.nombre, telefono: v.telefono, torre: v.torre, apto: v.apto } : null;
}

const MODALIDADES_ENTREGA = ['DOMICILIO', 'RECOGER'];
const POR_PAGINA_DEFECTO = 20;
const POR_PAGINA_MAX = 100;

function enteroPositivo(valor, campo, max) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || (max && n > max)) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS,
      max ? `El valor de ${campo} debe ser un número entre 1 y ${max}.` : `El valor de ${campo} debe ser un número entero mayor que 0.`,
      400, { campo });
  }
  return n;
}

// Filtros de la bitácora (T2.7). Todos son opcionales y se combinan con AND.
//  - estado: uno de ESTADOS, o varios separados por coma.
//  - desde/hasta: "YYYY-MM-DD" (día de Bogotá, `hasta` incluye todo ese día) o ISO completo.
//    Se comparan con la fecha efectiva del paquete: `recibidoEn` si ya llegó; si no
//    (pre-alerta, aún sin recibir) `createdAt`.
//  - q: apto ("304", "T2 30" = prefijo), nombre del residente o de la etiqueta, o guía.
function filtrosListado(query) {
  const { estado, desde, hasta, q } = query;
  const y = [];
  if (estado !== undefined) {
    // Uno o varios separados por coma ("EN_RECEPCION,PROGRAMADO"): Pendientes pide solo
    // los estados abiertos y así no lee toda la historia.
    const lista = typeof estado === 'string' ? estado.split(',').map((e) => e.trim()) : [];
    if (!lista.length || !lista.every((e) => Object.values(ESTADOS).includes(e))) {
      throw new AppError(CODIGOS.DATOS_INVALIDOS, 'El estado no es válido. Elige uno de la lista.', 400, { campo: 'estado' });
    }
    y.push({ estado: lista.length === 1 ? lista[0] : { in: lista } });
  }
  const rango = {};
  for (const [campo, tipo, op] of [['desde', 'desde', 'gte'], ['hasta', 'hasta', 'lt']]) {
    if (query[campo] === undefined) continue;
    const f = parsearFiltroFecha(query[campo], tipo);
    if (!f) throw new AppError(CODIGOS.DATOS_INVALIDOS, `La fecha "${campo}" no es válida. Usa el formato AAAA-MM-DD.`, 400, { campo });
    rango[op] = f;
  }
  if (rango.gte || rango.lt) {
    y.push({ OR: [{ recibidoEn: rango }, { recibidoEn: null, createdAt: rango }] });
  }
  const texto = typeof q === 'string' ? q.trim() : '';
  if (texto) {
    const f = interpretarBusqueda(texto);
    // El nombre/dirección que se busca es el del Domicilio (lo único de la persona que ve
    // el operador); la cuenta enlazada solo vale para paquetes anteriores a S1.1 sin Domicilio.
    const o = [
      { guia: { contains: texto, mode: 'insensitive' } },
      { etiquetaNombre: { contains: texto, mode: 'insensitive' } },
      { domicilio: { is: { nombreRecibe: { contains: texto, mode: 'insensitive' } } } },
      { domicilioId: null, residente: { is: { nombre: { contains: texto, mode: 'insensitive' } } } },
    ];
    if (f.apto || f.torre) {
      const d = {};
      if (f.apto) d.apto = { startsWith: f.apto };
      if (f.torre) d.torre = { in: [f.torre, `T${f.torre}`, `TORRE ${f.torre}`], mode: 'insensitive' };
      o.push({ domicilio: { is: d } });
      const r = [{ role: 'RESIDENT' }];
      if (f.apto) r.push({ apto: { startsWith: f.apto } });
      if (f.torre) r.push({ torre: { in: [`TORRE ${f.torre}`, `T${f.torre}`, f.torre], mode: 'insensitive' } });
      o.push({ domicilioId: null, residente: { is: { AND: r } } });
    }
    y.push({ OR: o });
  }
  return y.length ? { AND: y } : undefined;
}

// Operador: ve todos los paquetes, pero el PIN nunca viaja hacia esta
// vista — y tampoco fotoUrl, por la misma razón que en listMine().
// Compatibilidad: sin `pagina` responde un ARREGLO (como siempre, ahora con los
// filtros opcionales). Con `pagina` (y `porPagina`, 1-100, 20 por defecto)
// responde { items, total, pagina, porPagina } (la bitácora).
export async function listAll(req, res) {
  const where = filtrosListado(req.query);
  const paginado = req.query.pagina !== undefined || req.query.porPagina !== undefined;
  let paginacion = {};
  let pagina; let porPagina;
  if (paginado) {
    pagina = enteroPositivo(req.query.pagina ?? 1, 'pagina');
    porPagina = req.query.porPagina === undefined ? POR_PAGINA_DEFECTO : enteroPositivo(req.query.porPagina, 'porPagina', POR_PAGINA_MAX);
    paginacion = { skip: (pagina - 1) * porPagina, take: porPagina };
  }
  const [packages, total] = await Promise.all([
    prisma.package.findMany({
      where,
      // Sin fotoUrl ni pin (ni bonoId) desde la consulta: no se leen de la base.
      select: {
        ...selectSinFoto({ quitar: ['bonoId'] }),
        domicilio: SELECT_DOMICILIO_PAQUETE,
        // Solo para paquetes anteriores a S1.1 sin Domicilio.
        residente: { select: { nombre: true, telefono: true, torre: true, apto: true } },
        bono: { select: { id: true, categoriaPeso: true, cantidadTotal: true, cantidadUsada: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...paginacion,
    }),
    paginado ? prisma.package.count({ where }) : Promise.resolve(0),
  ]);

  // La cortesía es del PRIMER PAQUETE DEL APARTAMENTO QUE SE COBRA (no del más
  // antiguo en crearse; ver domain/cobro.js): se marca para que el operador vea
  // de un vistazo a quién no debe cobrarle. Coherente con resolverCobro().
  const primeras = await idsPrimeraEntrega({
    residenteIds: packages.map((p) => p.residenteId), domicilioIds: packages.map((p) => p.domicilioId),
  });

  const items = packages.map(({ domicilio, residente, ...p }) => ({
    ...p,
    // Misma forma de siempre ({ nombre, telefono, torre, apto }), tomada del Domicilio.
    residente: residenteParaOperador({ ...p, domicilio, residente }),
    // Sin residente no hay cortesía de primera entrega. `etiquetaNombre` ya
    // viaja en `p`: la vista lo muestra cuando `residente` es null.
    esPrimeraEntrega: primeras.has(p.id),
  }));
  res.json(paginado ? { items, total, pagina, porPagina } : items);
}

// Operador: contadores livianos para la cabecera de Recibir (solo `count`, sin filas).
// "Hoy" = día calendario de America/Bogota.
export async function resumen(req, res) {
  const { inicio, fin } = rangoHoyBogota();
  const hoy = (campo) => ({ [campo]: { gte: inicio, lt: fin } });
  const [recibidos, entregados, porEntregar, sinAsignar] = await Promise.all([
    prisma.package.count({ where: hoy('recibidoEn') }),
    prisma.package.count({ where: { estado: ESTADOS.ENTREGADO, ...hoy('fechaEntrega') } }),
    prisma.package.count({ where: { estado: { in: [ESTADOS.EN_RECEPCION, ESTADOS.PROGRAMADO] } } }),
    prisma.package.count({ where: { estado: ESTADOS.SIN_ASIGNAR } }),
  ]);
  res.json({ hoy: { recibidos, entregados }, porEntregar, sinAsignar });
}

// Operador: un paquete con el mismo shape que `paquete` de la recepción, más el
// `aviso` reconstruido (enlace firmado nuevo; nunca PIN ni fotos).
export async function getById(req, res) {
  res.json(await armarRespuesta(req.params.id, await conjuntoDelContexto()));
}

// Fotos aparte del listado general (ver comentario en listMine/listAll):
// el residente solo puede pedir las de su propio paquete; el operador,
// las de cualquiera.
export async function getFoto(req, res) {
  const pkg = await prisma.package.findUnique({
    where: { id: req.params.id },
    select: { id: true, fotoUrl: true, residenteId: true },
  });
  if (!pkg) throw new AppError(CODIGOS.NO_ENCONTRADO, 'No encontramos ese paquete. Actualiza la lista e intenta de nuevo.', 404);
  if (req.user.role === 'RESIDENT' && pkg.residenteId !== req.user.sub) {
    throw new AppError(CODIGOS.PROHIBIDO, 'No tienes permiso para ver este paquete.', 403);
  }
  // Nuevas: URLs firmadas del almacén (expiran en 10 min). Antiguas: las de fotoUrl.
  const fotos = await fotosDelPaquete({ almacen: req.app.locals.almacenFotos, paqueteId: pkg.id, fotoUrl: pkg.fotoUrl });
  res.json({ fotos });
}

// Residente: programa su propia entrega — se verifica dueño.
// `modalidad` (T2.8): "DOMICILIO" (por defecto; pide franja y pago como siempre) o
// "RECOGER" ("prefiero recogerlo en portería"). RECOGER también aplica PROGRAMAR: el
// residente ya decidió, el paquete sale de "pendiente de decidir" y el operador lo
// ve en Programados, pero con modalidadEntrega=RECOGER y sin franja (se limpia).
// Se mantiene UNA sola máquina de estados y la bitácora registra la decisión.
export async function schedule(req, res) {
  const { franjaHoraria, metodoPagoServicio, modalidad = 'DOMICILIO' } = req.body ?? {};
  if (!MODALIDADES_ENTREGA.includes(modalidad)) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, 'La modalidad de entrega no es válida. Elige domicilio o recoger en portería.', 400, { campo: 'modalidad' });
  }
  const recoger = modalidad === 'RECOGER';
  const updated = await prisma.$transaction(async (tx) => {
    const pkg = await tx.package.findUnique({ where: { id: req.params.id }, select: selectSinFoto({ conPin: true }) });
    if (!pkg || pkg.residenteId !== req.user.sub) {
      throw new AppError(CODIGOS.NO_ENCONTRADO, 'No encontramos ese paquete. Actualiza la lista e intenta de nuevo.', 404);
    }
    return aplicarEvento(tx, pkg, EVENTOS.PROGRAMAR, {
      actorId: req.user.sub,
      datos: recoger
        ? { modalidad, franjaHoraria: null, metodoPagoServicio: null }
        : { modalidad, franjaHoraria: franjaHoraria ?? null, metodoPagoServicio: metodoPagoServicio ?? null },
      cambios: recoger
        ? { modalidadEntrega: modalidad, franjaHoraria: null, metodoPagoServicio: null }
        : { modalidadEntrega: modalidad, franjaHoraria, metodoPagoServicio },
    });
  });
  res.json(updated);
}

// Hasta `Conjunto.maxFotos` fotos, guardadas en el almacén de fotos (T5.1;
// en modo legado, como JSON en Package.fotoUrl). El cobro (cortesía por apartamento,
// bono atómico, tarifa) lo calcula services/cobro.service.js, la MISMA función
// que usa la recepción directa.
export async function checkin(req, res) {
  const { categoriaPeso, fotos } = req.body;
  const conjunto = await conjuntoDelContexto();
  if (fotos && !Array.isArray(fotos)) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, mensajeMaxFotos(conjunto.maxFotos), 400);
  }
  if (fotos) validarFotos(fotos, conjunto.maxFotos);
  // Se validan las fotos (400/413) antes de tocar nada.
  const almacen = req.app.locals.almacenFotos;
  (fotos ?? []).forEach((f, i) => decodificarDataUri(f, i + 1));

  const actual = await prisma.package.findUnique({
    where: { id: req.params.id },
    select: {
      residenteId: true, domicilioId: true, createdAt: true,
      domicilio: SELECT_DOMICILIO_PAQUETE,
      residente: { select: { id: true, torre: true, apto: true, nombre: true, telefono: true } },
    },
  });
  if (!actual) throw new AppError(CODIGOS.NO_ENCONTRADO, 'No encontramos ese paquete. Actualiza la lista e intenta de nuevo.', 404);
  // Destino para el cobro: la dirección del paquete (cortesía por apartamento físico).
  const vista = vistaResidente(actual);
  const destino = vista && { ...vista, domicilioId: actual.domicilioId };

  // Se valida antes de consultar bonos (categoriaPeso es un enum en la base);
  // calcularCobro() la vuelve a validar como defensa.
  if (!esCategoriaValida(categoriaPeso)) {
    throw new AppError(CODIGOS.DATOS_INVALIDOS, 'La categoría de peso no es válida. Elige una de la lista.', 400);
  }

  // Todo lo que cambia (bono + estado + evento) va en UNA transacción: si la
  // transición es inválida (409) o alguien más ya recibió el paquete, el crédito
  // consumido se revierte. Sin residente (SIN_ASIGNAR) la transición RECIBIR
  // falla con 409 (el camino es ASIGNAR).
  // Sube ANTES de la transacción; si ésta falla se borran los objetos subidos.
  const { fotoUrl, subidas } = await subirFotos({ almacen, conjuntoId: conjunto.id, fotos, paqueteId: req.params.id });
  let resultado;
  try {
  resultado = await prisma.$transaction(async (tx) => {
    const fresco = await tx.package.findUnique({ where: { id: req.params.id }, select: selectSinFoto({ conPin: true }) });
    if (!fresco) throw new AppError(CODIGOS.NO_ENCONTRADO, 'No encontramos ese paquete. Actualiza la lista e intenta de nuevo.', 404);
    // Valida la transición ANTES de tocar el bono (un paquete ya recibido o
    // entregado no debe gastar créditos).
    transicionar(fresco.estado, EVENTOS.RECIBIR);

    const r = await resolverCobro(tx, {
      conjunto, residente: destino, categoria: categoriaPeso, paqueteId: fresco.id,
    });
    const pkg = await aplicarEvento(tx, fresco, EVENTOS.RECIBIR, {
      actorId: req.user.sub,
      datos: { categoriaPeso, motivoCobro: r.cobro.motivo, monto: r.cobro.monto, bonoId: r.bonoId },
      cambios: {
        categoriaPeso,
        costoServicio: r.cobro.monto,
        bonoId: r.bonoId,
        recibidoEn: new Date(),
        fotoUrl,
      },
    });
    await registrarFotos(tx, pkg.id, subidas);
    return { pkg, bono: r.bono, esPrimera: r.esPrimeraEntrega };
  });
  } catch (e) {
    await descartarSubidas(almacen, subidas);
    throw e;
  }
  const { pkg, bono, esPrimera } = resultado;

  // Correo de llegada, ya confirmada la transacción (el aviso de WhatsApp sigue manual).
  enviarAvisoLlegada(req.app.locals.notificador, { residente: await contactoParaNotificar(actual.residenteId), paquete: pkg, conjunto });

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
    almacenFotos: req.app.locals.almacenFotos,
    operadorId: req.user.sub,
    body: req.body,
    claveCabecera: req.get('Idempotency-Key'),
    notificador: req.app.locals.notificador,
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
    domicilioId: req.body?.domicilioId,
    notificador: req.app.locals.notificador,
  }));
}

// M1: una celda de TEXTO que empiece por = + - @ (o tab / retorno de carro) la
// ejecutaría Excel como fórmula; se neutraliza con un apóstrofo al inicio. Solo
// aplica a texto: los números (costos, valores) nunca llegan aquí como String
// con signo menos inicial porque se escriben como number.
const INICIO_FORMULA = /^[=+\-@\t\r]/;
export function csvEscape(value) {
  if (value === null || value === undefined) return '';
  let str = String(value);
  if (typeof value === 'string' && INICIO_FORMULA.test(str)) str = `'${str}`;
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
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
    // M2: mismas reglas que la bitácora (día de Bogotá; `hasta` incluye todo ese día;
  // fecha inválida => 400 DATOS_INVALIDOS, nunca 500).
  const where = {};
  const rango = {};
  for (const [campo, tipo, op] of [['desde', 'desde', 'gte'], ['hasta', 'hasta', 'lt']]) {
    if (req.query[campo] === undefined || req.query[campo] === '') continue;
    const f = parsearFiltroFecha(req.query[campo], tipo);
    if (!f) throw new AppError(CODIGOS.DATOS_INVALIDOS, `La fecha "${campo}" no es válida. Usa el formato AAAA-MM-DD.`, 400, { campo });
    rango[op] = f;
  }
  if (rango.gte || rango.lt) where.fechaIngreso = rango;

  // Solo las columnas que usa el CSV: ni fotoUrl ni pin se leen de la base.
  const packages = await prisma.package.findMany({
    where,
    select: {
      id: true, fechaIngreso: true, residenteId: true, domicilioId: true, etiquetaNombre: true, proveedor: true, guia: true,
      pinProveedor: true, categoriaPeso: true, costoServicio: true, estado: true, franjaHoraria: true,
      metodoPagoServicio: true, esContraEntregaProveedor: true, valorProductoProveedor: true,
      valorDeclarado: true, notas: true, fechaEntrega: true,
      domicilio: SELECT_DOMICILIO_PAQUETE,
      residente: { select: { nombre: true, telefono: true, torre: true, apto: true } },
      bono: { select: { id: true } },
    },
    orderBy: { fechaIngreso: 'desc' },
  });

  // Igual que en listAll(): el motivo de un costo en $0 (primera entrega
  // vs. bono redimido) sirve para que el contador entienda por qué no se
  // cobró, sin tener que adivinar. Se calcula sobre TODO el historial de los
  // apartamentos exportados (sin el filtro desde/hasta), porque el primer paquete
  // cobrado de un apartamento puede quedar fuera del rango exportado.
  const primeras = await idsPrimeraEntrega({
    residenteIds: packages.map((p) => p.residenteId), domicilioIds: packages.map((p) => p.domicilioId),
  });

  const rows = packages.map((p0) => {
    const p = { ...p0, residente: residenteParaOperador(p0) };
    const motivoGratis = primeras.has(p.id) ? 'Primera entrega' : p.bono ? 'Bono prepago' : '';
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
  res.setHeader('Content-Disposition', 'attachment; filename="puertaya-paquetes.csv"');
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
  const pkg = await prisma.package.findUnique({ where: { id: req.params.id }, select: selectSinFoto({ conPin: true }) });
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
    const actual = await tx.package.findUnique({ where: { id: pkg.id }, select: selectSinFoto({ conPin: true }) });
    await aplicarEvento(tx, actual, EVENTOS.ENTREGAR, {
      actorId: req.user.sub,
      cambios: { fechaEntrega: new Date() },
    });
    return tx.package.findUnique({ where: { id: pkg.id }, select: selectSinFoto() });
  });

  // Un paquete sin residente no tiene a quién agradecer. Correo de la cuenta (uso interno).
  const contacto = await contactoParaNotificar(updated.residenteId);
  if (contacto?.email) {
    const conjunto = await conjuntoDelContexto();
    enSegundoPlano('entrega', () => req.app.locals.notificador.agradecerEntrega({
      residente: contacto, paquetes: [{ id: updated.id, proveedor: updated.proveedor, categoriaPeso: updated.categoriaPeso }], conjunto,
    }));
  }

  res.json({ ...updated, pin: undefined });
}
