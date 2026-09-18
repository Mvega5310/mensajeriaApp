// Controlado desde afuera (ver hooks/useTheme.js) para que el logo de
// marca, que vive junto a este botón, pueda compartir el mismo valor de
// tema y cambiar de versión clara/oscura al mismo tiempo que el resto
// de la app.
export default function ThemeToggle({ theme, setTheme }) {
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
      aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );
}
