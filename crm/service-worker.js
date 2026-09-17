// Self-destructing service worker.
// Earlier versions cached HTML shells (including the retired Gethub page),
// which caused stale screens to keep appearing. This SW takes over, wipes all
// caches, unregisters itself, and reloads open tabs so every request goes
// straight to the live server from now on.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    } catch (e) { /* ignore */ }
    try { await self.registration.unregister(); } catch (e) { /* ignore */ }
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((client) => {
      try { client.navigate(client.url); } catch (e) { /* ignore */ }
    });
  })());
});

// No fetch handler: all requests bypass the SW and hit the network directly.
