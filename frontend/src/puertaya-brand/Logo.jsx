import React, { useEffect, useState } from "react";

import selloLight from "./logos/sello/puertaya-sello-light.png";
import selloDark from "./logos/sello/puertaya-sello-dark.png";
import iconoLight from "./logos/icono/puertaya-icono-light.png";
import iconoDark from "./logos/icono/puertaya-icono-dark.png";

const SOURCES = {
  sello: { light: selloLight, dark: selloDark },
  icono: { light: iconoLight, dark: iconoDark },
};

/**
 * Logo de Puertayá.
 *
 * Props:
 *   variant: "icono" (por defecto) | "sello"
 *     - "icono": solo la puerta con la P. Ideal para encabezados y espacios chicos.
 *     - "sello": el emblema completo con texto. Para bienvenida, facturas, membretes.
 *   mode: "light" | "dark" | undefined
 *     - undefined -> detecta el modo del sistema automáticamente.
 *     - si tu app ya maneja el tema, pásale aquí tu valor ("light"/"dark").
 *   size: tamaño en px (por defecto 96).
 *
 * Ejemplos:
 *   <Logo />                                  // ícono, modo automático
 *   <Logo variant="sello" size={160} />       // sello completo
 *   <Logo mode={temaOscuro ? "dark" : "light"} />
 */
export default function Logo({ variant = "icono", size = 96, mode, alt, style }) {
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
  const set = SOURCES[variant] || SOURCES.icono;
  const src = isDark ? set.dark : set.light;

  return (
    <img
      src={src}
      alt={alt || "Puertayá"}
      width={size}
      height={size}
      style={{ display: "block", objectFit: "contain", ...style }}
    />
  );
}
