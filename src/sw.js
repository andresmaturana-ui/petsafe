// Service Worker: funciona sin conexión y muestra notificaciones.
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Motor de reconocimiento (transformers.js y ONNX Runtime) y teselas del mapa.
// Los pesos de los modelos los guarda transformers.js en su propio caché.
registerRoute(
  ({ url }) => url.host === 'cdn.jsdelivr.net' && /@huggingface\/transformers@|onnxruntime-web@/.test(url.pathname),
  new CacheFirst({ cacheName: 'model', plugins: [new ExpirationPlugin({ maxEntries: 20 })] }),
);
// Detector de cabezas propio: se usa guardado y se actualiza en segundo plano
// cuando se publica uno nuevo.
registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.endsWith('/models/pet-head.onnx'),
  new StaleWhileRevalidate({ cacheName: 'head-model' }),
);
registerRoute(
  ({ url }) => url.host.endsWith('tile.openstreetmap.org'),
  new CacheFirst({ cacheName: 'tiles', plugins: [new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 7 * 86400 })] }),
);

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Listo para Web Push desde un servidor: { title, body, url }.
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'Pet Safe', {
      body: data.body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      data: { url: data.url || '#/avisos' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '#/avisos';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (windows.length) {
        windows[0].postMessage({ type: 'navigate', url });
        return windows[0].focus();
      }
      return self.clients.openWindow(new URL(url, self.registration.scope).href);
    })(),
  );
});
