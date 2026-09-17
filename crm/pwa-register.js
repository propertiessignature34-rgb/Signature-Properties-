(() => {
  if (!('serviceWorker' in navigator)) return;

  // Actively clean up any previously-registered service worker + caches so no
  // stale HTML shell (e.g. the retired Gethub screen) can be served again.
  navigator.serviceWorker.getRegistrations()
    .then((regs) => regs.forEach((reg) => reg.unregister().catch(() => {})))
    .catch(() => {});
  if (window.caches && caches.keys) {
    caches.keys().then((keys) => keys.forEach((key) => caches.delete(key))).catch(() => {});
  }
})();
