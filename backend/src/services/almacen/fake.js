// Almacén en memoria (T5.1) para desarrollo y pruebas. `urlFirmada` devuelve una
// data-URI con el contenido, así el navegador puede mostrarla sin red.

import { randomUUID } from 'node:crypto';
import { extensionDe } from './dataUri.js';

/**
 * @param {{alGuardar?: (args:object)=>void|Promise<void>}} [opciones]
 *   `alGuardar` se ejecuta antes de cada guardado; si lanza, simula una caída del almacén.
 */
export function crearAlmacenFake({ alGuardar } = {}) {
  const objetos = new Map(); // clave -> { contenido, tipo }
  return {
    nombre: 'fake',
    esLegado: false,
    objetos, // visible a propósito: las pruebas inspeccionan qué hay guardado
    async guardar({ conjuntoId, paqueteId, contenido, tipo }) {
      if (alGuardar) await alGuardar({ conjuntoId, paqueteId, tipo });
      const clave = `${conjuntoId}/${paqueteId ?? 'nuevo'}/${randomUUID()}.${extensionDe(tipo)}`;
      objetos.set(clave, { contenido, tipo });
      return { clave };
    },
    async urlFirmada(clave) {
      const o = objetos.get(clave);
      if (!o) return null;
      return `data:${o.tipo};base64,${o.contenido.toString('base64')}`;
    },
    async borrar(clave) {
      objetos.delete(clave);
    },
  };
}
