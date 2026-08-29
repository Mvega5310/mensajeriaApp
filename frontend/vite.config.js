import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon-16.png', 'favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Puertaya Ipanema',
        short_name: 'Puertaya',
        description: 'Recepción, custodia y entrega de paquetes — Conjunto Ipanema',
        theme_color: '#1c2f52',
        background_color: '#F4F3F1',
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
      },
    }),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
