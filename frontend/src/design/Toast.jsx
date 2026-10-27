import Icon from './Icon.jsx';

const ICONO = { aviso: 'sinSenal', error: 'error', info: 'check' };

/** tipo: 'aviso' (role=status) | 'info' (role=status) | 'error' (role=alert).
 *  icono sobreescribe el ícono; onClose muestra un botón de cerrar de 48 px. */
export default function Toast({ tipo = 'aviso', icono, onClose, children, className = '' }) {
  return (
    <div className={`ds-toast ds-toast--${tipo} ${className}`.trim()} role={tipo === 'error' ? 'alert' : 'status'}>
      <Icon nombre={icono ?? ICONO[tipo]} size={20} trazo={2.5} />
      <span>{children}</span>
      {onClose && (
        <button type="button" className="ds-toast__cerrar" aria-label="Cerrar aviso" onClick={onClose}>
          <Icon nombre="cerrar" size={20} />
        </button>
      )}
    </div>
  );
}
