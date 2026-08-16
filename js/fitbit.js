/* ===================== Bedrock — Fitbit (Charge 6, etc.) integration ===================== */
/*
  Unlike Apple Watch (no web API for HealthKit), Fitbit's Web API supports a
  browser-only OAuth 2.0 Authorization Code + PKCE flow for public "Client"
  apps — no backend needed, which is why this one can be real instead of an
  import-only workaround. Source: dev.fitbit.com/build/reference/web-api/authorization.

  IMPORTANT — as of this writing (Aug 2026), Fitbit has announced it is
  retiring this legacy Web API in September 2026 in favor of the Google
  Health API. This integration targets the CURRENT API; if it stops working
  after that migration, that's why — the fix is pointing these calls at
  Google Health's replacement endpoints once Fitbit publishes the mapping.

  Setup (one-time, per household — see Settings → Connect Fitbit):
   1. Create a free app at https://dev.fitbit.com/apps/new
   2. OAuth 2.0 Application Type: "Client"
   3. Redirect URL: your deployed Bedrock URL (must match exactly)
   4. Paste the Client ID into Settings here.
*/

const Fitbit = (() => {
  const AUTH_URL = 'https://www.fitbit.com/oauth2/authorize';
  const TOKEN_URL = 'https://api.fitbit.com/oauth2/token';
  const API_BASE = 'https://api.fitbit.com';
  const SCOPES = 'activity heartrate profile';

  const CLIENT_ID_KEY = 'bedrock_fitbit_client_id';
  const TOKEN_KEY = 'bedrock_fitbit_token'; // { access_token, refresh_token, expires_at, user_id }
  const VERIFIER_KEY = 'bedrock_fitbit_pkce_verifier';

  function getClientId() { return localStorage.getItem(CLIENT_ID_KEY) || ''; }
  function setClientId(id) { localStorage.setItem(CLIENT_ID_KEY, id || ''); }
  function getToken() { try { return JSON.parse(localStorage.getItem(TOKEN_KEY)); } catch (e) { return null; } }
  function setToken(t) { localStorage.setItem(TOKEN_KEY, JSON.stringify(t)); }
  function isConnected() { return !!getToken(); }

  // Revokes server-side too (not just forgetting the token locally) so the
  // household's Fitbit account correctly shows Bedrock as disconnected.
  // Best-effort — if Fitbit's API is unreachable, we still clear locally.
  async function disconnect() {
    const t = getToken();
    localStorage.removeItem(TOKEN_KEY);
    if (!t) return;
    try {
      await withTimeout(fetch(`${API_BASE}/oauth2/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: getClientId(), token: t.access_token })
      }), 8000, 'fitbit-revoke');
    } catch (e) { /* already cleared locally — fine either way */ }
  }

  function base64url(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function randomVerifier() {
    const bytes = new Uint8Array(64);
    crypto.getRandomValues(bytes);
    return base64url(bytes.buffer).slice(0, 128);
  }
  async function challengeFor(verifier) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return base64url(digest);
  }

  function redirectUri() {
    return location.href.split('?')[0].split('#')[0];
  }

  async function connect() {
    const clientId = getClientId();
    if (!clientId) { alert('Add your Fitbit Client ID in Settings first (from dev.fitbit.com/apps).'); return; }
    const verifier = randomVerifier();
    sessionStorage.setItem(VERIFIER_KEY, verifier);
    const challenge = await challengeFor(verifier);
    const url = new URL(AUTH_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri());
    url.searchParams.set('scope', SCOPES);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    location.href = url.toString();
  }

  // Call once on app load — completes the flow if we just came back from Fitbit.
  async function handleRedirectIfPresent() {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    if (!code) return false;
    const verifier = sessionStorage.getItem(VERIFIER_KEY);
    const clientId = getClientId();
    history.replaceState({}, '', location.pathname); // strip ?code= from the URL
    if (!verifier || !clientId) return false;

    try {
      const res = await withTimeout(fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId, grant_type: 'authorization_code',
          code, redirect_uri: redirectUri(), code_verifier: verifier
        })
      }), 15000, 'fitbit-token');
      if (!res.ok) return false;
      const data = await res.json();
      setToken({ ...data, expires_at: Date.now() + (data.expires_in || 28800) * 1000 });
      return true;
    } catch (e) { return false; }
  }

  // Refresh tokens are single-use and rotate on every call (Fitbit issues a
  // new one each time) — always persist the full response, never just the
  // access token, or the next refresh will fail with an already-used token.
  async function refreshToken(t, _retriesLeft = 1) {
    try {
      const res = await withTimeout(fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: getClientId(), grant_type: 'refresh_token', refresh_token: t.refresh_token })
      }), 15000, 'fitbit-refresh');
      if (!res.ok) {
        if (res.status === 401 || res.status === 400) { disconnect(); return null; } // token no longer valid server-side
        if (_retriesLeft > 0) { await sleep(700); return refreshToken(t, _retriesLeft - 1); }
        return null; // transient failure (e.g. Fitbit's API is down) — keep the stored token, try again next time
      }
      const data = await res.json();
      const fresh = { ...data, expires_at: Date.now() + (data.expires_in || 28800) * 1000 };
      setToken(fresh);
      return fresh;
    } catch (e) {
      if (_retriesLeft > 0) { await sleep(700); return refreshToken(t, _retriesLeft - 1); }
      return null;
    }
  }

  async function ensureFreshToken() {
    let t = getToken();
    if (!t) return null;
    if (Date.now() < t.expires_at - 60000) return t;
    return refreshToken(t);
  }

  async function fetchRecentActivities(afterDate, _isRetry) {
    const t = await ensureFreshToken();
    if (!t) return { ok: false, error: 'not_connected' };
    const url = `${API_BASE}/1/user/-/activities/list.json?afterDate=${afterDate}&sort=asc&limit=50&offset=0`;
    try {
      const res = await withTimeout(fetch(url, { headers: { authorization: `Bearer ${t.access_token}` } }), 15000, 'fitbit-activities');
      if (res.status === 401 && !_isRetry) {
        // access token unexpectedly stale (clock drift etc.) — force one refresh + retry before giving up
        const fresh = await refreshToken(t);
        if (fresh) return fetchRecentActivities(afterDate, true);
      }
      if (!res.ok) return { ok: false, error: 'http_' + res.status };
      const data = await res.json();
      return { ok: true, activities: data.activities || [] };
    } catch (e) {
      return { ok: false, error: 'network' };
    }
  }

  // Pulls new Fitbit exercise logs since the last sync and folds them into
  // this profile's workout history — de-duplicated by Fitbit logId, so
  // calling this repeatedly (e.g. every time the app opens) is safe and
  // cheap. Keeps every real metric Fitbit gives us (duration, steps,
  // distance, heart rate) instead of collapsing it down to one number, so
  // Insights/chat can actually reason about your cardio and recovery data,
  // not just a proxy figure.
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

  // Called on every app open. Only actually hits the Fitbit API if it's
  // been a while since the last sync (default 30 min) and a token exists —
  // this is what makes it "connect once, forget about it": no button to
  // remember, and it won't burn your rate limit re-syncing on every tap.
  async function autoSyncIfDue(profile, minMinutesBetween = 30) {
    if (!isConnected()) return { ok: false, skipped: true };
    const last = profile.fitbitLastAutoSyncAt || 0;
    if (Date.now() - last < minMinutesBetween * 60000) return { ok: false, skipped: true };
    const res = await syncToProfile(profile);
    profile.fitbitLastAutoSyncAt = Date.now();
    Store.upsertProfile(profile);
    return res;
  }

  // Today's daily summary straight from Fitbit — steps, resting heart rate,
  // calories, distance — refreshed whenever Home renders. This is the
  // closest thing to "live" the standard Web API offers without special
  // approval: true continuous/intraday heart rate needs Fitbit's separate
  // intraday-access application review, which is out of scope for a
  // personal Client app. Resting heart rate and today's totals update
  // multiple times a day as your Fitbit syncs to Fitbit's servers, which is
  // honestly close enough for "how am I doing today" at a glance.
  async function fetchTodaySummary(_isRetry) {
    const t = await ensureFreshToken();
    if (!t) return { ok: false, error: 'not_connected' };
    const today = new Date().toISOString().slice(0, 10);
    try {
      const res = await withTimeout(fetch(`${API_BASE}/1/user/-/activities/date/${today}.json`, {
        headers: { authorization: `Bearer ${t.access_token}` }
      }), 15000, 'fitbit-today');
      if (res.status === 401 && !_isRetry) {
        const fresh = await refreshToken(t);
        if (fresh) return fetchTodaySummary(true);
      }
      if (!res.ok) return { ok: false, error: 'http_' + res.status };
      const data = await res.json();
      const s = data.summary || {};
      const total = (s.distances || []).find(d => d.activity === 'total');
      return {
        ok: true,
        steps: s.steps ?? null,
        restingHeartRate: s.restingHeartRate ?? null,
        caloriesOut: s.caloriesOut ?? null,
        distanceKm: total ? total.distance : null,
        activeMinutes: (s.fairlyActiveMinutes || 0) + (s.veryActiveMinutes || 0)
      };
    } catch (e) {
      return { ok: false, error: 'network' };
    }
  }

  // Recent Fitbit-sourced metrics (steps, resting effort, distance) for
  // grounding AI insights/chat in real wearable data, not just workouts.
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
    getClientId, setClientId, isConnected, disconnect, connect, handleRedirectIfPresent,
    syncToProfile, autoSyncIfDue, recentWearableSummary, fetchTodaySummary
  };
})();
