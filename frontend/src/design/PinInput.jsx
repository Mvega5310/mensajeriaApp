/** Campo PIN de solo lectura (se llena con Keypad). value: string de dígitos.
 *  Celda llena / actual (borde azul) / vacía (punteada). error pinta rojo. */
export default function PinInput({ value = '', length = 4, error = false, label = 'PIN', className = '' }) {
  const celdas = Array.from({ length }, (_, i) => value[i] ?? '');
  const actual = Math.min(value.length, length - 1);
  return (
    <div
      className={`ds-pin${error ? ' ds-pin--error' : ''} ${className}`.trim()}
      role="group"
      aria-label={`${label}: ${value.length} de ${length} dígitos`}
    >
      {celdas.map((d, i) => {
        const estado = d ? '' : i === actual ? ' ds-pin__celda--actual' : ' ds-pin__celda--vacia';
        return (
          <span key={i} className={`ds-pin__celda${estado}`} aria-hidden="true">
            {d}
          </span>
        );
      })}
    </div>
  );
}
