// El lote verificado (con su tokenEntrega) vive solo en memoria del módulo: nunca en
// localStorage ni en el estado de navegación (que el navegador conserva al recargar).
let lote = null;
export const guardarLote = (l) => { lote = l; };
export const leerLote = () => lote;
export const limpiarLote = () => { lote = null; };
