import { useId } from 'react';
import Icon from './Icon.jsx';

/** Label + input de 56 px + ayuda + error. Resto de props van al <input>.
 *  error: texto (en dos partes: qué pasó y qué hacer). mono: cifras en mono. */
export default function Field({ label, error, ayuda, mono = false, id, className = '', ...input }) {
  const auto = useId();
  const inputId = id ?? auto;
  const errId = `${inputId}-error`;
  const ayudaId = `${inputId}-ayuda`;
  const describedBy = [error ? errId : null, ayuda ? ayudaId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`ds-field${error ? ' ds-field--error' : ''} ${className}`.trim()}>
      <label className="ds-field__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className={`ds-field__input${mono ? ' ds-field__input--mono' : ''}`}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
        {...input}
      />
      {ayuda && (
        <span id={ayudaId} className="ds-field__ayuda">
          {ayuda}
        </span>
      )}
      {error && (
        <span id={errId} className="ds-field__error" role="alert">
          <Icon nombre="error" size={18} trazo={2.5} />
          {error}
        </span>
      )}
    </div>
  );
}
