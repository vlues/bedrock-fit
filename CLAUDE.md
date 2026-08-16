# CLAUDE.md

Context for Claude Code (or any agent) working on this repo.

## What this is

Bedrock — a static, no-build fitness/nutrition PWA for two people sharing one app. Plain
HTML/CSS/JS, deployed as-is to GitHub Pages. No npm install, no bundler, no framework. Keep
it that way unless explicitly asked to add a build step. A small optional Cloudflare Worker
(`cloudflare-worker/`) provides accounts, cross-device profile sync, and the Anthropic proxy
— see its own README for that half. The static site works fully without it (local-only, no
AI) and fully with it (synced, AI unlocked by signing in) — never make a feature require the
backend without a non-backend fallback.

## Structure

```
index.html            all views live here as hidden/shown <section> blocks
manifest.json          PWA metadata
deploy.sh               zero-field GitHub Pages deploy script (uses gh CLI)
css/style.css           theme: oklch clay/olive palette, light + dark via [data-theme], glass cards,
                         Instrument Sans/Serif + Material Symbols Rounded (Google Fonts)
js/store.js             localStorage: profiles, units — no key/credential storage here, see sync.js
js/sync.js               account login/logout + cloud profile push/pull, talks to cloudflare-worker/
js/api.js                 Anthropic Messages API wrapper — routes through the backend's
                          /api/anthropic ONLY (Bearer session token); no direct-to-Anthropic path,
                          no personal API key anywhere in this app
js/workout.js            exercise DB + program generator + double-progression/auto-deload logic
js/supplements.js        static evidence-tagged supplement data
js/chart.js               dependency-free canvas line/bar chart
js/scan.js                progress photo capture/compression, check-ins
js/trajectory.js          volume tracking + projection math
js/insights.js            data summary builder + cached daily insight + volume-landmark check
js/nutrition.js           TDEE/macro calc, water, meal log, food-photo estimate
js/fitbit.js               Fitbit, via Google Health — backend-mediated (no client-side OAuth
                            tokens anymore); calls the worker's /api/google-health/* endpoints
js/camera.js                in-page camera (getUserMedia) + overlay guides
js/app.js                 UI controller / router / all event wiring
cloudflare-worker/          optional backend: D1 (users/sessions/profile_data), Anthropic proxy,
                            deploy-backend.sh (one field: your Anthropic key) + create-account.sh
test/logic-audit.js        Node smoke test — run after touching data/logic modules (includes sync.js)
```

`js/store.js` also defines two bare (non-namespaced) globals — `sleep(ms)` and
`withTimeout(promise, ms, label)` — used by `api.js` and `fitbit.js` for the
timeout+retry pattern. Reuse these for any new external call rather than adding another
timeout implementation.

Each `js/*.js` file (except `app.js`) is a self-contained IIFE module exposing a small
object (e.g. `Store`, `Workout`, `Insights`). `app.js` is the only file that touches the
DOM directly — it's the controller layer. Keep that separation: data/logic modules stay
DOM-free and testable in isolation; `app.js` wires them to elements.

## Data model

Local (`localStorage`, per browser/device — always the source of truth for that device):
- `bedrock_profiles`: array of profile objects — see `Store.createBlankProfile()` for the
  full shape (units, goal, experience, `history.{workouts,checkins,chats,water,meals}`,
  `customExercises`).
- `bedrock_activeProfileId`: which profile is currently shown.
- `bedrock_sync_token` / `bedrock_sync_username` / `bedrock_sync_pushed_at` (`js/sync.js`):
  session bearer token + bookkeeping for the optional backend. No API key is ever stored
  anywhere client-side.

Two people = two profiles, either on the same phone (switch via the avatar button) or on
their own devices. Without signing in, that's the whole story — no server, no sync. Signing
in maps **one account to one profile**: `cloudflare-worker`'s `profile_data` table stores
that whole profile object as one opaque JSON blob per account, so a second device that signs
into the same account pulls it down and takes over as that profile. Conflict rule is
last-write-wins by `updated_at` — see `cloudflare-worker/README.md`'s "Sync model".

## Conventions

- No external runtime dependencies. If you need a chart, extend `chart.js`; don't pull in
  a charting library — this app is meant to stay a handful of KB and load instantly.
- Every AI-backed feature must have a non-AI fallback path (see `Insights.ruleBasedInsight`
  as the pattern) — the app must stay fully usable signed out / with no backend deployed.
  Gate AI calls on `Sync.isLoggedIn()`, never on the presence of a key (there isn't one).
- All Claude system prompts share `BEDROCK_PERSONA` in `js/api.js`. Extend that string
  rather than writing a new persona per feature.
- Units: canonical storage is always lb / inches. Convert for display only, via
  `Store.lbToKg` / `Store.kgToLb` / `Store.inToCm` / `Store.cmToIn`.
- New profile fields: add them to `Store.createBlankProfile()` AND `Store.ensureShape()` so
  existing saved profiles don't break when the schema grows.
- Don't fabricate data. Anything shown as a number/chart should trace back to something the
  user actually logged, or be clearly labeled as a research-based estimate/range (see how
  `trajectory.js` frames its projections).

## Non-AI innovations (what makes this more than a chat wrapper)

Pure math/data-science features, no API calls: `Trajectory.acwr` (acute:chronic training-load
ratio), plateau detection (`Insights.stalledExercises`) driving auto-swap in
`Workout.buildWeekPlan`, exercise shuffle/exclude (`profile.excludedExercises`, reversible in
Settings), household comparison card, auto-starting rest timer (`Workout.restSecondsFor`,
goal-based), PR detection (`Insights.checkNewPRs` — diffs against prior history, not just
"a number was typed") and week-streak tracking (`Insights.workoutStreak`). Keep new
non-AI features in this same style: derived from the user's own logged data, always with a
one-line comment explaining the research/logic basis.

## Deploying

Push to a GitHub repo, enable Pages on the `main` branch root — no build step. Full steps
are in `README.md`.

## Known limitations (by design, not bugs)

- AI features require the optional `cloudflare-worker/` backend AND signing in — there's no
  direct-to-Anthropic fallback anymore (that path was removed on purpose; see git history /
  README "Accounts, sync & Claude" for why). If asked to "add an API key field back," push
  back and point at the backend instead unless the user explicitly wants the old behavior.
- Fitbit's "Today" card (`Fitbit.fetchTodaySummary`) is latest-synced daily totals, not a
  continuous live stream — real intraday/continuous heart rate needs a separate Google
  application review this app doesn't request. Don't upgrade the UI copy to imply "live" in
  the real-time sense without actually adding that approval + endpoint.
- No live Apple Watch / Garmin sync — HealthKit has no web API, and Garmin's API needs
  server-side OAuth. Current path is manual/CSV/XML import (`importData` in `app.js`).
  Don't claim automatic wearable sync without adding an actual backend + native companion
  app first.
- Fitbit sync (`js/fitbit.js` + the worker's `/api/google-health/*` endpoints) already
  targets the Google Health API — Fitbit's old Web API is gone, this isn't a future
  migration. It's genuinely new (Google's migration window closes ~Sept 2026) and not fully
  documented publicly at time of writing: `src/index.js`'s `extractMetricValue` and the
  handful of "best-effort, not individually confirmed" `dataType` ids in
  `handleGoogleHealthToday`/`handleGoogleHealthActivities` are the known-soft spots. If a
  stat is wrong or a sync silently returns nothing for a genuinely connected account, check
  the Worker's Cloudflare dashboard logs for the raw upstream response before assuming the
  request-building code is wrong — it's more likely one `dataType` id or response field name
  needs correcting against developers.google.com/health's current reference. Also requires
  the backend (Google's OAuth client is confidential — needs a client secret — so this can
  never go back to being a pure-client-side integration like the old Fitbit one was).
- No food database / barcode scanning — meal calories are either typed in or a rough
  Claude vision estimate the user confirms. Don't overstate accuracy here.
