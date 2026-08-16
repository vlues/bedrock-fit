/* ===================== Bedrock — cloud sync + account ===================== */
/* Talks to the optional Cloudflare Worker backend (cloudflare-worker/) for
   two things: syncing this profile across devices, and — since that same
   backend holds the Anthropic key server-side — unlocking Bedrock's AI
   features. No personal API key ever touches this browser; signing in is
   the only "unlock AI" step there is. The app stays fully usable without an
   account too: every AI feature keeps its non-AI fallback (see
   js/insights.js), and local data always lives in localStorage regardless
   of sync state. */

const Sync = (() => {
  // Patched automatically by cloudflare-worker/deploy-backend.sh. Leave
  // null to run with sync/AI features off (pure offline mode) — e.g. before
  // the backend has been deployed yet.
  const BACKEND_URL = null;

  const TOKEN_KEY = 'bedrock_sync_token';
  const USERNAME_KEY = 'bedrock_sync_username';
  const PUSHED_AT_KEY = 'bedrock_sync_pushed_at';

  let pushTimer = null;

  function backendUrl() { return BACKEND_URL; }
  function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
  function getUsername() { return localStorage.getItem(USERNAME_KEY) || ''; }
  function isLoggedIn() { return !!(BACKEND_URL && getToken()); }

  async function apiFetch(path, opts = {}) {
    if (!BACKEND_URL) return { ok: false, error: 'no_backend' };
    try {
      const res = await withTimeout(fetch(BACKEND_URL + path, {
        ...opts,
        headers: {
          'content-type': 'application/json',
          ...(opts.headers || {}),
          ...(getToken() ? { authorization: 'Bearer ' + getToken() } : {})
        }
      }), 15000, 'sync');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: body.error || ('http_' + res.status), status: res.status };
      return { ok: true, ...body };
    } catch (e) {
      return { ok: false, error: String(e).startsWith('Error: timeout') ? 'timeout' : 'network' };
    }
  }

  async function login(username, password) {
    const res = await apiFetch('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    if (!res.ok) return res;
    localStorage.setItem(TOKEN_KEY, res.token);
    localStorage.setItem(USERNAME_KEY, res.username);
    return { ok: true, username: res.username };
  }

  async function logout() {
    if (isLoggedIn()) await apiFetch('/api/logout', { method: 'POST' }).catch(() => {});
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USERNAME_KEY);
    localStorage.removeItem(PUSHED_AT_KEY);
  }

  // Pulls the cloud profile and adopts it as the active profile, UNLESS
  // this device already pushed a copy at least as new (so re-opening the
  // device you just edited offline on doesn't get clobbered by a stale
  // cloud read racing in behind it).
  async function pull() {
    const res = await apiFetch('/api/profile');
    if (!res.ok || !res.data) return { ok: false, applied: false };
    let cloud;
    try { cloud = JSON.parse(res.data); } catch (e) { return { ok: false, applied: false }; }
    const localPushedAt = Number(localStorage.getItem(PUSHED_AT_KEY) || 0);
    if (localPushedAt >= (res.updated_at || 0)) return { ok: true, applied: false };
    Store.upsertProfile(Store.ensureShape(cloud));
    Store.setActiveId(cloud.id);
    localStorage.setItem(PUSHED_AT_KEY, String(res.updated_at || Date.now()));
    return { ok: true, applied: true, profile: cloud };
  }

  async function push(profile) {
    if (!isLoggedIn() || !profile) return { ok: false };
    const res = await apiFetch('/api/profile', { method: 'PUT', body: JSON.stringify({ data: JSON.stringify(profile) }) });
    if (res.ok) localStorage.setItem(PUSHED_AT_KEY, String(res.updated_at || Date.now()));
    return res;
  }

  // Debounced so rapid edits (typing a set's reps, adjusting sliders, ...)
  // push once after things settle, not on every keystroke.
  function pushDebounced(profile) {
    if (!isLoggedIn()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => push(profile), 1500);
  }

  // Called right after a successful login: restore this account's cloud
  // data if there's newer data than what's local, or — first sign-in from
  // a device that already has fresh local onboarding — seed the cloud with
  // it instead of overwriting nothing with nothing.
  async function syncAfterLogin(localActiveProfile) {
    const res = await pull();
    if (!res.applied && localActiveProfile) await push(localActiveProfile);
    return res;
  }

  return { backendUrl, isLoggedIn, getUsername, getToken, login, logout, pull, push, pushDebounced, syncAfterLogin };
})();
