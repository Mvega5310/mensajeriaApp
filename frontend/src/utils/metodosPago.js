// Etiqueta de presentación de un método de pago. Los códigos (EFECTIVO,
// TRANSFERENCIA, ...) y su orden vienen de GET /conjunto/config (metodosPago):
// aquí no hay lista fija. Los valores guardados antes de T2.6 ("Efectivo en
// puerta", ...) también se ven bien con esta misma regla.
export function etiquetaMetodoPago(codigo) {
  if (!codigo) return '—';
  const s = String(codigo).toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
