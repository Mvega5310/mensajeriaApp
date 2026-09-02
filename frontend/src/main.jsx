import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Sin esto, un usuario con la PWA ya instalada se queda viendo la versión
// vieja del JS/CSS hasta que cierra y reabre la app dos veces: el nuevo
// service worker se activa en segundo plano (ver skipWaiting/clientsClaim
// en vite.config.js), pero la pestaña ya abierta no recarga sola para
// tomar los archivos nuevos. Esto la recarga automáticamente apenas el
// nuevo service worker toma control.
if ('serviceWorker' in navigator) {
  let yaRecargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (yaRecargando) return;
    yaRecargando = true;
    window.location.reload();
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
