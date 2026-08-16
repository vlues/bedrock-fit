# Bedrock API — Cloudflare Worker

The backend behind `bedrock-fit/`. Holds the Anthropic API key server-side
(never shipped to any browser) and gives each invited account a profile
that syncs across devices — no per-device key entry anywhere, ever.

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

## Config

`wrangler.jsonc` → `vars.ALLOWED_ORIGIN` is a comma-separated CORS allowlist
(your GitHub Pages origin + `http://localhost:8124` for local testing).

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

## Sync model (how conflicts are handled)

Last-write-wins, keyed by `updated_at`. The client (`js/sync.js`) pulls on
login and on app load if already signed in, and pushes (debounced) after
every local save. Since each account maps to exactly one person's one
profile — never shared editing — there's no real multi-writer conflict to
resolve, just "which device wrote most recently," which is what this gives
you.
