-- Bedrock API — D1 schema
-- One row of profile_data per account: the account's ENTIRE Bedrock profile
-- (identity, goals, history.workouts/checkins/chats/water/meals, custom
-- exercises, etc.) as a single opaque JSON blob — the exact shape
-- Store.createBlankProfile() produces client-side. Storing it opaque means
-- new profile fields (per CLAUDE.md convention: add to createBlankProfile +
-- ensureShape) never require a schema migration here.
--
-- Check-in photos live inside that JSON as base64 data URLs, same tradeoff
-- documented in the visual-memory-api schema: no R2 on this account yet, so
-- keep photos compressed client-side (scan.js already does this) to stay
-- under D1's per-row size limit. The worker also hard-caps blob size — see
-- MAX_PROFILE_BYTES in src/index.js.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS profile_data (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Google Health API (Fitbit's Web API was retired in favor of this — see
-- developers.google.com/health). Tokens live ONLY here, server-side; the
-- browser never sees a Google access/refresh token, which is actually a
-- real security improvement over the old Fitbit PKCE-in-browser model.
CREATE TABLE IF NOT EXISTS google_health_tokens (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  connected_at INTEGER NOT NULL
);

-- Short-lived: binds the OAuth `state` param to a Bedrock user_id across the
-- redirect to Google and back, since Google's callback hits this worker
-- directly (a plain browser navigation) with no Authorization header to
-- identify the Bedrock session. Rows are deleted the moment they're
-- consumed by the callback; a background sweep in the callback handler also
-- clears anything older than 10 minutes so an abandoned connect attempt
-- doesn't linger.
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
