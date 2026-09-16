(() => {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => {});

  let deferredPrompt = null;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (isStandalone) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Install App';
  button.setAttribute('data-testid', 'install-pwa-button');
  button.setAttribute('aria-label', 'Install Signature Properties app');
  Object.assign(button.style, {
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    zIndex: '9999',
    minHeight: '42px',
    padding: '0 16px',
    border: '1px solid #d4a017',
    borderRadius: '10px',
    background: '#2c1405',
    color: '#f6e1a3',
    font: '700 13px system-ui, sans-serif',
    boxShadow: '0 8px 24px rgba(44,20,5,.24)',
    display: 'none'
  });
  document.body.appendChild(button);

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    button.style.display = 'block';
  });

  const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  if (isIos) button.style.display = 'block';

  button.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      button.style.display = 'none';
      return;
    }
    window.alert('iPhone/iPad: Share button tap karein, phir “Add to Home Screen” choose karein.');
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    button.style.display = 'none';
  });
})();