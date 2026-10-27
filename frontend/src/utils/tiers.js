// Etiquetas de presentación de las categorías de peso. Los rangos de peso y
// los montos NO viven aquí: los montos salen de /conjunto/config (tarifas) y
// el precio que se cobra de verdad siempre lo recalcula el servidor.
export const TIERS = [
  { value: 'MANO', label: 'Artículo de mano' },
  { value: 'ESTANDAR', label: 'Paquete estándar' },
  { value: 'VOLUMEN', label: 'Paquete voluminoso' },
  { value: 'PESADO', label: 'Carga especial' },
];

// Combina las etiquetas con el mapa de tarifas del conjunto ({ MANO, ESTANDAR,
// ... }) para mostrar el costo de referencia. Si aún no hay tarifas cargadas,
// `costo` queda undefined (el llamador decide cómo mostrarlo).
export function tiersConCosto(tarifas) {
  return TIERS.map((t) => ({ ...t, costo: tarifas ? tarifas[t.value] : undefined }));
}
