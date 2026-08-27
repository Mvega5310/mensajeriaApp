// Tarifas fijadas en el servidor: el cliente solo envía la categoría,
// nunca el monto (evita que un cliente manipulado invente su propio costo).
export const TARIFAS = {
  MANO: 3000,
  ESTANDAR: 4500,
  VOLUMEN: 7000,
  PESADO: 12000,
};

export function costoPara(categoriaPeso) {
  const costo = TARIFAS[categoriaPeso];
  if (costo === undefined) {
    throw new Error(`Categoría de peso inválida: ${categoriaPeso}`);
  }
  return costo;
}
