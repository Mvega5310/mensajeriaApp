// Franjas de 2 horas — más específicas que las 2 originales, para que el
// operador pueda organizar rondas de reparto por zona/hora con un solo
// operador cubriendo ~400 apartamentos.
export const TIME_SLOTS = [
  '8:00 a.m. - 10:00 a.m.',
  '10:00 a.m. - 12:00 m.',
  '12:00 m. - 2:00 p.m.',
  '2:00 p.m. - 4:00 p.m.',
  '4:00 p.m. - 6:00 p.m.',
  '6:00 p.m. - 8:00 p.m.',
];

export const PAYMENT_METHODS = [
  { value: 'Efectivo en puerta', label: '💵 Efectivo en puerta' },
  { value: 'Transferencia digital previa', label: '📱 Transferencia digital previa' },
];
