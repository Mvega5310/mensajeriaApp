import React, { useEffect, useState } from "react";

import iconoLight from "./logos/icono/puertaya-icono-light.png";
import iconoDark from "./logos/icono/puertaya-icono-dark.png";
import lockupLight from "./logos/lockup/puertaya-lockup-light.png";
import lockupDark from "./logos/lockup/puertaya-lockup-dark.png";

const SOURCES = {
  icono: { light: iconoLight, dark: iconoDark },
  lockup: { light: lockupLight, dark: lockupDark },
};

/**
 * Logo de Puertayá.
 *
 * IMPORTANTE: el "lockup" ya incluye el símbolo + "Puertayá" + el eslogan como
 * una sola imagen. NO pongas texto "Puertayá" aparte al lado: usa solo <Logo />.
 *
 * Props:
 *   variant: "lockup" (por defecto) | "icono"
 *     - "lockup": símbolo + nombre + eslogan. Para login, bienvenida, encabezados.
 *     - "icono": solo el hexágono. Para barras compactas o espacios muy chicos.
 *   mode: "light" | "dark" | undefined
 *     - undefined -> detecta el modo del sistema automáticamente.
 *     - si tu app maneja el tema, pásale tu valor ("light"/"dark").
 *   size: alto en px. Por defecto 72 (mesurado). El ancho se ajusta solo.
 *
 * Ejemplo en el login (una sola imagen, centrada y discreta):
 *   <Logo variant="lockup" mode={temaOscuro ? "dark" : "light"} size={72} />
 */
export default function Logo({ variant = "lockup", size = 72, mode, alt, style }) {
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    if (mode) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mq.matches);
    const onChange = (e) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  const isDark = mode ? mode === "dark" : systemDark;
  const set = SOURCES[variant] || SOURCES.lockup;
  const src = isDark ? set.dark : set.light;

  return (
    <img
      src={src}
      alt={alt || "Puertayá — De la portería a tu puerta"}
      height={size}
      style={{ display: "block", width: "auto", maxWidth: "100%", objectFit: "contain", ...style }}
    />
  );
}
