import { useEffect, useId } from 'react';
import Icon from './Icon.jsx';

/** Selector de conjunto: <select> nativo de 56 px con label.
 *  conjuntos: [{slug, nombre}]. value: slug. onChange(slug).
 *  Con 1 conjunto queda preseleccionado y deshabilitado; un input oculto lleva el valor
 *  (un select disabled no viaja en formularios). cargando; error = falla de carga (bloquea, con onReintentar);
 *  invalido = mensaje de validación (no bloquea). */
export default function SelectorConjunto({
  conjuntos = [],
  value = '',
  onChange,
  cargando = false,
  error,
  invalido,
  onReintentar,
  id,
  label = 'Conjunto',
  name = 'conjunto',
  className = '',
}) {
  const auto = useId();
  const selectId = id ?? auto;
  const msg = error || invalido;
  const errId = `${selectId}-error`;
  const ayudaId = `${selectId}-ayuda`;
  const unico = !cargando && !error && conjuntos.length === 1 ? conjuntos[0] : null;

  useEffect(() => {
    if (unico && !value) onChange?.(unico.slug);
  }, [unico, value, onChange]);

  const ayuda = unico ? `Por ahora Puertayá funciona solo en ${unico.nombre}.` : null;
  const describedBy = [msg ? errId : null, ayuda ? ayudaId : null].filter(Boolean).join(' ') || undefined;
  const deshabilitado = cargando || Boolean(error) || Boolean(unico);
  const actual = unico ? unico.slug : value;

  let opciones;
  if (cargando) opciones = <option value="">Cargando conjuntos…</option>;
  else if (error) opciones = <option value="">No se pudo cargar</option>;
  else {
    opciones = (
      <>
        {!actual && <option value="">Elige tu conjunto</option>}
        {conjuntos.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.nombre}
          </option>
        ))}
      </>
    );
  }

  return (
    <div className={`ds-field ds-selector${msg ? ' ds-field--error' : ''} ${className}`.trim()}>
      <label className="ds-field__label" htmlFor={selectId}>
        {label}
      </label>
      <div className="ds-selector__caja">
        <select
          id={selectId}
          className="ds-field__input ds-selector__select"
          name={unico ? undefined : name}
          value={cargando || error ? '' : actual}
          onChange={(e) => onChange?.(e.target.value)}
          disabled={deshabilitado}
          aria-busy={cargando || undefined}
          aria-invalid={msg ? 'true' : undefined}
          aria-describedby={describedBy}
        >
          {opciones}
        </select>
        <Icon nombre="siguiente" size={20} trazo={2.5} className="ds-selector__flecha" />
      </div>
      {unico && <input type="hidden" name={name} value={unico.slug} />}
      {ayuda && (
        <span id={ayudaId} className="ds-field__ayuda">
          {ayuda}
        </span>
      )}
      {msg && (
        <span id={errId} className="ds-field__error" role="alert">
          <Icon nombre="error" size={18} trazo={2.5} />
          {msg}
        </span>
      )}
      {error && onReintentar && (
        <button type="button" className="ds-enlace" onClick={onReintentar}>
          Reintentar
        </button>
      )}
    </div>
  );
}
