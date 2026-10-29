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
import { tokenTorre } from '../domain/apartamento.js';
import { normalizarApto } from './apartamento.service.js';

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

/**
 * Crea (o reutiliza) el Domicilio de `usuarioId` en el conjunto del contexto. La
 * dirección se pide UNA vez: si ya existe la misma (conjunto, persona, torre, apto) se
 * reutiliza, se marca como la última usada y se actualiza quién recibe/teléfono si llegan.
 * Debe correr dentro de runWithTenant (el conjunto sale del contexto, nunca del llamador).
 * @param {{usuarioId:string, torre?:string|null, apto?:string|null, nombreRecibe:string, telefono:string}} p
 */
export async function crearOReutilizarDomicilio({ usuarioId, torre, apto, nombreRecibe, telefono }) {
  const conjuntoId = conjuntoDelContextoId();
  const dir = canonicalizarDireccion({ torre, apto });
  // Índice persona -> conjunto primero: si falla lo siguiente, sobra un índice inofensivo.
  await prisma.usuarioConjunto.upsert({
    where: { usuarioId_conjuntoId: { usuarioId, conjuntoId } },
    create: { usuarioId, conjuntoId },
    update: {},
  });
  const clave = { conjuntoId_usuarioId_torre_apto: { conjuntoId, usuarioId, ...dir } };
  const ahora = new Date();
  const actualizar = {
    ultimoUsoEn: ahora,
    activo: true,
    ...(nombreRecibe ? { nombreRecibe } : {}),
    ...(telefono ? { telefono } : {}),
  };
  const existente = await prisma.domicilio.findUnique({ where: clave, select: SELECT_DOMICILIO });
  if (existente) {
    return prisma.domicilio.update({ where: clave, data: actualizar, select: SELECT_DOMICILIO });
  }
  try {
    return await prisma.domicilio.create({
      data: { usuarioId, ...dir, nombreRecibe, telefono, ultimoUsoEn: ahora },
      select: SELECT_DOMICILIO,
    });
  } catch (e) {
    // Dos solicitudes simultáneas con la misma dirección: gana una, la otra la reutiliza.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return prisma.domicilio.update({ where: clave, data: actualizar, select: SELECT_DOMICILIO });
    }
    throw e;
  }
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
    select: { id: true, nombre: true, slug: true },
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
