// Métodos de pago reales del servicio al entregar (T2.1). Validado en dominio, no
// enum de BD (mismo criterio que los estados). Package.metodoPago guarda uno.

export const METODOS_PAGO = Object.freeze(['EFECTIVO', 'TRANSFERENCIA']);

export function esMetodoPagoValido(valor) {
  return METODOS_PAGO.includes(valor);
}
