/* ===================== Bedrock — Fitbit, via the Google Health API ===================== */
/*
  Fitbit's old Web API (the "Client" app type, browser-only OAuth+PKCE, no
  backend needed) was retired in favor of the Google Health API — see
  developers.google.com/health. That migration changed more than the URL:
  Google's OAuth client for this API is a confidential "Web Server" type,
  which requires a client secret. A client secret can't safely live in a
  static site's JS, so — unlike the old Fitbit integration — this one is
  backend-mediated: cloudflare-worker/ holds the Google tokens server-side
  (google_health_tokens table) and this module just calls the worker's
  authenticated /api/google-health/* endpoints. The browser never sees a
  Google access/refresh token at all, which is actually a real security
  upgrade over the old browser-PKCE model, even though it means Fitbit sync
  now requires being signed in to a Bedrock account (see js/sync.js) — there's
  no backend-free path for this one feature anymore.

  One-time setup (once per household, not per person) — see
  cloudflare-worker/README.md's "Google Health" section and
  cloudflare-worker/setup-google-health.sh.

  This API is very new (written during Google's Fitbit migration window,
  closing Sept 2026) and not fully documented publicly yet — the worker side
  (src/index.js's extractMetricValue) has notes on where to look first if a
  number here ever looks wrong.
*/

const Fitbit = (() => {
  // Not a secret — just a local UI hint ("show Connected vs Connect") set
  // right after the backend confirms a successful connection. The real
  // credential (Google's tokens) lives only in the worker's database.
  const CONNECTED_KEY = 'bedrock_googlehealth_connected';

  function isConnected() { return localStorage.getItem(CONNECTED_KEY) === '1'; }
  function setConnectedFlag(v) { if (v) localStorage.setItem(CONNECTED_KEY, '1'); else localStorage.removeItem(CONNECTED_KEY); }

  async function authedFetch(path, opts = {}) {
    if (!Sync.isLoggedIn()) return { ok: false, error: 'not_signed_in' };
    try {
      const res = await withTimeout(fetch(Sync.backendUrl() + path, {
        ...opts,
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + Sync.getToken(), ...(opts.headers || {}) }
      }), 15000, 'google-health');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: body.error || ('http_' + res.status) };
      return { ok: true, ...body };
    } catch (e) {
      return { ok: false, error: String(e).startsWith('Error: timeout') ? 'timeout' : 'network' };
    }
  }

  // Kicks off the OAuth flow: the worker builds Google's consent URL (it's
  // the one holding the client ID/secret) and this just redirects there.
  async function connect() {
    if (!Sync.isLoggedIn()) { alert('Sign in under Settings → Sync first — connecting Fitbit is tied to your Bedrock account now.'); return; }
    const res = await authedFetch('/api/google-health/connect');
    if (!res.ok || !res.url) {
      alert(res.error === 'not_signed_in' ? 'Sign in under Settings → Sync first.' : 'Couldn’t start Fitbit connect — the backend may not have Google Health set up yet.');
      return;
    }
    location.href = res.url;
  }

  // Call once on app load. The worker's OAuth callback does the actual token
  // exchange server-side and redirects the browser back here with a plain
  // query flag — there's no code/token to handle on this side at all anymore.
  function handleRedirectIfPresent() {
    const params = new URLSearchParams(location.search);
    const connected = params.get('googleHealthConnected');
    const error = params.get('googleHealthError');
    if (!connected && !error) return false;
    history.replaceState({}, '', location.pathname);
    if (connected) { setConnectedFlag(true); return true; }
    setConnectedFlag(false);
    return false;
  }

  async function disconnect() {
    setConnectedFlag(false); // clear the local hint immediately either way
    await authedFetch('/api/google-health/disconnect', { method: 'POST' }).catch(() => {});
  }

  async function fetchRecentActivities(afterDate) {
    const res = await authedFetch(`/api/google-health/activities?since=${afterDate}`);
    if (!res.ok) return res;
    return { ok: true, activities: res.activities || [] };
  }

  // Pulls new activity sessions since the last sync and folds them into this
  // profile's workout history — de-duplicated by logId, so calling this
  // repeatedly (e.g. every time the app opens) is safe and cheap. `source`
  // stays 'fitbit' on purpose: that's the wearable brand people actually
  // have on their wrist; the Google Health API is just this app's pipe to
  // that data now, an implementation detail the rest of the app (captions,
  // Insights.recentWearableSummary) doesn't need to know changed.
  async function syncToProfile(profile) {
    profile.fitbitSyncedIds = profile.fitbitSyncedIds || [];
    const since = profile.fitbitLastSync || new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const res = await fetchRecentActivities(since);
    if (!res.ok) return res;

    let added = 0;
    res.activities.forEach(a => {
      if (profile.fitbitSyncedIds.includes(a.logId)) return;
      profile.fitbitSyncedIds.push(a.logId);
      const durationMin = a.duration ? Math.round(a.duration / 60000) : null;
      profile.history.workouts.push({
        dayIndex: -1, label: `Fitbit: ${a.activityName || 'Activity'}`,
        date: new Date(a.startTime).getTime(),
        source: 'fitbit',
        durationMin, calories: a.calories || null,
        distanceKm: a.distance || null, steps: a.steps || null,
        avgHeartRate: a.averageHeartRate || null,
        exercises: [{ id: 'fitbit', name: a.activityName || 'Fitbit activity', targetRepsMin: 0, sets: a.calories ? [{ reps: 1, weight: a.calories }] : [] }]
      });
      added++;
    });
    profile.fitbitLastSync = new Date().toISOString().slice(0, 10);
    Store.upsertProfile(profile);
    return { ok: true, added };
  }

  // Called on every app open. Only actually hits the backend if it's been a
  // while since the last sync (default 30 min) and we're connected — this is
  // what makes it "connect once, forget about it": no button to remember.
  async function autoSyncIfDue(profile, minMinutesBetween = 30) {
    if (!isConnected() || !Sync.isLoggedIn()) return { ok: false, skipped: true };
    const last = profile.fitbitLastAutoSyncAt || 0;
    if (Date.now() - last < minMinutesBetween * 60000) return { ok: false, skipped: true };
    const res = await syncToProfile(profile);
    profile.fitbitLastAutoSyncAt = Date.now();
    Store.upsertProfile(profile);
    return res;
  }

  // Today's daily summary — steps, resting heart rate, calories, distance —
  // refreshed whenever Home renders. This is the closest thing to "live"
  // available without Google's separate continuous/intraday data approval,
  // which is out of scope here. Resting heart rate and today's totals update
  // as your Fitbit syncs through the day, which is honestly close enough
  // for "how am I doing today" at a glance.
  async function fetchTodaySummary() {
    if (!isConnected()) return { ok: false, error: 'not_connected' };
    const res = await authedFetch('/api/google-health/today');
    if (!res.ok) { if (res.error === 'not_connected') setConnectedFlag(false); return res; }
    return res;
  }

  // Recent Fitbit-sourced metrics (steps, resting effort, distance) for
  // grounding AI insights/chat in real wearable data, not just workouts.
  // Pure local computation — reads what's already synced into history.
  function recentWearableSummary(profile, days = 7) {
    const cutoff = Date.now() - days * 24 * 3600 * 1000;
    const entries = (profile.history.workouts || []).filter(w => w.source === 'fitbit' && w.date >= cutoff);
    if (!entries.length) return null;
    const totalSteps = entries.reduce((a, e) => a + (e.steps || 0), 0);
    const hrReadings = entries.filter(e => e.avgHeartRate).map(e => e.avgHeartRate);
    const avgHr = hrReadings.length ? Math.round(hrReadings.reduce((a, b) => a + b, 0) / hrReadings.length) : null;
    const totalDistanceKm = Math.round(entries.reduce((a, e) => a + (e.distanceKm || 0), 0) * 10) / 10;
    return { count: entries.length, totalSteps, avgHr, totalDistanceKm, days };
  }

  return {
    isConnected, disconnect, connect, handleRedirectIfPresent,
    syncToProfile, autoSyncIfDue, recentWearableSummary, fetchTodaySummary
  };
})();
