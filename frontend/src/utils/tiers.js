// Etiquetas de las categorías de peso (KAN-8, Fase D). SOLO etiquetas: los
// montos NO viven aquí — salen de /conjunto/config (fuente única). El precio
// que se cobra de verdad siempre lo recalcula el servidor con las tarifas del
// conjunto.
export const TIERS = [
  { value: 'MANO', label: 'Artículo de Mano (hasta 1 kg)' },
  { value: 'ESTANDAR', label: 'Paquete Estándar (1 a 5 kg)' },
  { value: 'VOLUMEN', label: 'Paquete Voluminoso (5 a 15 kg)' },
  { value: 'PESADO', label: 'Carga Especial (más de 15 kg)' },
];

// Combina las etiquetas con el mapa de tarifas del conjunto ({ MANO, ESTANDAR,
// ... }) para mostrar el costo de referencia. Si aún no hay tarifas cargadas,
// `costo` queda undefined (el llamador decide cómo mostrarlo).
export function tiersConCosto(tarifas) {
  return TIERS.map((t) => ({ ...t, costo: tarifas ? tarifas[t.value] : undefined }));
}
