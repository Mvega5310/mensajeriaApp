// Espejo de backend/src/services/tariff.service.js — solo para mostrar
// etiquetas y una tarifa de referencia en el cliente. El precio que se
// cobra de verdad siempre lo recalcula el servidor.
export const TIERS = [
  { value: 'MANO', label: 'Artículo de Mano (hasta 1 kg)', costo: 3000 },
  { value: 'ESTANDAR', label: 'Paquete Estándar (1 a 5 kg)', costo: 4500 },
  { value: 'VOLUMEN', label: 'Paquete Voluminoso (5 a 15 kg)', costo: 7000 },
  { value: 'PESADO', label: 'Carga Especial (más de 15 kg)', costo: 12000 },
];
