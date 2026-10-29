import { prisma } from '../config/db.js';
import { interpretarBusqueda, etiquetaApartamento } from '../domain/apartamento.js';
import { elegirPrealerta, normalizarGuia } from '../domain/recepcion.js';
import { ESTADOS } from '../domain/paquete.machine.js';

export const MAX_RESULTADOS = 5;
// Candidatos que se leen de la base para ordenar (todos filtrados y ordenados EN la base).
const MAX_CANDIDATOS = 100;
// Un domicilio creado hace menos de esto se marca "nueva" en la fila del operador.
export const DIAS_NUEVA = 7;

// Búsqueda de direcciones de entrega (Domicilio) del conjunto del contexto (la
// extensión de tenant aísla: el operador solo ve las del suyo). PLAN-conjunto S1.2: el
// operador busca DOMICILIOS, no cuentas; de la persona solo ve lo que hay en el
// Domicilio, nunca correo ni otros conjuntos. "304" muestra a todos los que han pedido o
// recibido en ese apartamento (C5).
//
// Revisión S3.2:
//  - El filtro es EN LA BASE (apto como prefijo, torre canónica exacta y el nombre contra
//    `nombreBusqueda`, que ya está sin tildes/minúsculas): ya no se lee un bloque de 3000 en
//    memoria, que el spam de domicilios podía llenar para esconder al legítimo. Los
//    candidatos salen con un orden determinista y acotados.
//  - Cada fila lleva un DISCRIMINADOR para que dos personas con el mismo nombre en el mismo
//    apartamento se distingan sin pasos extra para el residente: últimos 4 dígitos del
//    teléfono, antigüedad, paquetes entregados antes y pendientes. Con ≥2 domicilios de
//    mismo nombre en el mismo apartamento, `posibleDuplicado`.
//  - Orden: pre-alerta abierta con la guía escrita (si el operador ya la tiene), luego
//    coincidencia exacta de apto, torre, apto, y dentro del mismo apartamento: más entregas
//    previas primero y, a igualdad, el más antiguo.
export async function buscarResidentes(q, { guia } = {}) {
  const f = interpretarBusqueda(q);
  const y = [{ activo: true }];
  // El apto es prefijo con o sin torre ("T2 30" -> 301, 304...). La torre guardada es la canónica.
  if (f.apto) y.push({ apto: { startsWith: f.apto } });
  if (f.torre) y.push({ torre: f.torre });
  if (f.texto) for (const p of f.texto.split(' ').filter(Boolean)) y.push({ nombreBusqueda: { contains: p } });

  const candidatos = await prisma.domicilio.findMany({
    where: { AND: y },
    select: {
      id: true, usuarioId: true, nombreRecibe: true, nombreBusqueda: true, torre: true, apto: true,
      telefono: true, creadoEn: true,
    },
    orderBy: [{ apto: 'asc' }, { torre: 'asc' }, { creadoEn: 'asc' }, { id: 'asc' }],
    take: MAX_CANDIDATOS,
  });
  if (!candidatos.length) return [];

  const ids = candidatos.map((d) => d.id);
  const [entregados, pendientes, pendientesLegado, prealertas] = await Promise.all([
    prisma.package.groupBy({ by: ['domicilioId'], where: { domicilioId: { in: ids }, estado: ESTADOS.ENTREGADO }, _count: { _all: true } }),
    prisma.package.groupBy({
      by: ['domicilioId'],
      where: { domicilioId: { in: ids }, estado: { in: [ESTADOS.EN_RECEPCION, ESTADOS.PROGRAMADO] } },
      _count: { _all: true },
    }),
    // Paquetes anteriores a S1.1 sin Domicilio: cuentan para la persona (como antes).
    prisma.package.groupBy({
      by: ['residenteId'],
      where: {
        domicilioId: null, residenteId: { in: [...new Set(candidatos.map((d) => d.usuarioId))] },
        estado: { in: [ESTADOS.EN_RECEPCION, ESTADOS.PROGRAMADO] },
      },
      _count: { _all: true },
    }),
    normalizarGuia(guia)
      ? prisma.package.findMany({
        where: { domicilioId: { in: ids }, estado: ESTADOS.PREALERTADO },
        select: { id: true, domicilioId: true, guia: true, createdAt: true },
      })
      : Promise.resolve([]),
  ]);
  const nEntregados = new Map(entregados.map((g) => [g.domicilioId, g._count._all]));
  const nPendientes = new Map(pendientes.map((g) => [g.domicilioId, g._count._all]));
  const nLegado = new Map(pendientesLegado.map((g) => [g.residenteId, g._count._all]));
  // Domicilios con una pre-alerta abierta cuya guía coincide con la que escribió el operador.
  const conGuia = new Set();
  const g = normalizarGuia(guia);
  if (g) {
    for (const p of prealertas) {
      if (normalizarGuia(p.guia) === g) conGuia.add(p.domicilioId);
    }
  }

  const exacto = (d) => (f.apto && d.apto === f.apto ? 0 : 1);
  const aptoNum = (d) => Number(d.apto || Infinity);
  const lista = [...candidatos].sort((a, b) => (conGuia.has(b.id) - conGuia.has(a.id))
    || exacto(a) - exacto(b)
    || a.torre.localeCompare(b.torre, 'es', { numeric: true })
    || aptoNum(a) - aptoNum(b)
    || (nEntregados.get(b.id) ?? 0) - (nEntregados.get(a.id) ?? 0)
    || a.creadoEn - b.creadoEn
    || (a.id < b.id ? -1 : 1))
    .slice(0, MAX_RESULTADOS);

  // ¿Hay 2+ domicilios (activos) con el mismo nombre normalizado en el mismo apartamento? Se
  // cuenta en la base sobre los apartamentos de los resultados (no solo entre los candidatos).
  const grupos = await prisma.domicilio.groupBy({
    by: ['torre', 'apto', 'nombreBusqueda'],
    where: { activo: true, apto: { in: [...new Set(lista.map((d) => d.apto))] } },
    _count: { _all: true },
  });
  const repetidos = new Set(grupos.filter((x) => x._count._all >= 2).map((x) => `${x.torre}|${x.apto}|${x.nombreBusqueda}`));

  const ahora = Date.now();
  return lista.map((d) => ({
    domicilioId: d.id,
    residenteId: d.usuarioId,
    // `id` = residenteId: compatibilidad con los contratos actuales (S1.3 los cambia).
    id: d.usuarioId,
    nombre: d.nombreRecibe,
    torre: d.torre || null,
    apto: d.apto || null,
    etiqueta: etiquetaApartamento(d.torre, d.apto),
    pendientes: (nPendientes.get(d.id) ?? 0) + (nLegado.get(d.usuarioId) ?? 0),
    // Discriminador (revisión S3.2): lo único de la persona que se agrega son 4 dígitos.
    telefonoFin: ultimos4(d.telefono),
    creadoEn: d.creadoEn,
    esNueva: ahora - d.creadoEn.getTime() < DIAS_NUEVA * 24 * 60 * 60 * 1000,
    entregados: nEntregados.get(d.id) ?? 0,
    prealertaCoincide: conGuia.has(d.id),
    posibleDuplicado: repetidos.has(`${d.torre}|${d.apto}|${d.nombreBusqueda}`),
  }));
}

/** Últimos 4 dígitos del teléfono ('' si no hay 4). */
export function ultimos4(telefono) {
  const digitos = String(telefono ?? '').replace(/\D/g, '');
  return digitos.length >= 4 ? digitos.slice(-4) : '';
}
