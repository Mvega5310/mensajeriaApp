// Limitador de intentos fallidos por clave (T1.4), p. ej. por IP en el login.
//
// Interfaz (LimitadorIntentos), pensada para cambiar la implementación en
// memoria por Redis sin tocar a los llamadores:
//   registrarFallo(clave)  -> void
//   estaBloqueado(clave)   -> { bloqueado: boolean, segundosRestantes: number }
//   limpiar(clave)         -> void
//
// Esta implementación vive en la memoria del proceso: cada instancia del
// backend cuenta aparte y un reinicio la borra. Con una sola réplica (Railway
// hoy) basta; con varias, usar un almacén compartido. La ventana es FIJA: se
// abre con el primer fallo y todo se olvida al vencer.

export function crearLimitadorMemoria({ max, ventanaMs, ahora = () => Date.now() }) {
  const entradas = new Map(); // clave -> { fallos, expira }
  let sinBarrer = 0;

  function barrer(t) {
    for (const [k, e] of entradas) if (e.expira <= t) entradas.delete(k);
  }

  return {
    registrarFallo(clave) {
      const t = ahora();
      // Barrido ocasional para que claves de IPs que no vuelven no se acumulen.
      if (++sinBarrer >= 500) { sinBarrer = 0; barrer(t); }
      const e = entradas.get(clave);
      if (!e || e.expira <= t) entradas.set(clave, { fallos: 1, expira: t + ventanaMs });
      else e.fallos += 1;
    },
    estaBloqueado(clave) {
      const t = ahora();
      const e = entradas.get(clave);
      if (!e || e.expira <= t) {
        if (e) entradas.delete(clave);
        return { bloqueado: false, segundosRestantes: 0 };
      }
      if (e.fallos < max) return { bloqueado: false, segundosRestantes: 0 };
      return { bloqueado: true, segundosRestantes: Math.ceil((e.expira - t) / 1000) };
    },
    limpiar(clave) {
      entradas.delete(clave);
    },
  };
}

export const LOGIN_MAX_FALLOS = 10;
export const LOGIN_VENTANA_MS = 15 * 60 * 1000;
