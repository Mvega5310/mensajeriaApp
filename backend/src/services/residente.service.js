import { prisma } from '../config/db.js';
import { interpretarBusqueda, tokenTorre, etiquetaApartamento, sinTildes } from '../domain/apartamento.js';

export const MAX_RESULTADOS = 5;
// Tope de seguridad de residentes leídos del conjunto para filtrar en memoria.
const TOPE_LECTURA = 3000;

// Búsqueda de residentes del conjunto del contexto (la extensión de tenant
// aísla). Decisión de tildes: sin la extensión `unaccent` de Postgres y sin SQL
// crudo (invariante 3), el nombre se compara EN MEMORIA ya sin tildes/mayúsculas,
// sobre una lectura acotada (solo RESIDENT, 4 columnas, tope TOPE_LECTURA).
// Para apto/torre, la BD filtra el apto (igual, o prefijo si no hay torre) y la
// torre se compara por token en memoria ("TORRE 2" = "T2" = "2").
export async function buscarResidentes(q) {
  const f = interpretarBusqueda(q);
  const where = { role: 'RESIDENT' };
  if (f.apto) where.apto = f.torre ? f.apto : { startsWith: f.apto };

  const candidatos = await prisma.user.findMany({
    where,
    select: { id: true, nombre: true, torre: true, apto: true },
    take: TOPE_LECTURA,
  });

  let lista = candidatos;
  if (f.torre) lista = lista.filter((u) => tokenTorre(u.torre) === f.torre);
  if (f.texto) {
    const palabras = f.texto.split(' ').filter(Boolean);
    lista = lista.filter((u) => {
      const n = sinTildes(u.nombre);
      return palabras.every((p) => n.includes(p));
    });
  }

  const exacto = (u) => (f.apto && u.apto === f.apto ? 0 : 1);
  const aptoNum = (u) => Number(u.apto ?? Infinity);
  lista.sort((a, b) => exacto(a) - exacto(b)
    || (tokenTorre(a.torre) ?? '').localeCompare(tokenTorre(b.torre) ?? '', 'es', { numeric: true })
    || aptoNum(a) - aptoNum(b)
    || a.nombre.localeCompare(b.nombre, 'es'));

  return Promise.all(lista.slice(0, MAX_RESULTADOS).map(async (u) => ({
    id: u.id,
    nombre: u.nombre,
    torre: u.torre,
    apto: u.apto,
    etiqueta: etiquetaApartamento(u.torre, u.apto),
    pendientes: await prisma.package.count({
      where: { residenteId: u.id, estado: { in: ['EN_RECEPCION', 'PROGRAMADO'] } },
    }),
  })));
}
