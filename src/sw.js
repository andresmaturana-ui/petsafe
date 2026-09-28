// Service Worker: funciona sin conexión y muestra notificaciones.
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Pesos del modelo de reconocimiento y teselas del mapa.
registerRoute(
  ({ url }) => /tfhub\.dev|kaggle|storage\.googleapis\.com/.test(url.host),
  new CacheFirst({ cacheName: 'model', plugins: [new ExpirationPlugin({ maxEntries: 40 })] }),
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
