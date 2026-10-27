import Icon from './Icon.jsx';
import useTheme from './useTheme.js';

/** Botón de 48 px que alterna día/noche. Autónomo: usa useTheme internamente. */
export default function ThemeToggle({ className = '' }) {
  const { tema, alternar } = useTheme();
  const noche = tema === 'noche';
  return (
    <button
      type="button"
      className={`ds-themetoggle ${className}`.trim()}
      onClick={alternar}
      aria-label={noche ? 'Cambiar a modo día' : 'Cambiar a modo noche'}
      title={noche ? 'Modo día' : 'Modo noche'}
    >
      <Icon nombre={noche ? 'sol' : 'luna'} size={24} />
    </button>
  );
}
