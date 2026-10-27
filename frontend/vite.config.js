import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Puertaya Ipanema',
        short_name: 'Puertaya',
        description: 'Recepción, custodia y entrega de paquetes — Conjunto Ipanema',
        theme_color: '#1E63C9',
        background_color: '#F4F6F9',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        lang: 'es',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // El shell de la app (JS/CSS) se cachea para que cargue rápido y algo
      // funcione sin señal; los datos reales (paquetes, comentarios) siguen
      // yendo siempre a la red — nunca se sirven paquetes/PIN desde caché.
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
        // La API nunca se cachea (T4.5): ni el fallback de navegación ni el
        // runtime cache pueden servir paquetes/PIN viejos. Sin señal, el
        // fetch falla y la cola de recepciones se encarga.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          { urlPattern: ({ url }) => url.pathname.startsWith('/api/'), handler: 'NetworkOnly' },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
