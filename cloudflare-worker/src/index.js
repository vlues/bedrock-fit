/**
 * Bedrock API — Cloudflare Worker
 *
 * Holds the Anthropic API key server-side (never shipped to the browser)
 * and gives each invited account a profile that syncs across devices.
 *
 * Endpoints:
 *   POST /api/admin/create-user   { username, password }   [X-Admin-Secret]
 *   POST /api/login                { username, password } -> { token, username }
 *   POST /api/logout                                          [auth]
 *   GET  /api/profile                                         [auth]  -> { data, updated_at }
 *   PUT  /api/profile              { data }                   [auth]  -> upsert, returns { ok, updated_at }
 *   POST /api/anthropic            <Messages API body>        [auth]  (proxied, key injected)
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
 */

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ALLOWED_MODELS = new Set(['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5']);
const MAX_TOKENS_CAP = 4096;
const MAX_PROFILE_BYTES = 4_500_000; // generous, but D1 rows aren't unbounded — see schema.sql

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

      return err('Not found', 404, cors);
    } catch (e) {
      return err(`Server error: ${e.message}`, 500, cors);
    }
  },
};
