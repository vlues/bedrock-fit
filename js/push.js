/* ===================== Bedrock — push notifications ===================== */
/* Lock-screen notifications for an installed (Add to Home Screen) Bedrock,
   iOS 16.4+ / Android. Designed for zero ongoing effort: the user taps
   "Turn on" ONCE (Apple requires that single gesture — a permission prompt
   can't be shown without one), and from then on the backend cron wakes up
   daily, reads their synced profile, has Claude write a personal brief,
   and pushes it. Nothing to open, nothing to tap.

   Payloadless design: the push itself carries no data (which sidesteps Web
   Push payload encryption entirely); sw.js wakes on it and fetches the
   personal brief over the normal authed API. The session token the worker
   needs is stored in IndexedDB here at enable() time, because service
   workers can't read localStorage. */

const Push = (() => {

  function supported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }
  // iOS only allows web push for home-screen-installed apps.
  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }
  function isIOS() {
    return /iPhone|iPad|iPod/.test(navigator.userAgent);
  }
  // "Could work if the user turns it on" — used to decide whether to offer.
  function available() {
    if (!supported()) return false;
    if (isIOS() && !isStandalone()) return false; // Safari tab on iOS can't push
    return true;
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  function saveCredsForSW() {
    return new Promise((resolve) => {
      const open = indexedDB.open('bedrock-push', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('creds');
      open.onerror = () => resolve(false);
      open.onsuccess = () => {
        try {
          const tx = open.result.transaction('creds', 'readwrite');
          tx.objectStore('creds').put({ token: Sync.getToken(), backend: Sync.backendUrl() }, 'main');
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch (e) { resolve(false); }
      };
    });
  }

  async function api(path, body) {
    const res = await withTimeout(fetch(Sync.backendUrl() + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + Sync.getToken() },
      body: body ? JSON.stringify(body) : undefined,
    }), 12000, 'push-api');
    if (!res.ok) throw new Error('http_' + res.status);
    return res.json();
  }

  // Must be called from a user-gesture handler (Apple enforces it).
  async function enable() {
    if (!available()) return { ok: false, error: 'unsupported' };
    if (!Sync.isLoggedIn()) return { ok: false, error: 'not_signed_in' };
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return { ok: false, error: 'denied' };
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await api('/api/push/vapid-public-key');
      if (!publicKey) return { ok: false, error: 'server_not_configured' };
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await api('/api/push/subscribe', { endpoint: sub.endpoint });
      await saveCredsForSW();
      localStorage.setItem('bedrock_push_enabled', '1');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }

  async function disable() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        try { await api('/api/push/unsubscribe', { endpoint: sub.endpoint }); } catch (e) { /* best effort */ }
        await sub.unsubscribe();
      }
    } catch (e) { /* nothing to undo */ }
    localStorage.removeItem('bedrock_push_enabled');
    return { ok: true };
  }

  async function isEnabled() {
    if (!supported() || Notification.permission !== 'granted') return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      return !!(await reg.pushManager.getSubscription());
    } catch (e) { return false; }
  }

  // Keep the SW's token fresh (login/logout/token rotation) so the daily
  // fetch never dies of an expired credential without anyone noticing.
  async function refreshCreds() {
    if (localStorage.getItem('bedrock_push_enabled') && Sync.isLoggedIn()) await saveCredsForSW();
  }

  return { supported, available, isStandalone, isIOS, enable, disable, isEnabled, refreshCreds };
})();
