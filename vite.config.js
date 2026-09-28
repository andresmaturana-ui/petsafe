import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Rutas relativas: funciona en GitHub Pages o en cualquier subcarpeta.
  base: './',
  build: { chunkSizeWarningLimit: 2000 },
  plugins: [
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectManifest: { maximumFileSizeToCacheInBytes: 5 * 1024 * 1024 },
      includeAssets: ['icons/*'],
      manifest: {
        name: 'Pet Safe',
        short_name: 'Pet Safe',
        description: 'Registra a tu mascota con reconocimiento facial y encuéntrala si se pierde.',
        lang: 'es',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#fff7ee',
        theme_color: '#f2785c',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});
