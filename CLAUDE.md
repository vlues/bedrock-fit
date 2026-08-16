# CLAUDE.md

Context for Claude Code (or any agent) working on this repo.

## What this is

Bedrock — a static, no-build, no-backend fitness/nutrition PWA for two people sharing one
app. Plain HTML/CSS/JS, deployed as-is to GitHub Pages. No npm install, no bundler, no
framework. Keep it that way unless explicitly asked to add a build step.

## Structure

```
index.html            all views live here as hidden/shown <section> blocks
manifest.json          PWA metadata
css/style.css           single stylesheet, earth-tone theme, mobile-first
js/store.js             localStorage: profiles, units, API key
js/api.js                Anthropic Messages API wrapper (direct browser call)
js/workout.js            exercise DB + program generator + progressive overload
js/supplements.js        static evidence-tagged supplement data
js/chart.js               dependency-free canvas line/bar chart
js/scan.js                progress photo capture/compression, check-ins
js/trajectory.js          volume tracking + projection math
js/insights.js            data summary builder + cached daily insight
js/nutrition.js           TDEE/macro calc, water, meal log, food-photo estimate
js/fitbit.js               Fitbit OAuth (PKCE, browser-only) + activity sync
js/camera.js                in-page camera (getUserMedia) + overlay guides
js/app.js                 UI controller / router / all event wiring
test/logic-audit.js        Node smoke test — run after touching data/logic modules
```

`js/store.js` also defines two bare (non-namespaced) globals — `sleep(ms)` and
`withTimeout(promise, ms, label)` — used by `api.js` and `fitbit.js` for the
timeout+retry pattern. Reuse these for any new external call rather than adding another
timeout implementation.

Each `js/*.js` file (except `app.js`) is a self-contained IIFE module exposing a small
object (e.g. `Store`, `Workout`, `Insights`). `app.js` is the only file that touches the
DOM directly — it's the controller layer. Keep that separation: data/logic modules stay
DOM-free and testable in isolation; `app.js` wires them to elements.

## Data model (all in `localStorage`, per browser/device)

- `bedrock_profiles`: array of profile objects — see `Store.createBlankProfile()` for the
  full shape (units, goal, experience, `history.{workouts,checkins,chats,water,meals}`,
  `customExercises`).
- `bedrock_activeProfileId`: which profile is currently shown.
- `bedrock_api_key`: one Anthropic API key, shared across profiles on that device.

There is no server and no sync between devices. Two people = two profiles, either on the
same phone (switch via the avatar button) or on their own devices (their own localStorage).

## Conventions

- No external runtime dependencies. If you need a chart, extend `chart.js`; don't pull in
  a charting library — this app is meant to stay a handful of KB and load instantly.
- Every AI-backed feature must have a non-AI fallback path (see `Insights.ruleBasedInsight`
  as the pattern) — the app must stay fully usable with zero API key.
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

- API key lives in `localStorage`, sent via Anthropic's
  `anthropic-dangerous-direct-browser-access` header — fine for personal use on a device you
  control, not for a public product. See `README.md` → "Optional: hide your API key behind
  a real backend" if asked to harden this.
- No live Apple Watch / Garmin sync — HealthKit has no web API, and Garmin's API needs
  server-side OAuth. Current path is manual/CSV/XML import (`importData` in `app.js`).
  Don't claim automatic wearable sync without adding an actual backend + native companion
  app first.
- Fitbit sync (`js/fitbit.js`) targets the *current* legacy Fitbit Web API, which Fitbit
  has announced retiring ~September 2026 in favor of the Google Health API. If asked to fix
  broken Fitbit sync after that date, check https://developers.google.com/health for the
  migration mapping before assuming the code is wrong.
- No food database / barcode scanning — meal calories are either typed in or a rough
  Claude vision estimate the user confirms. Don't overstate accuracy here.
