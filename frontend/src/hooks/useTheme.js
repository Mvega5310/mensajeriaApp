import { useEffect, useState } from 'react';

function getSystemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// Fuente única del tema para quien lo necesite (ThemeToggle y el logo de
// marca, que debe cambiar de versión clara/oscura junto con el resto de
// la app) — cada uno que llame a este hook comparte el mismo valor
// mientras esté montado en el mismo árbol de componentes.
export default function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || (getSystemPrefersDark() ? 'dark' : 'light'));

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  return [theme, setTheme];
}
