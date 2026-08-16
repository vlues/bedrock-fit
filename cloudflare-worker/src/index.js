/**
 * Bedrock API — Cloudflare Worker
 *
 * Holds the Anthropic API key server-side (never shipped to the browser)
 * and gives each invited account a profile that syncs across devices.
 *
 * Endpoints:
 *   POST /api/admin/create-user     { username, password }   [X-Admin-Secret]
 *   POST /api/login                  { username, password } -> { token, username }
 *   POST /api/logout                                            [auth]
 *   GET  /api/profile                                           [auth]  -> { data, updated_at }
 *   PUT  /api/profile                { data }                   [auth]  -> upsert, returns { ok, updated_at }
 *   POST /api/anthropic              <Messages API body>        [auth]  (proxied, key injected)
 *   GET  /api/google-health/connect                             [auth]  -> { url } to redirect the browser to
 *   GET  /api/google-health/callback  ?code&state                       (Google redirects here directly — no bearer)
 *   GET  /api/google-health/status                              [auth]  -> { connected }
 *   GET  /api/google-health/today                               [auth]  -> today's steps/HR/calories/distance
 *   GET  /api/google-health/activities  ?since=YYYY-MM-DD        [auth]  -> recent exercise sessions
 *   POST /api/google-health/disconnect                          [auth]
 *
 * Auth: `Authorization: Bearer <token>` — token is a random 32-byte value;
 * only its SHA-256 hash is stored, so a DB read can't be replayed as a token.
 *
 * There is deliberately no public "sign up" route — accounts are created
 * only via the admin-secret-gated endpoint (see ../create-account.sh), so a
 * public repo/URL can't be used by a stranger to spend the Anthropic budget
 * or write into someone else's synced data.
 *
 * `data` is one opaque JSON blob per account — the entire Bedrock profile
 * exactly as Store.createBlankProfile() shapes it client-side (identity,
 * goals, history.*, customExercises, ...). The worker never parses it, just
 * stores/returns it, so new profile fields never need a migration here.
 *
 * Google Health API (Fitbit's Web API's replacement, see
 * developers.google.com/health): unlike Fitbit's old "Client" app type,
 * Google's OAuth client for this API is a confidential "Web Server" type —
 * it requires a client secret, so the token exchange can't safely happen in
 * the browser anymore. That's why this lives in the worker: Google tokens
 * are stored here (google_health_tokens table) and never shipped to the
 * client at all — actually a real security improvement over the old
 * browser-PKCE Fitbit flow. See cloudflare-worker/README.md's "Google
 * Health" section for setup (setup-google-health.sh) and — because this API
 * is extremely new (migration window closes Sept 2026, docs are thin at
 * time of writing — see extractMetricValue()'s comment) — where to look
 * first if a response shape turns out to be wrong.
 */

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ALLOWED_MODELS = new Set(['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5']);
const MAX_TOKENS_CAP = 4096;
const MAX_PROFILE_BYTES = 4_500_000; // generous, but D1 rows aren't unbounded — see schema.sql
const GOOGLE_HEALTH_API = 'https://health.googleapis.com/v4';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_HEALTH_SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
].join(' ');
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — connect attempts don't linger

function resolveCorsOrigin(request, env) {
  const requestOrigin = request.headers.get('origin') || '';
  const configured = (env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (configured.includes(requestOrigin)) return requestOrigin;
  return configured[0] || '*';
}

function corsHeaders(corsOrigin) {
  return {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Admin-Secret',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(data, status, corsOrigin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(corsOrigin) },
  });
}
function err(message, status, corsOrigin) {
  return json({ error: message }, status, corsOrigin);
}

// ---------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------
function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return bytesToHex(new Uint8Array(buf));
}
async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}
function timingSafeEqualHex(aHex, bHex) {
  if (aHex.length !== bHex.length) return false;
  return crypto.subtle.timingSafeEqual(hexToBytes(aHex), hexToBytes(bHex));
}
function randomTokenHex(byteLen) {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

// ---------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------
async function requireUser(request, env) {
  const authz = request.headers.get('authorization') || '';
  const m = authz.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const tokenHash = await sha256Hex(m[1]);
  const row = await env.DB.prepare(
    'SELECT sessions.user_id AS user_id, users.username AS username FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?'
  ).bind(tokenHash, Date.now()).first();
  return row || null;
}

async function requireAdmin(request, env) {
  const provided = request.headers.get('x-admin-secret') || '';
  if (!env.ADMIN_SECRET || !provided) return false;
  const a = await sha256Hex(provided);
  const b = await sha256Hex(env.ADMIN_SECRET);
  return timingSafeEqualHex(a, b);
}

// ---------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------
async function handleCreateUser(request, env, cors) {
  if (!(await requireAdmin(request, env))) return err('Forbidden', 403, cors);
  const body = await request.json().catch(() => ({}));
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!username || username.length < 2) return err('Username too short', 400, cors);
  if (!password || password.length < 8) return err('Password must be at least 8 characters', 400, cors);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (existing) return err('That username already exists', 409, cors);

  const salt = randomTokenHex(16);
  const hash = await hashPassword(password, salt);
  await env.DB.prepare('INSERT INTO users (username, salt, hash, created_at) VALUES (?, ?, ?, ?)')
    .bind(username, salt, hash, Date.now()).run();
  return json({ ok: true, username }, 201, cors);
}

async function handleLogin(request, env, cors) {
  const body = await request.json().catch(() => ({}));
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  const user = await env.DB.prepare('SELECT id, salt, hash FROM users WHERE username = ?').bind(username).first();
  if (!user) return err('Incorrect username or password', 401, cors);
  const attemptHash = await hashPassword(password, user.salt);
  if (!timingSafeEqualHex(attemptHash, user.hash)) return err('Incorrect username or password', 401, cors);

  const token = randomTokenHex(32);
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(tokenHash, user.id, now, now + SESSION_TTL_MS).run();
  return json({ token, username }, 200, cors);
}

async function handleLogout(request, env, cors) {
  const authz = request.headers.get('authorization') || '';
  const m = authz.match(/^Bearer\s+(.+)$/i);
  if (m) {
    const tokenHash = await sha256Hex(m[1]);
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
  }
  return json({ ok: true }, 200, cors);
}

async function handleGetProfile(env, user, cors) {
  const row = await env.DB.prepare('SELECT data, updated_at FROM profile_data WHERE user_id = ?').bind(user.user_id).first();
  return json({ data: row ? row.data : null, updated_at: row ? row.updated_at : 0 }, 200, cors);
}

async function handlePutProfile(request, env, user, cors) {
  const body = await request.json().catch(() => ({}));
  const data = typeof body.data === 'string' ? body.data : JSON.stringify(body.data ?? null);
  if (new TextEncoder().encode(data).length > MAX_PROFILE_BYTES) {
    return err('Profile too large to sync (check-in photos add up — trim history or export/reset old check-ins)', 413, cors);
  }
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO profile_data (user_id, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  ).bind(user.user_id, data, now).run();
  return json({ ok: true, updated_at: now }, 200, cors);
}

async function handleAnthropic(request, env, user, cors) {
  if (!env.ANTHROPIC_API_KEY) return err('Server is not configured with an API key yet', 503, cors);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return err('Invalid request body', 400, cors);

  const model = ALLOWED_MODELS.has(body.model) ? body.model : 'claude-sonnet-5';
  const maxTokens = Math.min(Number(body.max_tokens) || 1024, MAX_TOKENS_CAP);

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ ...body, model, max_tokens: maxTokens }),
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { 'content-type': 'application/json', ...corsHeaders(cors) },
  });
}

// ---------------------------------------------------------------------
// Google Health (Fitbit replacement)
// ---------------------------------------------------------------------
function googleHealthConfigured(env) {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_HEALTH_REDIRECT_URI);
}

async function handleGoogleHealthConnect(env, user, cors) {
  if (!googleHealthConfigured(env)) return err('Google Health isn\'t set up on this backend yet — run cloudflare-worker/setup-google-health.sh', 503, cors);
  const state = randomTokenHex(24);
  const now = Date.now();
  // Best-effort housekeeping: clear anything abandoned, then store this one.
  await env.DB.prepare('DELETE FROM oauth_states WHERE created_at < ?').bind(now - OAUTH_STATE_TTL_MS).run();
  await env.DB.prepare('INSERT INTO oauth_states (state, user_id, created_at) VALUES (?, ?, ?)').bind(state, user.user_id, now).run();

  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', env.GOOGLE_HEALTH_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_HEALTH_SCOPES);
  url.searchParams.set('access_type', 'offline'); // needed to get a refresh_token back
  url.searchParams.set('prompt', 'consent');       // forces a refresh_token even on a repeat connect
  url.searchParams.set('state', state);
  return json({ url: url.toString() }, 200, cors);
}

// Google redirects the bare browser here — no Authorization header exists
// at this point, so `state` (bound to a user_id in handleGoogleHealthConnect)
// is the only way to know which Bedrock account this belongs to. Ends with
// an HTTP redirect back to the site, not a JSON response.
async function handleGoogleHealthCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const siteUrl = (env.SITE_URL || '').replace(/\/$/, '');
  const fail = (reason) => Response.redirect(`${siteUrl}/?googleHealthError=${encodeURIComponent(reason)}`, 302);
  if (!siteUrl) return new Response('Server misconfigured: SITE_URL not set', { status: 500 });
  if (!code || !state) return fail('missing_code_or_state');
  if (!googleHealthConfigured(env)) return fail('not_configured');

  const stateRow = await env.DB.prepare('SELECT user_id FROM oauth_states WHERE state = ? AND created_at > ?')
    .bind(state, Date.now() - OAUTH_STATE_TTL_MS).first();
  await env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run(); // one-time use either way
  if (!stateRow) return fail('expired_or_invalid_state');

  let tokenRes;
  try {
    tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: env.GOOGLE_HEALTH_REDIRECT_URI, grant_type: 'authorization_code',
      }),
    });
  } catch (e) { return fail('network'); }
  if (!tokenRes.ok) return fail('token_exchange_failed');
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token || !tokenData.refresh_token) return fail('no_refresh_token'); // happens if the user had already granted consent and Google skipped re-issuing one — prompt=consent above should prevent this, but just in case

  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO google_health_tokens (user_id, access_token, refresh_token, expires_at, connected_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET access_token = excluded.access_token, refresh_token = excluded.refresh_token, expires_at = excluded.expires_at, connected_at = excluded.connected_at`
  ).bind(stateRow.user_id, tokenData.access_token, tokenData.refresh_token, now + (tokenData.expires_in || 3600) * 1000, now).run();

  return Response.redirect(`${siteUrl}/?googleHealthConnected=1`, 302);
}

// Returns a valid access token for this user, refreshing it first if it's
// stale. Returns null if never connected or the refresh itself fails (e.g.
// the user revoked access on Google's side) — callers treat that as
// "not connected" rather than a hard error, same fallback-friendly pattern
// as the rest of this app.
async function getValidGoogleToken(env, userId) {
  const row = await env.DB.prepare('SELECT access_token, refresh_token, expires_at FROM google_health_tokens WHERE user_id = ?').bind(userId).first();
  if (!row) return null;
  if (Date.now() < row.expires_at - 60000) return row.access_token;

  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: row.refresh_token, grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) {
      if (res.status === 400 || res.status === 401) await env.DB.prepare('DELETE FROM google_health_tokens WHERE user_id = ?').bind(userId).run();
      return null;
    }
    const data = await res.json();
    const expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
    // Google may or may not re-issue a refresh_token on refresh; keep the old one if not.
    await env.DB.prepare('UPDATE google_health_tokens SET access_token = ?, refresh_token = COALESCE(?, refresh_token), expires_at = ? WHERE user_id = ?')
      .bind(data.access_token, data.refresh_token || null, expiresAt, userId).run();
    return data.access_token;
  } catch (e) {
    return null;
  }
}

async function handleGoogleHealthStatus(env, user, cors) {
  const row = await env.DB.prepare('SELECT connected_at FROM google_health_tokens WHERE user_id = ?').bind(user.user_id).first();
  return json({ connected: !!row }, 200, cors);
}

async function handleGoogleHealthDisconnect(env, user, cors) {
  await env.DB.prepare('DELETE FROM google_health_tokens WHERE user_id = ?').bind(user.user_id).run();
  return json({ ok: true }, 200, cors);
}

// Verified end-to-end 2026-08-16 against a real connected account, by
// reading the discovery document directly (`curl .../$discovery/rest?version=v4`
// piped into python3's json module — NOT an LLM's paraphrase of it, which is
// what produced two rounds of broken guesses before this one: `dailyRollUp`
// is case-sensitive (capital U — `dailyRollup` 404s on Google's generic
// infra page, not even reaching this API), the request is a structured
// `range: {start,end: {date:{year,month,day}}}` body (not a query string),
// and a couple of dataType path ids (`daily-resting-heart-rate`,
// `daily-heart-rate-variability`) don't match their own response field
// names (`restingHeartRatePersonalRange`, `heartRateVariabilityPersonalRange`)
// the way the others do. If Google changes this API again, re-derive the
// same way — fetch the discovery doc and read the real JSON yourself —
// rather than trusting a blog post or a paraphrase of one.
function civilDateFor(date) {
  return { date: { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() } };
}

async function fetchDailyRollup(accessToken, dataType) {
  const url = `${GOOGLE_HEALTH_API}/users/me/dataTypes/${dataType}/dataPoints:dailyRollUp`;
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 3600 * 1000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ windowSizeDays: 1, range: { start: civilDateFor(today), end: civilDateFor(tomorrow) } }),
    });
    const bodyText = await res.text();
    if (!res.ok) { console.log(`[google-health] ${dataType} -> ${res.status} ${bodyText.slice(0, 300)}`); return null; }
    let parsed; try { parsed = JSON.parse(bodyText); } catch (e) { return null; }
    const points = parsed.rollupDataPoints || [];
    return points.length ? points[points.length - 1] : null;
  } catch (e) {
    console.log(`[google-health] ${dataType} -> fetch threw: ${e.message}`);
    return null;
  }
}

function toNum(v) { // int64 fields come back as JSON strings
  if (v == null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

async function handleGoogleHealthToday(env, user, cors) {
  const token = await getValidGoogleToken(env, user.user_id);
  if (!token) return err('not_connected', 409, cors);

  const [stepsPt, calPt, hrPt, distPt, activeMinPt, hrvPt] = await Promise.all([
    fetchDailyRollup(token, 'steps'),
    fetchDailyRollup(token, 'total-calories'),
    fetchDailyRollup(token, 'daily-resting-heart-rate'),
    fetchDailyRollup(token, 'distance'),
    fetchDailyRollup(token, 'active-minutes'),
    fetchDailyRollup(token, 'daily-heart-rate-variability'),
  ]);

  const steps = toNum(stepsPt?.steps?.countSum);
  const kcal = toNum(calPt?.totalCalories?.kcalSum);
  const distanceMm = toNum(distPt?.distance?.millimetersSum);
  const hrMin = toNum(hrPt?.restingHeartRatePersonalRange?.beatsPerMinuteMin);
  const hrMax = toNum(hrPt?.restingHeartRatePersonalRange?.beatsPerMinuteMax);
  const hrvMin = toNum(hrvPt?.heartRateVariabilityPersonalRange?.averageHeartRateVariabilityMillisecondsMin);
  const hrvMax = toNum(hrvPt?.heartRateVariabilityPersonalRange?.averageHeartRateVariabilityMillisecondsMax);
  const activeMinLevels = activeMinPt?.activeMinutes?.activeMinutesRollupByActivityLevel || [];
  const activeMinTotal = activeMinLevels.length
    ? activeMinLevels.reduce((sum, l) => sum + (toNum(l.activeMinutesSum) || 0), 0)
    : null;

  return json({
    ok: true,
    steps: steps != null ? Math.round(steps) : null,
    // The API gives a personal RANGE, not one point-in-time reading — the
    // midpoint is the closest honest single number for a one-line stat tile.
    restingHeartRate: (hrMin != null && hrMax != null) ? Math.round((hrMin + hrMax) / 2) : null,
    caloriesOut: kcal != null ? Math.round(kcal) : null,
    distanceKm: distanceMm != null ? Math.round((distanceMm / 1_000_000) * 10) / 10 : null,
    activeMinutes: activeMinTotal,
    sleepHours: null, // not a dailyRollup metric in this API at all
    hrv: (hrvMin != null && hrvMax != null) ? Math.round((hrvMin + hrvMax) / 2) : null,
    spo2Pct: null, // same — not a dailyRollup metric
  }, 200, cors);
}

async function handleGoogleHealthActivities(request, env, user, cors) {
  const token = await getValidGoogleToken(env, user.user_id);
  if (!token) return err('not_connected', 409, cors);
  const url = new URL(request.url);
  const since = url.searchParams.get('since') || new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  try {
    const filter = `exercise.interval.civil_start_time >= "${since}T00:00:00"`;
    const res = await fetch(`${GOOGLE_HEALTH_API}/users/me/dataTypes/exercise/dataPoints?filter=${encodeURIComponent(filter)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return err('http_' + res.status, 502, cors);
    const data = await res.json();
    const points = data.dataPoints || data.points || (Array.isArray(data) ? data : []);
    // Normalized to the exact shape js/fitbit.js's syncToProfile() already
    // expects (it used to come from Fitbit's activities/list.json) — best
    // effort against a very new response shape, see extractMetricValue's note.
    const activities = points.map((p, i) => {
      const interval = p.interval || {};
      const metrics = p.metricsSummary || p.metrics || {};
      return {
        logId: p.id || p.dataPointId || `${interval.startTime || interval.civilStartTime || i}`,
        activityName: p.exerciseType || p.name || 'Activity',
        startTime: interval.startTime || interval.civilStartTime || p.startTime,
        duration: interval.startTime && interval.endTime ? (new Date(interval.endTime) - new Date(interval.startTime)) : null,
        calories: extractMetricValue(metrics.calories ?? metrics.activeEnergyBurned),
        distance: extractMetricValue(metrics.distance),
        steps: extractMetricValue(metrics.steps),
        averageHeartRate: extractMetricValue(metrics.averageHeartRate ?? metrics.heartRate),
      };
    }).filter((a) => a.startTime);
    return json({ ok: true, activities }, 200, cors);
  } catch (e) {
    return err('network', 502, cors);
  }
}

// ---------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;
    const cors = resolveCorsOrigin(request, env);

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(cors) });
    }

    try {
      if (pathname === '/api/admin/create-user' && method === 'POST') {
        return await handleCreateUser(request, env, cors);
      }
      if (pathname === '/api/login' && method === 'POST') {
        return await handleLogin(request, env, cors);
      }
      // Google itself navigates the browser here — no Authorization header
      // exists on a plain redirect, so this must sit before the auth gate.
      // `state` (not the auth gate) is what proves which account this is.
      if (pathname === '/api/google-health/callback' && method === 'GET') {
        return await handleGoogleHealthCallback(request, env);
      }

      // Everything below requires a valid session.
      const user = await requireUser(request, env);
      if (!user) return err('Unauthorized', 401, cors);

      if (pathname === '/api/logout' && method === 'POST') {
        return await handleLogout(request, env, cors);
      }
      if (pathname === '/api/profile' && method === 'GET') {
        return await handleGetProfile(env, user, cors);
      }
      if (pathname === '/api/profile' && method === 'PUT') {
        return await handlePutProfile(request, env, user, cors);
      }
      if (pathname === '/api/anthropic' && method === 'POST') {
        return await handleAnthropic(request, env, user, cors);
      }
      if (pathname === '/api/google-health/connect' && method === 'GET') {
        return await handleGoogleHealthConnect(env, user, cors);
      }
      if (pathname === '/api/google-health/status' && method === 'GET') {
        return await handleGoogleHealthStatus(env, user, cors);
      }
      if (pathname === '/api/google-health/today' && method === 'GET') {
        return await handleGoogleHealthToday(env, user, cors);
      }
      if (pathname === '/api/google-health/activities' && method === 'GET') {
        return await handleGoogleHealthActivities(request, env, user, cors);
      }
      if (pathname === '/api/google-health/disconnect' && method === 'POST') {
        return await handleGoogleHealthDisconnect(env, user, cors);
      }

      return err('Not found', 404, cors);
    } catch (e) {
      return err(`Server error: ${e.message}`, 500, cors);
    }
  },
};
