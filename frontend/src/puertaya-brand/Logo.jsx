import React, { useEffect, useState } from "react";

import iconoLight from "./logos/icono/puertaya-icono-light.png";
import iconoDark from "./logos/icono/puertaya-icono-dark.png";
import lockupLight from "./logos/lockup/puertaya-lockup-light.png";

const SOURCES = {
  icono: { light: iconoLight, dark: iconoDark },
  // El imagotipo (símbolo + "Puertayá" + eslogan) transparente solo existe
  // en claro. En oscuro no hay archivo equivalente (ver LEEME.md del kit),
  // así que se compone el ícono oscuro + el nombre en texto (sugerencia del
  // propio kit) en vez de mostrar el lockup claro ilegible sobre fondo oscuro.
  lockup: { light: lockupLight, dark: null },
};

/**
 * Logo de Puertayá.
 *
 * Props:
 *   variant: "icono" (por defecto) | "lockup"
 *     - "icono": solo el hexágono con la puerta/P. Para encabezados y espacios chicos.
 *     - "lockup": símbolo + "Puertayá" + eslogan. Para bienvenida, web, documentos.
 *   mode: "light" | "dark" | undefined
 *     - undefined -> detecta el modo del sistema automáticamente.
 *     - si tu app ya maneja el tema, pásale tu valor ("light"/"dark").
 *   size: alto en px (por defecto 96). El ancho se ajusta solo.
 *
 * Ejemplos:
 *   <Logo />                                   // ícono, modo automático
 *   <Logo variant="lockup" size={64} />        // imagotipo (claro)
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

  if (variant === "lockup" && isDark) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: size * 0.16, ...style }}>
        <img
          src={iconoDark}
          alt=""
          height={size}
          style={{ display: "block", width: "auto", objectFit: "contain" }}
        />
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
          <span style={{ fontSize: size * 0.32, fontWeight: 800, color: "var(--puertaya-silver)" }}>
            Puertayá
          </span>
          <span style={{ fontSize: size * 0.12, fontWeight: 500, color: "var(--puertaya-teal)" }}>
            De la portería a tu puerta.
          </span>
        </div>
      </div>
    );
  }

  const set = SOURCES[variant] || SOURCES.icono;
  const src = isDark ? set.dark : set.light;

  return (
    <img
      src={src}
      alt={alt || "Puertayá — De la portería a tu puerta"}
      height={size}
      style={{ display: "block", width: "auto", objectFit: "contain", ...style }}
    />
  );
}
