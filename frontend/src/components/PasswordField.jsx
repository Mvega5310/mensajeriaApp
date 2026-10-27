import { useState } from 'react';
import { Field } from '../design';

/** Contraseña con casilla "Mostrar contraseña" (sin emoji, 48 px). */
export default function PasswordField({ id, label = 'Contraseña', value, onChange, minLength, pattern, hint, autoComplete }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="auth-pass">
      <Field id={id} label={label} type={visible ? 'text' : 'password'} required minLength={minLength} pattern={pattern}
        title={pattern ? hint : undefined} value={value} onChange={onChange} ayuda={hint} autoComplete={autoComplete} />
      <label className="auth-check" style={{ alignItems: 'center' }}>
        <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
        Mostrar contraseña
      </label>
    </div>
  );
}
