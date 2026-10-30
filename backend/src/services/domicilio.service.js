// Direcciones de entrega (Domicilio) y "Mis paquetes" multi-conjunto
// (PLAN-conjunto S1.1 / S1.2).
//
// Modelo: la CUENTA (User) es de la persona y sirve en cualquier conjunto; el
// Domicilio (conjunto + torre + apto + quién recibe + teléfono) es lo que pertenece a
// un conjunto. Domicilio lleva `conjuntoId` y está en MODELOS_CON_TENANT: la extensión
// lo filtra por el conjunto del contexto, así que el operador de A nunca lee el de B.
//
// "Mis paquetes" de una persona (paquetesDePersona): como Domicilio/Package están bajo
// tenant y no se pueden barrer entre conjuntos, se (1) lee en qué conjuntos tiene
// domicilio la persona desde el índice `UsuarioConjunto` (solo dos ids, sin datos
// personales; ÚNICO acceso a esa tabla, vigilado por la auditoría) y (2) se corre UNA
// consulta por conjunto DENTRO de runWithTenant de ese conjunto. Sin GLOBAL_LOOKUP nuevo
// y sin SQL crudo: la extensión sigue filtrando cada consulta.

import { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { getContext, runWithTenant } from '../config/tenantContext.js';
import { AppError, CODIGOS } from '../domain/errores.js';
import { tokenTorre, sinTildes, interpretarBusqueda } from '../domain/apartamento.js';
import { ultimos4 } from './residente.service.js';
import { normalizarApto } from './apartamento.service.js';
import { etiquetaApartamento } from '../domain/apartamento.js';
import { obtenerCuentaPropia, marcarUltimoConjunto } from './usuario.service.js';

/**
 * Forma canónica de una dirección guardada en Domicilio (sin NULL, para que el único
 * [conjuntoId, usuarioId, torre, apto] deduplique):
 *   torre = tokenTorre(torre) ?? ''   ("TORRE 2" | "T2" | "2" -> "2"; "Torre A" -> "A")
 *   apto  = solo dígitos ?? ''
 * La migración de datos de add_domicilio aplica la misma regla en SQL.
 */
export function canonicalizarDireccion({ torre, apto }) {
  return { torre: tokenTorre(torre) ?? '', apto: normalizarApto(apto == null ? null : String(apto)) ?? '' };
}

/** `null` en vez de '' (los consumidores antiguos esperan null cuando falta torre/apto). */
export const nulaSiVacia = (v) => (v ? v : null);

function conjuntoDelContextoId() {
  const ctx = getContext();
  if (!ctx?.conjuntoId) throw new Error('domicilio.service: se requiere un contexto de tenant (runWithTenant)');
  return ctx.conjuntoId;
}

const SELECT_DOMICILIO = {
  id: true, conjuntoId: true, usuarioId: true, torre: true, apto: true,
  nombreRecibe: true, telefono: true, ultimoUsoEn: true, activo: true,
};

/** Tope de direcciones ACTIVAS por persona y conjunto (revisión S3.2, contra el spam de domicilios). */
export const MAX_DOMICILIOS_ACTIVOS = 10;

const direccionDesactivada = () => new AppError(
  CODIGOS.DIRECCION_DESACTIVADA,
  'Esta dirección fue desactivada por el operador. Escribe otra dirección o pregunta en portería.',
  409,
);

/**
 * Crea (o reutiliza) el Domicilio de `usuarioId` en el conjunto del contexto. La
 * dirección se pide UNA vez: si ya existe la misma (conjunto, persona, torre, apto) se
 * reutiliza, se marca como la última usada y se actualiza quién recibe/teléfono si llegan.
 * Debe correr dentro de runWithTenant (el conjunto sale del contexto, nunca del llamador).
 * `porDefecto` ({nombreRecibe, telefono}) completa lo que falte solo si hay que crearla.
 *
 * Revisión S3.2: el índice UsuarioConjunto y el Domicilio se escriben en UNA transacción (no
 * queda un índice sin dirección); una dirección que el operador desactivó NO se reactiva
 * sola (409 DIRECCION_DESACTIVADA); y crear una nueva con ya 10 activas es 400
 * LIMITE_DIRECCIONES. `nombreBusqueda` (sin tildes) se mantiene al crear o cambiar el nombre.
 * @param {{usuarioId:string, torre?:string|null, apto?:string|null, nombreRecibe?:string, telefono?:string, porDefecto?:{nombreRecibe:string, telefono:string}}} p
 */
export async function crearOReutilizarDomicilio({ usuarioId, torre, apto, nombreRecibe, telefono, porDefecto }) {
  const conjuntoId = conjuntoDelContextoId();
  const dir = canonicalizarDireccion({ torre, apto });
  const clave = { conjuntoId_usuarioId_torre_apto: { conjuntoId, usuarioId, ...dir } };

  const intentar = () => prisma.$transaction(async (tx) => {
    const ahora = new Date();
    // El upsert TOCA la fila del índice (reescribe `creadoEn`, que nadie lee): el UPDATE toma el
    // bloqueo de fila hasta el fin de la transacción, así las altas simultáneas de la MISMA
    // persona en el MISMO conjunto se serializan y el conteo del tope (10) no se salta con una
    // ráfaga en paralelo. Sin SQL crudo ni bloqueos en memoria (sirve con varias réplicas).
    await tx.usuarioConjunto.upsert({
      where: { usuarioId_conjuntoId: { usuarioId, conjuntoId } },
      create: { usuarioId, conjuntoId },
      update: { creadoEn: ahora },
    });
    const existente = await tx.domicilio.findUnique({ where: clave, select: SELECT_DOMICILIO });
    if (existente) {
      if (!existente.activo) throw direccionDesactivada();
      return tx.domicilio.update({
        where: clave,
        data: {
          ultimoUsoEn: ahora,
          ...(nombreRecibe ? { nombreRecibe, nombreBusqueda: sinTildes(nombreRecibe) } : {}),
          ...(telefono ? { telefono } : {}),
        },
        select: SELECT_DOMICILIO,
      });
    }
    const activas = await tx.domicilio.count({ where: { usuarioId, activo: true } });
    if (activas >= MAX_DOMICILIOS_ACTIVOS) {
      throw new AppError(
        CODIGOS.LIMITE_DIRECCIONES,
        `Ya tienes ${MAX_DOMICILIOS_ACTIVOS} direcciones en este conjunto. Usa una de las que ya tienes.`,
        400,
        { max: MAX_DOMICILIOS_ACTIVOS },
      );
    }
    // Solo al CREAR se completa con los datos de la cuenta; al reutilizar no se pisa
    // lo que ya tenía (p. ej. el nombre de un amigo).
    const nombre = nombreRecibe || porDefecto?.nombreRecibe;
    return tx.domicilio.create({
      data: {
        usuarioId, ...dir, ultimoUsoEn: ahora,
        nombreRecibe: nombre,
        nombreBusqueda: sinTildes(nombre),
        telefono: telefono || porDefecto?.telefono,
      },
      select: SELECT_DOMICILIO,
    });
  });

  try {
    return await intentar();
  } catch (e) {
    // Dos solicitudes simultáneas con la misma dirección: gana una; la otra repite y la reutiliza.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return intentar();
    throw e;
  }
}

/**
 * El operador desactiva una dirección de SU conjunto (el tenant del contexto la acota: la de
 * otro conjunto no existe, 404). Queda `activo=false` y un DomicilioEvento DESACTIVAR con el
 * operador. Una dirección inactiva no sale en la búsqueda, no recibe paquetes nuevos y no se
 * reactiva sola. Los paquetes que ya tenía siguen su curso. Idempotente.
 */
export async function desactivarDomicilio(domicilioId, actorId) {
  if (typeof domicilioId !== 'string' || !domicilioId) {
    throw new AppError(CODIGOS.NO_ENCONTRADO, 'No encontramos esa dirección. Búscala de nuevo.', 404);
  }
  return prisma.$transaction(async (tx) => {
    const d = await tx.domicilio.findUnique({
      where: { id: domicilioId }, select: { id: true, activo: true, torre: true, apto: true },
    });
    if (!d) throw new AppError(CODIGOS.NO_ENCONTRADO, 'No encontramos esa dirección. Búscala de nuevo.', 404);
    if (d.activo) {
      await tx.domicilio.update({ where: { id: d.id }, data: { activo: false } });
      await tx.domicilioEvento.create({
        data: { domicilioId: d.id, tipo: 'DESACTIVAR', actorId, datos: { torre: d.torre, apto: d.apto } },
      });
    }
    return { id: d.id, activo: false };
  });
}

/**
 * El operador deshace una desactivación hecha por error (una dirección de SU conjunto: la de
 * otro no existe, 404). Queda `activo=true` y un DomicilioEvento REACTIVAR con el operador. Si
 * la persona ya tiene 10 direcciones activas en este conjunto, 409 LIMITE_DIRECCIONES (hay que
 * desactivar otra antes). Idempotente: reactivar una ya activa es 200 sin evento nuevo.
 */
export async function reactivarDomicilio(domicilioId, actorId) {
  const noExiste = () => new AppError(CODIGOS.NO_ENCONTRADO, 'No encontramos esa dirección. Búscala de nuevo.', 404);
  if (typeof domicilioId !== 'string' || !domicilioId) throw noExiste();
  const conjuntoId = conjuntoDelContextoId();
  return prisma.$transaction(async (tx) => {
    const d = await tx.domicilio.findUnique({
      where: { id: domicilioId }, select: { id: true, activo: true, usuarioId: true, torre: true, apto: true },
    });
    if (!d) throw noExiste();
    if (!d.activo) {
      // Misma serialización que el alta: tocar la fila del índice toma el bloqueo de la persona en
      // este conjunto, así dos reactivaciones (o una alta) simultáneas no se saltan el tope.
      await tx.usuarioConjunto.upsert({
        where: { usuarioId_conjuntoId: { usuarioId: d.usuarioId, conjuntoId } },
        create: { usuarioId: d.usuarioId, conjuntoId },
        update: { creadoEn: new Date() },
      });
      const activas = await tx.domicilio.count({ where: { usuarioId: d.usuarioId, activo: true } });
      if (activas >= MAX_DOMICILIOS_ACTIVOS) {
        throw new AppError(
          CODIGOS.LIMITE_DIRECCIONES,
          `Esta persona ya tiene ${MAX_DOMICILIOS_ACTIVOS} direcciones activas en el conjunto. Desactiva otra antes de reactivar esta.`,
          409,
          { max: MAX_DOMICILIOS_ACTIVOS },
        );
      }
      await tx.domicilio.update({ where: { id: d.id }, data: { activo: true } });
      await tx.domicilioEvento.create({
        data: { domicilioId: d.id, tipo: 'REACTIVAR', actorId, datos: { torre: d.torre, apto: d.apto } },
      });
    }
    return { id: d.id, activo: true };
  });
}

/**
 * Direcciones desactivadas del conjunto del contexto, para que el operador reactive una por
 * error. Sin correo ni teléfono completo. `q` (opcional) filtra por apto/torre o nombre.
 * Orden estable (torre, apto, nombre); `limite` (1..100, 50 por defecto) y `pagina` (desde 1).
 * @returns {Promise<{domicilioId:string, nombre:string, etiqueta:string, telefonoFin:string, desactivadoEn:Date|null}[]>}
 */
export async function listarDesactivados({ q, limite, pagina } = {}) {
  const take = Math.min(Math.max(Number.parseInt(limite, 10) || 50, 1), 100);
  const skip = (Math.max(Number.parseInt(pagina, 10) || 1, 1) - 1) * take;
  const y = [{ activo: false }];
  const texto = typeof q === 'string' ? q.trim().slice(0, 60) : '';
  if (texto) {
    const f = interpretarBusqueda(texto);
    if (f.apto) y.push({ apto: { startsWith: f.apto } });
    if (f.torre) y.push({ torre: f.torre });
    if (f.texto) for (const p of f.texto.split(' ').filter(Boolean)) y.push({ nombreBusqueda: { contains: p } });
  }
  const filas = await prisma.domicilio.findMany({
    where: { AND: y },
    select: { id: true, torre: true, apto: true, nombreRecibe: true, telefono: true },
    orderBy: [{ torre: 'asc' }, { apto: 'asc' }, { nombreBusqueda: 'asc' }, { id: 'asc' }],
    skip,
    take,
  });
  if (!filas.length) return [];
  const eventos = await prisma.domicilioEvento.findMany({
    where: { domicilioId: { in: filas.map((f) => f.id) }, tipo: 'DESACTIVAR' },
    orderBy: { creadoEn: 'desc' },
    select: { domicilioId: true, creadoEn: true },
  });
  const cuando = new Map();
  for (const e of eventos) if (!cuando.has(e.domicilioId)) cuando.set(e.domicilioId, e.creadoEn);
  return filas.map((f) => ({
    domicilioId: f.id,
    nombre: f.nombreRecibe,
    etiqueta: etiquetaApartamento(f.torre, f.apto),
    telefonoFin: ultimos4(f.telefono),
    desactivadoEn: cuando.get(f.id) ?? null,
  }));
}

/** Domicilio activo más reciente de la persona EN el conjunto del contexto (o null). */
export async function domicilioDePersona(usuarioId) {
  return prisma.domicilio.findFirst({
    where: { usuarioId, activo: true },
    orderBy: [{ ultimoUsoEn: 'desc' }, { creadoEn: 'desc' }],
    select: SELECT_DOMICILIO,
  });
}

/** Domicilio por id EN el conjunto del contexto (de otro conjunto: null). */
export async function domicilioPorId(domicilioId, cliente = prisma) {
  return cliente.domicilio.findUnique({ where: { id: domicilioId }, select: SELECT_DOMICILIO });
}

/** Direcciones guardadas de la persona en el conjunto del contexto, la última usada primero. */
export async function domiciliosDePersona(usuarioId) {
  return prisma.domicilio.findMany({
    where: { usuarioId, activo: true },
    orderBy: [{ ultimoUsoEn: 'desc' }, { creadoEn: 'desc' }],
    select: SELECT_DOMICILIO,
  });
}

/**
 * Resuelve el Domicilio al que va un paquete a partir de lo que mande el llamador:
 * `domicilioId` (preferido) o, por compatibilidad, `residenteId` (su domicilio más
 * reciente en ESTE conjunto). Siempre dentro del contexto: un domicilio/residente de
 * otro conjunto no existe aquí. Lanza 404 si no hay.
 * @param {object} tx  cliente (transaccional o prisma)
 */
export async function resolverDomicilio(tx, { domicilioId, residenteId }) {
  let d = null;
  if (domicilioId) {
    if (typeof domicilioId !== 'string') throw noEncontrado();
    d = await tx.domicilio.findUnique({ where: { id: domicilioId }, select: SELECT_DOMICILIO });
    // Revisión S3.2: una dirección desactivada por el operador no recibe paquetes nuevos.
    if (d && !d.activo) {
      throw new AppError(
        CODIGOS.DIRECCION_DESACTIVADA,
        'Esa dirección fue desactivada. Búscala de nuevo y elige otra.',
        409,
      );
    }
  } else if (residenteId) {
    if (typeof residenteId !== 'string') throw noEncontrado();
    d = await tx.domicilio.findFirst({
      where: { usuarioId: residenteId, activo: true },
      orderBy: [{ ultimoUsoEn: 'desc' }, { creadoEn: 'desc' }],
      select: SELECT_DOMICILIO,
    });
  }
  if (!d) throw noEncontrado();
  return d;
}

const noEncontrado = () => new AppError(
  CODIGOS.NO_ENCONTRADO,
  'No encontramos a ese residente. Búscalo de nuevo e intenta otra vez.',
  404,
);

/**
 * Forma "residente" que consumen el cobro, el lote de entrega, el aviso y los listados:
 * { id, nombre, telefono, torre, apto }. Sale del Domicilio del paquete si lo tiene
 * (lo único de la persona que ve el operador) y, solo si no, de la cuenta enlazada
 * (compatibilidad con paquetes anteriores a S1.1). `p` trae `residenteId`, `domicilio`
 * ({nombreRecibe, telefono, torre, apto}) y/o `residente` ({nombre, telefono, torre, apto}).
 */
export function vistaResidente(p) {
  if (!p?.residenteId) return null;
  const d = p.domicilio;
  if (d) {
    return {
      id: p.residenteId, nombre: d.nombreRecibe, telefono: d.telefono,
      torre: nulaSiVacia(d.torre), apto: nulaSiVacia(d.apto),
    };
  }
  const r = p.residente;
  return r ? { id: p.residenteId, nombre: r.nombre, telefono: r.telefono, torre: r.torre ?? null, apto: r.apto ?? null } : null;
}

/** Select anidado del Domicilio para paquetes (solo lo que ve el operador). */
export const SELECT_DOMICILIO_PAQUETE = { select: { nombreRecibe: true, telefono: true, torre: true, apto: true } };

/**
 * Filtro de paquetes por apartamento (dígitos), acotado en la base ("contains"); la
 * igualdad exacta por clave la aplican quienes llaman en memoria. Mira el Domicilio y,
 * solo para paquetes sin Domicilio (anteriores a S1.1), la cuenta enlazada.
 */
export function filtroPaquetePorApto(digitos, { torre } = {}) {
  const dom = { apto: { contains: digitos } };
  if (torre) dom.torre = torre;
  return {
    OR: [
      { domicilio: { is: dom } },
      { domicilioId: null, residente: { is: { apto: { contains: digitos } } } },
    ],
  };
}

// --- Conjuntos de la persona y "Mis paquetes" multi-conjunto -------------------------

/**
 * Ids de los conjuntos donde la persona tiene (o tuvo) un Domicilio. ÚNICO acceso a
 * `UsuarioConjunto`. `usuarioId` debe ser el de la sesión; nunca se acepta de otro.
 */
export async function conjuntosDePersona(usuarioId) {
  const filas = await prisma.usuarioConjunto.findMany({
    where: { usuarioId },
    select: { conjuntoId: true },
  });
  return filas.map((f) => f.conjuntoId);
}

/**
 * Corre `fn(conjunto)` una vez por cada conjunto de la persona, DENTRO de
 * runWithTenant de ese conjunto (la extensión filtra), y junta los resultados. Los
 * conjuntos se leen de `Conjunto` (modelo sin tenant) para dar nombre/slug.
 * @param {string} usuarioId
 * @param {(conjunto:{id:string, nombre:string, slug:string})=>Promise<Array>} fn
 */
export async function porCadaConjuntoDePersona(usuarioId, fn) {
  const ids = await conjuntosDePersona(usuarioId);
  if (!ids.length) return [];
  const conjuntos = await prisma.conjunto.findMany({
    where: { id: { in: ids } },
    select: { id: true, nombre: true, slug: true, invitacionActiva: true },
  });
  const grupos = await Promise.all(conjuntos.map((c) =>
    runWithTenant({ conjuntoId: c.id, role: 'RESIDENT' }, () => fn(c))));
  return grupos.flat();
}

/**
 * "Mis paquetes": los paquetes de la persona en TODOS sus conjuntos, la más reciente
 * primero, cada uno con su conjunto ({ slug, nombre }). `consulta` recibe los
 * argumentos base de findMany y devuelve filas; por defecto, todos los de `residenteId`.
 */
export async function paquetesDePersona(usuarioId, { select, estados } = {}) {
  const filas = await porCadaConjuntoDePersona(usuarioId, async (c) => {
    const paquetes = await prisma.package.findMany({
      where: { residenteId: usuarioId, ...(estados ? { estado: { in: estados } } : {}) },
      select,
      orderBy: { createdAt: 'desc' },
    });
    return paquetes.map((p) => ({ ...p, conjunto: { slug: c.slug, nombre: c.nombre } }));
  });
  return filas.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// --- Contexto por solicitud (PLAN-conjunto S1.3) --------------------------------------
// El residente no "pertenece" a un conjunto: cada solicitud trae su conjunto. Sin
// GLOBAL_LOOKUP ni SQL crudo: el índice UsuarioConjunto dice DÓNDE puede mirar la persona y
// cada lectura corre dentro de runWithTenant de ese conjunto (la extensión sigue filtrando).

/** Forma pública de una dirección guardada (la que consume el cliente). */
export function vistaDomicilio(d, conjunto) {
  return {
    id: d.id,
    conjunto: { slug: conjunto.slug, nombre: conjunto.nombre },
    torre: nulaSiVacia(d.torre),
    apto: nulaSiVacia(d.apto),
    etiqueta: etiquetaApartamento(d.torre, d.apto),
    nombreRecibe: d.nombreRecibe,
    telefono: d.telefono,
    ultimoUsoEn: d.ultimoUsoEn,
  };
}

/**
 * Direcciones guardadas de la persona en TODOS sus conjuntos activos (una consulta por
 * conjunto, dentro de su runWithTenant), la última usada primero. Cada una trae
 * `conjunto` ({ id, slug, nombre }) además de los campos del Domicilio.
 */
export async function listarDomiciliosDePersona(usuarioId) {
  const filas = await porCadaConjuntoDePersona(usuarioId, async (c) => {
    if (!c.invitacionActiva) return [];
    const ds = await prisma.domicilio.findMany({
      where: { usuarioId, activo: true },
      select: SELECT_DOMICILIO,
    });
    return ds.map((d) => ({ ...d, conjunto: { id: c.id, slug: c.slug, nombre: c.nombre } }));
  });
  return filas.sort((a, b) => new Date(b.ultimoUsoEn) - new Date(a.ultimoUsoEn));
}

/** Una dirección propia por id, en cualquiera de sus conjuntos activos (o null). */
export async function domicilioPropioPorId(usuarioId, domicilioId) {
  if (typeof domicilioId !== 'string' || !domicilioId) return null;
  const todas = await listarDomiciliosDePersona(usuarioId);
  return todas.find((d) => d.id === domicilioId) ?? null;
}

/**
 * Crea o reutiliza la dirección de la persona en el conjunto del contexto y la marca como
 * la última usada (también el "último conjunto" de la cuenta). Nombre y teléfono que falten
 * se precargan de la cuenta SOLO al crear. Debe correr en runWithTenant del conjunto elegido.
 */
export async function guardarDireccionDePersona(usuarioId, { torre, apto, nombreRecibe, telefono }) {
  const cuenta = await obtenerCuentaPropia(usuarioId);
  if (!cuenta) throw new AppError(CODIGOS.NO_ENCONTRADO, 'No encontramos tu usuario. Inicia sesión de nuevo.', 404);
  const d = await crearOReutilizarDomicilio({
    usuarioId, torre, apto, nombreRecibe, telefono,
    porDefecto: { nombreRecibe: cuenta.nombre, telefono: cuenta.telefono },
  });
  await marcarUltimoConjunto(usuarioId, conjuntoDelContextoId());
  return d;
}

/**
 * ¿En qué conjunto está el paquete `paqueteId` de la persona? Prueba primero `actualId`
 * (el del contexto, lo normal) y luego los demás conjuntos del índice, siempre dentro del
 * runWithTenant de cada uno y filtrando por dueño (`residenteId`). Un paquete ajeno, o en un
 * conjunto donde la persona no tiene domicilio, no se encuentra (null).
 * @returns {Promise<string|null>} id del conjunto
 */
export async function conjuntoDePaquetePropio(usuarioId, paqueteId, actualId) {
  if (typeof paqueteId !== 'string' || !paqueteId) return null;
  const ids = await conjuntosDePersona(usuarioId);
  const orden = [...(actualId && ids.includes(actualId) ? [actualId] : []), ...ids.filter((i) => i !== actualId)];
  const hallazgos = await Promise.all(orden.map((conjuntoId) =>
    runWithTenant({ conjuntoId, role: 'RESIDENT' }, async () => {
      const p = await prisma.package.findFirst({ where: { id: paqueteId, residenteId: usuarioId }, select: { id: true } });
      return p ? conjuntoId : null;
    })));
  return hallazgos.find(Boolean) ?? null;
}

/**
 * ¿La persona tiene un Domicilio ACTIVO real en este conjunto? El índice UsuarioConjunto
 * dice dónde mirar (puede sobrar una fila sin dirección, p. ej. si falló un alta) y la
 * existencia se confirma con el Domicilio, dentro del runWithTenant de ese conjunto.
 */
export async function tieneDomicilioEn(usuarioId, conjuntoId) {
  if (!(await conjuntosDePersona(usuarioId)).includes(conjuntoId)) return false;
  const n = await runWithTenant({ conjuntoId, role: 'RESIDENT' }, () =>
    prisma.domicilio.count({ where: { usuarioId, activo: true } }));
  return n > 0;
}

/** ¿Es una dirección PROPIA que el operador desactivó? (para avisarle con un mensaje claro). */
export async function esDireccionPropiaDesactivada(usuarioId, domicilioId) {
  if (typeof domicilioId !== 'string' || !domicilioId) return false;
  const filas = await porCadaConjuntoDePersona(usuarioId, () =>
    prisma.domicilio.findMany({ where: { id: domicilioId, usuarioId, activo: false }, select: { id: true } }));
  return filas.length > 0;
}

/** El error de "dirección desactivada" (la misma redacción en todos los caminos). */
export { direccionDesactivada };

/**
 * Valida y normaliza la dirección que llega en el cuerpo de una solicitud
 * (`POST /domicilios`, pre-alerta con dirección nueva): `{ conjunto, torre, apto,
 * nombreRecibe?, telefono? }`. El conjunto va por slug (se valida aparte). El apartamento es
 * obligatorio (sin él la dirección no sirve para ubicar el paquete); la torre es opcional.
 */
export function direccionDeCuerpo(body) {
  const mala = (msg, campo) => new AppError(CODIGOS.DATOS_INVALIDOS, msg, 400, { campo });
  const texto = (v, campo, max) => {
    if (v === undefined || v === null || v === '') return undefined;
    if (typeof v !== 'string' && typeof v !== 'number') throw mala('Revisa los datos de la dirección.', campo);
    const t = String(v).trim();
    if (t.length > max) throw mala(`El campo ${campo} es demasiado largo.`, campo);
    return t || undefined;
  };
  const torre = texto(body?.torre, 'torre', 20);
  const apto = texto(body?.apto, 'apto', 10);
  const nombreRecibe = texto(body?.nombreRecibe, 'nombreRecibe', 80);
  const telefono = texto(body?.telefono, 'telefono', 20);
  if (!canonicalizarDireccion({ torre, apto }).apto) throw mala('Escribe el número de tu apartamento.', 'apto');
  return { torre, apto, nombreRecibe, telefono };
}

/**
 * Marca una dirección propia (del conjunto del contexto) como la última usada y el conjunto
 * como el "último conjunto" de la cuenta. Devuelve el Domicilio. Nunca toca el de otra persona
 * (`usuarioId` es el de la sesión).
 */
export async function usarDomicilio(usuarioId, domicilioId) {
  const d = await prisma.domicilio.update({
    where: { id: domicilioId, usuarioId },
    data: { ultimoUsoEn: new Date() },
    select: SELECT_DOMICILIO,
  });
  await marcarUltimoConjunto(usuarioId, conjuntoDelContextoId());
  return d;
}
