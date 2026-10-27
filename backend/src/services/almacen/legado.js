// Modo legado (T5.1): las fotos viven como base64 dentro de Package.fotoUrl
// (un JSON con hasta N data-URI, o un string plano en registros muy viejos).
//
// `fotosDeFotoUrl` es la lectura de siempre (la usa GET /packages/:id/foto para
// los paquetes anteriores a T5.1). `crearAlmacenLegado` es el "almacén" que se
// elige en producción cuando todavía no hay bucket: no guarda objetos (por eso
// `esLegado`), el llamador sigue escribiendo fotoUrl como antes.

/** @returns {string[]} data-URI (o URLs) guardadas en fotoUrl; [] si no hay. */
export function fotosDeFotoUrl(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((f) => typeof f === 'string' && f) : [raw];
  } catch {
    return [raw];
  }
}

export function crearAlmacenLegado() {
  return {
    nombre: 'bd-legado',
    esLegado: true,
    async guardar() {
      throw new Error('El almacén legado no guarda objetos: las fotos van en Package.fotoUrl.');
    },
    // En legado la "clave" ya es la propia imagen (data-URI): se devuelve tal cual.
    async urlFirmada(clave) {
      return clave;
    },
    async borrar() {},
  };
}
