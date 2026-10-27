// Fotos de un paquete sobre el almacén (T5.1). Lo comparten recepción y checkin.
//
// Flujo de escritura (para no dejar la recepción a medias):
//   1. subirFotos(): decodifica y valida TODAS (400/413 antes de tocar nada) y las
//      sube al almacén. En modo legado no sube: devuelve el JSON para Package.fotoUrl.
//   2. Dentro de la transacción: registrarFotos() crea las filas PaqueteFoto.
//   3. Si la transacción falla: descartarSubidas() intenta borrar lo subido
//      (mejor esfuerzo, se loguea; un objeto huérfano no rompe nada).

import { prisma } from '../config/db.js';
import { decodificarDataUri, fotosDeFotoUrl } from './almacen/index.js';

/**
 * @returns {Promise<{fotoUrl: string|null, subidas: {clave:string, tipo:string, orden:number}[]}>}
 */
export async function subirFotos({ almacen, conjuntoId, fotos, paqueteId = null }) {
  const lista = fotos ?? [];
  const decodificadas = lista.map((f, i) => decodificarDataUri(f, i + 1));
  if (!decodificadas.length) return { fotoUrl: null, subidas: [] };
  if (almacen.esLegado) return { fotoUrl: JSON.stringify(lista), subidas: [] };

  const subidas = [];
  try {
    for (let i = 0; i < decodificadas.length; i += 1) {
      const { contenido, tipo } = decodificadas[i];
      const { clave } = await almacen.guardar({ conjuntoId, paqueteId, contenido, tipo });
      subidas.push({ clave, tipo, orden: i });
    }
  } catch (e) {
    await descartarSubidas(almacen, subidas);
    throw e;
  }
  return { fotoUrl: null, subidas };
}

/** Crea las filas PaqueteFoto dentro de la transacción `tx` (el tenant sale del contexto). */
export async function registrarFotos(tx, paqueteId, subidas) {
  for (const s of subidas) {
    await tx.paqueteFoto.create({ data: { paqueteId, clave: s.clave, tipo: s.tipo, orden: s.orden } });
  }
}

/** Borra del almacén lo ya subido (mejor esfuerzo; nunca lanza). */
export async function descartarSubidas(almacen, subidas) {
  for (const s of subidas) {
    try {
      await almacen.borrar(s.clave);
    } catch (e) {
      console.error(`[fotos] no se pudo borrar ${s.clave} tras una recepción fallida: ${e.message}`);
    }
  }
}

export const EXPIRA_URL_FOTO_SEG = 600;

/**
 * Fotos de un paquete para el detalle: nuevas (URL firmada, 10 min) y legadas
 * (data-URI de Package.fotoUrl). Respeta el tenant del contexto.
 * @returns {Promise<{url:string, orden:number}[]>}
 */
export async function fotosDelPaquete({ almacen, paqueteId, fotoUrl }) {
  const filas = await prisma.paqueteFoto.findMany({ where: { paqueteId }, orderBy: { orden: 'asc' } });
  const fotos = [];
  for (const f of filas) {
    const url = await almacen.urlFirmada(f.clave, { expiraSeg: EXPIRA_URL_FOTO_SEG });
    if (url) fotos.push({ url, orden: f.orden });
  }
  const base = fotos.length;
  fotosDeFotoUrl(fotoUrl).forEach((url, i) => fotos.push({ url, orden: base + i }));
  return fotos;
}
