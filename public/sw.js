// Service worker for push notifications. Kept minimal — no offline caching yet.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = { title: 'Practice word', body: '' };
  try {
    if (event.data) data = event.data.json();
  } catch {
    if (event.data) data = { title: 'Practice word', body: event.data.text() };
  }
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon.svg',
    badge: data.badge || '/icon.svg',
    tag: data.tag || 'practice-word',
    renotify: true,
    data: { url: data.url || '/' },
    // iOS honors these when installed as PWA
    requireInteraction: false,
    silent: false,
  };
  event.waitUntil(self.registration.showNotification(data.title || 'Practice word', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) {
      if ('focus' in client) {
        try { await client.navigate(url); } catch {}
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
