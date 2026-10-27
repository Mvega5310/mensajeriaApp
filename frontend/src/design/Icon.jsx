// Íconos de trazo, inline, decorativos (aria-hidden). Sin emoji.
const PATHS = {
  volver: <path d="M15 6l-6 6 6 6" />,
  siguiente: <path d="M9 6l6 6-6 6" />,
  lupa: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </>
  ),
  borrar: <path d="M21 5H9l-6 7 6 7h12zM12 9l6 6M18 9l-6 6" />,
  cerrar: <path d="M6 6l12 12M18 6L6 18" />,
  recibir: <path d="M3 8l9-5 9 5v10l-9 5-9-5zM3 8l9 5 9-5M12 13v10" />,
  entregar: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  lista: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  casa: <path d="M3 9l9-6 9 6v12H3z" />,
  reloj: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  check: <path d="M5 12l5 5 9-10" />,
  alerta: (
    <>
      <path d="M12 8v5M12 17h.01" />
      <circle cx="12" cy="12" r="9" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 17h.01" />
    </>
  ),
  sinSenal: <path d="M2 8a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M9 16a4 4 0 0 1 6 0M3 3l18 18" />,
  whatsapp: <path d="M21 12a9 9 0 0 1-13.5 7.8L3 21l1.3-4.4A9 9 0 1 1 21 12z" />,
  regalo: <path d="M4 11h16v9H4zM12 11v9M3 7h18v4H3z" />,
  camara: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  sol: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" />
    </>
  ),
  luna: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />,
};

export const ICONOS = Object.keys(PATHS);

export default function Icon({ nombre, size = 24, trazo = 2.2, className = '' }) {
  return (
    <svg
      className={`ds-icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={trazo}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[nombre]}
    </svg>
  );
}
