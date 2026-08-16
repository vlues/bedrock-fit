# Bedrock API — Cloudflare Worker

The backend behind `bedrock-fit/`. Holds the Anthropic API key server-side
(never shipped to any browser), gives each invited account a profile that
syncs across devices, and — optionally — mediates Fitbit sync via the
Google Health API (see "Google Health" below; Google's OAuth client for
that needs a client secret, which is exactly the kind of thing this worker
exists to hold so the browser never has to).

## One-time setup

```bash
cd cloudflare-worker
./deploy-backend.sh
```

Creates the D1 database, applies `schema.sql`, generates and sets the admin
secret, auto-detects your GitHub Pages origin for CORS, deploys the worker,
and patches `js/sync.js` in the parent repo to point at it — then redeploys
the site. The only thing it asks you for is your Anthropic API key, typed
at a hidden prompt and piped straight into Cloudflare's encrypted secret
store (`wrangler secret put`) — it's never written to a file.

## Redeploying after a code change

```bash
cd cloudflare-worker
npx wrangler deploy
```

## Adding an account (you, your household, anyone you trust)

There's no public sign-up — accounts only get created through this script,
gated by `.admin-secret.local` (gitignored, never committed):

```bash
cd cloudflare-worker
./create-account.sh yourname
```

It prompts for a password with input hidden — nothing is echoed or logged.
Run it once per person. They sign in from the app's onboarding (last step)
or Settings → Sync any time, on any device — their profile pulls down
automatically.

## Google Health (Fitbit sync) — optional, separate step

```bash
cd cloudflare-worker
./setup-google-health.sh
```

Fitbit's old Web API was retired in favor of the Google Health API
(developers.google.com/health). Unlike the old integration, Google's OAuth
client for this API is a confidential type — it needs a client secret,
so the whole flow (authorize, token exchange, refresh, and every data read)
happens here in the worker; the browser never sees a Google token, only a
non-secret "connected: true/false" flag. There's real Google Cloud Console
setup involved (a project, enabling the API, an OAuth consent screen in
"Testing" mode with test users, an OAuth client) — the script prints exact
steps and links, then asks for just the two things it produces: your OAuth
Client ID and Client Secret (secret piped straight to `wrangler secret put`,
never written to a file).

`handleGoogleHealthToday`'s six stats (steps, distance, calories, active
minutes, resting heart rate, HRV) are verified against a real connected
account — every `dataType` id, HTTP method, request body shape, and response
field name was read directly out of Google's live discovery document
(`curl "https://health.googleapis.com/\$discovery/rest?version=v4" | python3 -m json.tool`),
not guessed or taken from a paraphrase. Two real, confirmed gaps: sleep and
SpO2 aren't exposed by the daily-rollup method at all (not a bug — see the
comment above `fetchDailyRollup`). If Google changes this API again and a
stat breaks, re-derive the same way — fetch the discovery doc yourself and
read the real JSON — rather than trusting a blog post or an LLM's summary of
one; that's exactly what produced two broken rounds during this
integration's own build (wrong endpoint casing, wrong request shape). This
worker's logs (Cloudflare dashboard → Workers → bedrock-api → Logs, or
`npx wrangler tail` for live streaming) show the raw upstream response on
any non-200.

## Config

`wrangler.jsonc` → `vars.ALLOWED_ORIGIN` is a comma-separated CORS allowlist
(your GitHub Pages origin + `http://localhost:8124` for local testing).
Google Health config (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_HEALTH_REDIRECT_URI`, `SITE_URL`) lives in Worker secrets, set by
`setup-google-health.sh` — nothing Google-related is in `wrangler.jsonc`.

## Data model

D1 tables: `users`, `sessions` (bearer tokens, only their SHA-256 hash is
stored), `profile_data` (one row per account — the entire Bedrock profile
as one opaque JSON blob, the exact shape `Store.createBlankProfile()`
produces client-side). The worker never parses that JSON, just stores and
returns it, so new profile fields (per the main `CLAUDE.md`'s convention of
adding them to `createBlankProfile`/`ensureShape`) never need a migration
here.

Check-in photos live inside that blob as base64 data URLs — same tradeoff
as `visual-memory-api`: no R2 on this account yet, so `scan.js` compresses
photos client-side to keep the blob manageable. The worker also hard-caps
it (`MAX_PROFILE_BYTES` in `src/index.js`, currently 4.5MB) and returns a
clear 413 if a profile ever grows past that — if you hit it, that's the
sign to move photos to R2 rather than a bug.

Two more tables back Google Health: `google_health_tokens` (one row per
account — access/refresh token + expiry, server-side only, never sent to
the browser) and `oauth_states` (short-lived, 10-minute TTL — binds the
OAuth `state` param to a Bedrock user_id across the redirect to Google and
back, since Google's callback is a bare browser navigation with no
Authorization header to identify the session any other way; rows are
deleted the moment they're used).

## Sync model (how conflicts are handled)

Last-write-wins, keyed by `updated_at`. The client (`js/sync.js`) pulls on
login and on app load if already signed in, and pushes (debounced) after
every local save. Since each account maps to exactly one person's one
profile — never shared editing — there's no real multi-writer conflict to
resolve, just "which device wrote most recently," which is what this gives
you.
