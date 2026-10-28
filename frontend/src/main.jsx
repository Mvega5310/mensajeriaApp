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
// Solo si la página YA tenía un service worker al cargar: en la primera visita
// el SW se instala y reclama la pestaña (clientsClaim) sin que haya versión
// vieja que reemplazar, y recargar entonces borraba lo que el usuario estaba
// escribiendo (p. ej. el formulario de registro) un par de segundos después de abrir.
if ('serviceWorker' in navigator) {
  let yaRecargando = false;
  const teniaControlador = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!teniaControlador || yaRecargando) return;
    yaRecargando = true;
    window.location.reload();
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
