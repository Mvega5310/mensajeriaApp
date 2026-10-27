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

// Nombre corto de cada categoría (tiles, etiquetas) y una pista de tamaño para el operador.
export const NOMBRES_CORTOS = {
  MANO: { nombre: 'Mano', ayuda: 'Sobre o bolsa' },
  ESTANDAR: { nombre: 'Estándar', ayuda: 'Caja mediana' },
  VOLUMEN: { nombre: 'Volumen', ayuda: 'Caja grande' },
  PESADO: { nombre: 'Pesado', ayuda: 'Carga especial' },
};

// Empresa que trajo el paquete: transportadora, o el proveedor si dice algo útil.
export function quienTrajo(p) {
  if (p.transportadora) return p.transportadora;
  return p.proveedor && p.proveedor !== 'Sin especificar' ? p.proveedor : 'Sin transportadora';
}
