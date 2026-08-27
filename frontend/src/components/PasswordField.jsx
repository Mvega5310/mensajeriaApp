import { useState } from 'react';

export default function PasswordField({ id, label = 'Contraseña', value, onChange, minLength, pattern, hint }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-wrap">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          required
          minLength={minLength}
          pattern={pattern}
          title={pattern ? hint : undefined}
          value={value}
          onChange={onChange}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        >
          {visible ? '🙈' : '👁️'}
        </button>
      </div>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}
