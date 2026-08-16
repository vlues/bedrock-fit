# Bedrock — Training, Built Right

A private, two-profile fitness + nutrition app for you and your girlfriend. Onboarding, a
research-based workout generator, progress check-ins, volume/trend charts, a supplement and
nutrition guide, and an optional Claude-powered coach that gets sharper the more you log —
all running as a static site, no backend, no accounts.

## What's inside

- **Onboarding** — name, age, sex, height/weight (lb/kg, ft-in/cm), goal, experience,
  days/week, equipment, injuries. Each person gets their own profile; switch from the
  top-left avatar.
- **Workout generator** — builds a weekly split from an exercise database tagged by muscle
  group and equipment, with rep/set/rest schemes suited to your goal, and suggests a
  starting weight each session from your last logged performance.
- **Your equipment** — add machines/exercises not in the built-in list (Settings) and they
  fold into your plan; log an optional note per exercise each session (e.g. "seat 4,
  incline 15°").
- **Progress check-ins** — standing photo + manual measurements, stored only on-device.
- **Charts, everywhere** — weight trend (with a dashed projection), muscle-group volume
  balance, per-exercise strength progression, and total training volume — each with a
  plain-language caption explaining what it means, not just a number.
- **Trajectory** — auto-totals volume from every logged workout and projects a realistic
  weight-trend range, anchored to commonly cited natural muscle-gain/fat-loss rates. Gets
  more accurate the more you log (see the "data maturity" note on the Progress tab). It
  never fakes a "future photo" — that can't be done accurately from one image.
- **Fuel: Supplements** — evidence-tagged (strong/moderate/limited) cards, filterable by
  goal, plus an optional Claude pass that picks 2-3 most relevant ones for your specific
  data. Educational only, not medical advice.
- **Fuel: Nutrition** — a Mifflin-St Jeor calorie/macro target, a water tracker, and a food
  log. Type meals in, or scan a photo for a rough Claude estimate you confirm/edit before
  saving. "What should I eat next?" uses your actual meal history as memory, not generic
  advice.
- **Today's insight + Ask Bedrock (chat)** — a cached once-a-day summary on Home, and a
  chat that automatically includes your real training/nutrition data as context, so answers
  are grounded in your numbers, not guesses. Every AI feature has evidence-based grounding
  via a shared "coach persona" (see `js/api.js`).
- **Training load (ACWR) + auto-adaptive plan** — two features that aren't just an AI
  wrapper: a real sports-science metric (acute:chronic workload ratio, the same one strength
  & conditioning staff use to flag injury-risk spikes) computed from your logged volume, and
  a plateau detector that automatically substitutes a fresh exercise when a lift goes 3
  sessions with zero weight increase — the plan itself adapts, not just the commentary.
- **Household card** — when two profiles share a device, Home shows a quick session-count
  comparison for the week.
- **Live in-page camera** — Progress and the food scanner open an actual camera viewfinder
  (not just the OS picker) with an overlay guide: a framing box + size-reference tip for
  food photos (a technique from dietary-photo-assessment research), a head-to-toe guide for
  body check-ins. Falls back to the plain file/camera picker if camera access isn't granted.
- **Exercise form cues** — every exercise has a short, coaching-cue-based form tip plus a
  link to a live video search (not a single hardcoded video, since I can't verify one stays
  accurate or online).
- **Built to keep working if Claude or Fitbit is down** — every external call has a timeout
  and one retry, and every AI feature has a working non-AI fallback (see `js/api.js`,
  `js/fitbit.js`).
- **Fitbit (Charge 6, etc.)** — real sync, not just import. Fitbit's Web API supports
  browser-only OAuth (no backend needed, unlike Apple Watch), so Settings → Connect Fitbit
  logs you in and "Sync now" pulls recent activities straight into your volume trend. See
  the setup steps and an important deprecation note below.
- **Wearable import** — Settings → drag-and-drop a Garmin Connect CSV export or an Apple
  Health `export.xml`; sessions fold straight into your volume trend.
- **In-app Guide** — Settings → "Open the guide" walks through every feature.

## Claude API key — how it works here

This is a static site (GitHub Pages has no server), so by default each person pastes their
own Anthropic API key into **Settings**; it's saved with `localStorage` on that phone only
and calls `api.anthropic.com` directly from the browser via Anthropic's
`anthropic-dangerous-direct-browser-access` header — documented for prototyping, not
production, because **anyone with that phone's browser dev tools could read the key out of
local storage**. Every Claude feature (insight, chat, photo feedback, meal suggestions,
supplement picks) has a working fallback without a key, so the app is fully usable either
way.

### Optional: hide your API key behind a real backend

If you want the key off the device entirely, add a tiny proxy — `worker-example/` has a
ready-to-deploy Cloudflare Worker.

**Easy way — one script, one field:**

```bash
cd worker-example
./deploy-worker.sh
```

It figures out your GitHub Pages URL, opens a Cloudflare login in your browser (you approve
it), and asks for exactly one thing — your Anthropic API key, typed at a hidden prompt. The
key is piped straight into Cloudflare's encrypted secret store (`wrangler secret put`) and
never written to any file, ever. It then patches `js/api.js` to point at your new worker and
redeploys the site for you. Re-run it any time to rotate the key or redeploy.

**Manual way**, if you'd rather not run the script:

1. Create a free Cloudflare account → Workers & Pages → **Create Worker**.
2. Paste in `worker-example/cloudflare-worker.js`.
3. Workers → your worker → Settings → Variables → add a secret `ANTHROPIC_API_KEY` (your
   real key) and a variable `ALLOWED_ORIGIN` set to your GitHub Pages URL.
4. Deploy — you'll get a URL like `https://bedrock-proxy.<you>.workers.dev`.
5. In `js/api.js`, set `PROXY_ENDPOINT` to that URL (leave `ENDPOINT` alone — it's unused
   once `PROXY_ENDPOINT` is set).
6. Redeploy the site. Nobody's key is ever in the browser now.

This is optional either way — skip it entirely for personal use with a spending-capped key.

### Demo / walkthrough

I can't generate an actual video file in this session, but here's a script you can record
yourself in under 2 minutes once it's deployed (screen recording on your phone works fine):
1. Open the site → show onboarding (10s).
2. Log a workout, show a suggested weight (15s).
3. Do a check-in: photo + measurements (15s).
4. Open Progress → charts + trajectory (15s).
5. Open Fuel → scan a food photo, ask "what should I eat next?" (20s).
6. Open Ask Bedrock, ask a data question (15s).

## Deploying to GitHub Pages

**Easy way — one script, zero fields:**

```bash
./deploy.sh
```

Requires the [GitHub CLI](https://cli.github.com) (`gh auth login` once if you haven't).
It creates the repo, pushes, and turns on Pages for you — it prints your live URL when
done. Re-run it any time you change a file to push an update.

**Manual way**, if you'd rather not run the script:

1. Create a new GitHub repo (e.g. `bedrock-fit`).
2. Copy everything in this folder into the repo root and push.
3. In the repo, go to **Settings → Pages**, set **Source** to the `main` branch, root folder.
4. Wait a minute, then open `https://<your-username>.github.io/bedrock-fit/` on your phone.

Either way, once it's live:
1. Tap **Share → Add to Home Screen** (iPhone) or **Add to Home screen** (Android) so it
   opens full-screen like an app.
2. Each of you opens it on your own phone (or switches profiles on one phone) and runs
   through onboarding once.

No build step, no npm install — it's plain HTML/CSS/JS. If you're handing this repo to
Claude Code to push the release, `CLAUDE.md` has the codebase map and conventions it needs.

## Connecting a Fitbit (Charge 6 and others)

This one's real-time-ish, not just file import, because Fitbit (unlike Apple/Garmin)
supports OAuth login straight from a browser with no backend:

1. Go to [dev.fitbit.com/apps/new](https://dev.fitbit.com/apps/new), log in with the same
   account your Charge 6 is paired to.
2. Fill in the form: **OAuth 2.0 Application Type: Client**, **Redirect URL:** your
   deployed Bedrock URL exactly (Settings shows you the exact string to paste, once the
   site is live on GitHub Pages).
3. Save, copy the **Client ID** it gives you.
4. In Bedrock → Settings → Fitbit card, paste the Client ID, tap **Connect Fitbit**, log in
   and approve on Fitbit's page — you'll land back in Bedrock, connected.
5. Tap **Sync now** whenever you want recent Fitbit activity logs pulled into your volume
   trend. (Not automatic on page load, to avoid burning API rate limits — a manual tap.)

**⚠️ Important:** Fitbit has announced it's retiring this legacy Web API in September 2026
in favor of the new Google Health API. This integration is built against the current API;
if syncing breaks after that migration, that's why, and `js/fitbit.js` will need its
endpoints updated to whatever Google Health publishes as the replacement.

## Connecting Apple Watch or Garmin

**Apple Watch specifically can't push data to a website automatically** — HealthKit (where
Apple Watch workouts live) has no web API; only native iOS/watchOS apps with the right
entitlements can read it. A "smooth, automatic" sync would require building and shipping a
native companion app, which is out of scope for a GitHub Pages site. Practical options today:

- **Garmin**: Garmin Connect → export activities as CSV → drag into Settings → Import.
- **Apple Watch / Health app**: Settings → your name → Health → **Export All Health Data**
  → produces `export.xml` → drag that straight into Settings → Import (Bedrock parses
  `<Workout>` records directly).
- **Closer to automatic**: an iOS Shortcuts automation that runs after a workout ends,
  pulls the summary from Health, and saves it to a Files/iCloud folder you periodically
  drag into Bedrock — still manual, but a few taps instead of a full export.
- **True live sync** would mean a native HealthKit companion app (Apple Watch) and/or a
  small backend doing Garmin's OAuth (Garmin Connect API) — worth revisiting once the core
  app is in daily use.

## File structure

```
bedrock-fit/
  index.html
  manifest.json
  CLAUDE.md
  css/style.css
  js/store.js         profiles, units, localStorage
  js/api.js            Claude API wrapper + shared coach persona
  js/workout.js         exercise DB + program generator
  js/supplements.js     supplement data
  js/chart.js            dependency-free line + bar charts
  js/scan.js              photo capture/compression, check-ins
  js/trajectory.js        volume tracking + projection math
  js/insights.js          data summary + cached daily insight
  js/nutrition.js         TDEE/macros, water, meals, food-photo estimate
  js/fitbit.js             Fitbit OAuth (PKCE) + activity sync
  js/camera.js              in-page camera viewfinder + overlay guides
  js/app.js               UI controller / router
  worker-example/cloudflare-worker.js   optional backend proxy
  test/logic-audit.js      Node smoke test for the data/logic layer
  claude-design-prompt.md  copy-paste prompt for a UI-only redesign pass
```

## Testing

`node test/logic-audit.js` runs a dependency-free smoke test against the data/logic modules
(profile shape, workout-plan generation across every days/equipment/experience/goal
combination, plateau detection, ACWR bands, nutrition targets across edge cases, meal
memory, supplement data integrity). It stubs `localStorage`/`fetch`/`crypto` so it runs in
plain Node — no browser needed. Re-run it after any change to `js/store.js`, `js/workout.js`,
`js/trajectory.js`, `js/insights.js`, or `js/nutrition.js`.

## Want a different look?

`claude-design-prompt.md` is a ready-to-paste prompt for handing the UI (not the logic) to
a design-focused tool — it lists every screen, the constraint that element `id`s must stay
intact so the existing JS keeps working, and the "not an AI-product look" direction.

## Notes & limits

- General fitness/nutrition education, not medical advice — see a doctor before starting a
  new training or supplement routine, especially with any health condition.
- The photo feature never estimates body fat % or generates a "future you" image; Claude's
  optional photo feedback is limited to posture/consistency notes. Food-photo calorie
  estimates are rough — always shown for you to edit before saving.
- All data lives in the browser's local storage on each device — no cross-device sync.
  Clearing browser data or switching phones without exporting loses history — use
  **Settings → Export my data** to back up.
