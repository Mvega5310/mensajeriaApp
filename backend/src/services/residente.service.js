import { prisma } from '../config/db.js';
import { interpretarBusqueda, tokenTorre, etiquetaApartamento, sinTildes } from '../domain/apartamento.js';

export const MAX_RESULTADOS = 5;
// Tope de seguridad de domicilios leídos del conjunto para filtrar en memoria.
const TOPE_LECTURA = 3000;

// Búsqueda de direcciones de entrega (Domicilio) del conjunto del contexto (la
// extensión de tenant aísla: el operador solo ve las del suyo). PLAN-conjunto S1.2: el
// operador busca DOMICILIOS, no cuentas; de la persona solo ve lo que hay en el
// Domicilio (nombre de quien recibe, torre, apto), nunca correo ni teléfono ni otros
// conjuntos. "304" muestra a todos los que han pedido o recibido en ese apartamento (C5).
// Decisión de tildes: sin la extensión `unaccent` de Postgres y sin SQL crudo
// (invariante 3), el nombre se compara EN MEMORIA ya sin tildes/mayúsculas, sobre una
// lectura acotada (solo activos, pocas columnas, tope TOPE_LECTURA). Para apto/torre, la
// BD filtra el apto (siempre como prefijo) y la torre se compara por token en memoria
// ("TORRE 2" = "T2" = "2").
export async function buscarResidentes(q) {
  const f = interpretarBusqueda(q);
  const where = { activo: true };
  // El apto es prefijo con o sin torre ("T2 30" -> 301, 304...); la torre se compara por token abajo.
  if (f.apto) where.apto = { startsWith: f.apto };

  const candidatos = await prisma.domicilio.findMany({
    where,
    select: { id: true, usuarioId: true, nombreRecibe: true, torre: true, apto: true },
    take: TOPE_LECTURA,
  });

  let lista = candidatos;
  if (f.torre) lista = lista.filter((d) => tokenTorre(d.torre) === f.torre);
  if (f.texto) {
    const palabras = f.texto.split(' ').filter(Boolean);
    lista = lista.filter((d) => {
      const n = sinTildes(d.nombreRecibe);
      return palabras.every((p) => n.includes(p));
    });
  }

  const exacto = (d) => (f.apto && d.apto === f.apto ? 0 : 1);
  const aptoNum = (d) => Number(d.apto || Infinity);
  lista.sort((a, b) => exacto(a) - exacto(b)
    || (tokenTorre(a.torre) ?? '').localeCompare(tokenTorre(b.torre) ?? '', 'es', { numeric: true })
    || aptoNum(a) - aptoNum(b)
    || a.nombreRecibe.localeCompare(b.nombreRecibe, 'es'));

  return Promise.all(lista.slice(0, MAX_RESULTADOS).map(async (d) => ({
    domicilioId: d.id,
    residenteId: d.usuarioId,
    // `id` = residenteId: compatibilidad con los contratos actuales (S1.3 los cambia).
    id: d.usuarioId,
    nombre: d.nombreRecibe,
    torre: d.torre || null,
    apto: d.apto || null,
    etiqueta: etiquetaApartamento(d.torre, d.apto),
    pendientes: await prisma.package.count({
      where: {
        estado: { in: ['EN_RECEPCION', 'PROGRAMADO'] },
        OR: [{ domicilioId: d.id }, { domicilioId: null, residenteId: d.usuarioId }],
      },
    }),
  })));
}
