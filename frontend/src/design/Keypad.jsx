import Icon from './Icon.jsx';

/** Teclado numérico de 60 px. onKey recibe '0'-'9', 'borrar' o el `id` de la tecla extra.
 *  extra: { id, label, ariaLabel? } ocupa la esquina inferior izquierda (p. ej. Torre). */
export default function Keypad({ onKey, extra, ariaLabelBorrar = 'Borrar', className = '' }) {
  const tecla = (v) => (
    <button key={v} type="button" className="ds-key" onClick={() => onKey?.(v)}>
      {v}
    </button>
  );
  return (
    <div className={`ds-keypad ${className}`.trim()} role="group" aria-label="Teclado numérico">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(tecla)}
      {extra ? (
        <button
          type="button"
          className="ds-key ds-key--texto"
          aria-label={extra.ariaLabel}
          onClick={() => onKey?.(extra.id)}
        >
          {extra.label}
        </button>
      ) : (
        <span className="ds-key ds-key--vacio" aria-hidden="true" />
      )}
      {tecla('0')}
      <button type="button" className="ds-key" aria-label={ariaLabelBorrar} onClick={() => onKey?.('borrar')}>
        <Icon nombre="borrar" size={26} trazo={2} />
      </button>
    </div>
  );
}
