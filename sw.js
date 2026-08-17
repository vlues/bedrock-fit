/* ===================== Bedrock — service worker ===================== */
/* Three jobs:
   1. Offline/instant open: app-shell caching (stale-while-revalidate),
      so an installed Bedrock opens like a native app even with no signal.
   2. Push: the backend cron sends a PAYLOADLESS push once a day (no
      encryption needed that way); this worker wakes, uses the session
      token it was handed at subscribe time (IndexedDB — localStorage
      doesn't exist in a service worker) to fetch the user's PERSONAL
      AI-written brief from the backend, and shows it as the notification.
      The user does nothing; it just arrives.
   3. Notification tap → focus or open the app.
   Bump CACHE_VERSION when shipping breaking asset changes. */

const CACHE_VERSION = 'bedrock-v1';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './manifest.json',
  './js/i18n.js', './js/store.js', './js/sync.js', './js/api.js', './js/workout.js',
  './js/supplements.js', './js/chart.js', './js/scan.js', './js/barcode.js',
  './js/camera.js', './js/trajectory.js', './js/insights.js', './js/nutrition.js',
  './js/fitbit.js', './js/push.js', './js/app.js',
  './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate for same-origin GETs: serve from cache instantly,
// refresh the cache in the background — also quietly fixes the "GitHub
// Pages caches JS for 10 minutes after a deploy" mixed-version window,
// since the whole shell updates together on the next load.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API + fonts go straight to network
  event.respondWith(
    caches.match(req).then((cached) => {
      const refresh = fetch(req).then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || refresh;
    })
  );
});

// ---- IndexedDB: the token + backend URL js/push.js stored at subscribe time
function readPushCreds() {
  return new Promise((resolve) => {
    const open = indexedDB.open('bedrock-push', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('creds');
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      try {
        const tx = open.result.transaction('creds', 'readonly');
        const get = tx.objectStore('creds').get('main');
        get.onsuccess = () => resolve(get.result || null);
        get.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    };
  });
}

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let title = 'Bedrock';
    let body = 'Your daily brief is ready — tap to see today\'s plan.';
    try {
      const creds = await readPushCreds();
      if (creds && creds.token && creds.backend) {
        const res = await fetch(creds.backend + '/api/push/brief', {
          headers: { authorization: 'Bearer ' + creds.token },
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.body) { title = data.title || title; body = data.body; }
        }
      }
    } catch (e) { /* generic text is the fallback */ }
    await self.registration.showNotification(title, {
      body,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: 'bedrock-daily-brief', // one per day replaces, never stacks
      data: { url: './' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientList) {
      if ('focus' in client) return client.focus();
    }
    return self.clients.openWindow('./');
  })());
});
