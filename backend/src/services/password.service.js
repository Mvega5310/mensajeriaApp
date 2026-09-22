// Política de contraseña — fuente única (KAN-8, Fase F).
// La usa register()/resetPassword() (auth.controller) y el alta de conjunto
// (scripts/lib/altaConjunto). Tener una sola definición evita que el script y
// la API diverjan en lo que consideran una contraseña válida.
//
// Mínimo 8 caracteres, al menos una letra y un número. Se valida en el servidor
// porque el minLength/patrón del formulario es solo una ayuda visual.
export const PASSWORD_POLICY = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

export const PASSWORD_POLICY_MSG =
  'La contraseña debe tener mínimo 8 caracteres, con al menos una letra y un número';

export function cumplePoliticaPassword(password) {
  return typeof password === 'string' && PASSWORD_POLICY.test(password);
}
