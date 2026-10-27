// Limitador de intentos por clave (T1.4), p. ej. por IP en el login.
//
// Interfaz (LimitadorIntentos), pensada para cambiar la implementación en
// memoria por Redis sin tocar a los llamadores:
//   intentar(clave)        -> { permitido, segundosRestantes, minutosRestantes, reserva }
//   devolver(clave, reserva) -> void
//   limpiar(clave)         -> void
//
// RESERVA ATÓMICA. `intentar` cuenta el intento al instante y es SÍNCRONA: el
// llamador debe invocarla antes de cualquier `await`. Así, una ráfaga de
// peticiones paralelas no puede pasar todas la consulta antes de que alguna
// registre su fallo (Node ejecuta cada llamada síncrona de punta a punta).
// Si el cupo ya está lleno, responde { permitido: false } sin contar más.
//
// DEVOLVER. Un login exitoso llama `devolver(clave, reserva)` con la reserva
// que le dio `intentar`: deshace SOLO su propio intento (resta 1). No reinicia
// el contador: los fallos ajenos o previos siguen contando, así que quien
// tenga una cuenta propia no puede alternar aciertos para blanquear sus fallos.
// Si la ventana de esa reserva ya venció, no hace nada.
//
// Esta implementación vive en la memoria del proceso: cada instancia del
// backend cuenta aparte y un reinicio la borra. Con una sola réplica (Railway
// hoy) basta; con varias, usar un almacén compartido. La ventana es FIJA: se
// abre con el primer intento y todo se olvida al vencer.

export function crearLimitadorMemoria({ max, ventanaMs, ahora = () => Date.now() }) {
  const entradas = new Map(); // clave -> { usados, expira }
  let sinBarrer = 0;

  function barrer(t) {
    for (const [k, e] of entradas) if (e.expira <= t) entradas.delete(k);
  }

  return {
    intentar(clave) {
      const t = ahora();
      // Barrido ocasional para que claves de IPs que no vuelven no se acumulen.
      if (++sinBarrer >= 500) { sinBarrer = 0; barrer(t); }
      let e = entradas.get(clave);
      if (!e || e.expira <= t) {
        e = { usados: 0, expira: t + ventanaMs };
        entradas.set(clave, e);
      }
      if (e.usados >= max) {
        const segundosRestantes = Math.ceil((e.expira - t) / 1000);
        return { permitido: false, segundosRestantes, minutosRestantes: Math.max(1, Math.ceil(segundosRestantes / 60)), reserva: null };
      }
      e.usados += 1;
      return { permitido: true, segundosRestantes: 0, minutosRestantes: 0, reserva: e.expira };
    },
    devolver(clave, reserva) {
      const e = entradas.get(clave);
      if (!e || e.expira !== reserva || e.usados <= 0) return;
      e.usados -= 1;
    },
    limpiar(clave) {
      entradas.delete(clave);
    },
  };
}

export const LOGIN_MAX_FALLOS = 10;
export const LOGIN_VENTANA_MS = 15 * 60 * 1000;

// Solicitudes de enlace de acceso (T3.2): 5 por correo+IP cada 15 min.
export const ENLACE_MAX_SOLICITUDES = 5;
export const ENLACE_VENTANA_MS = 15 * 60 * 1000;
