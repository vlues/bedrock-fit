# Prompt for Claude Design — redesign Bedrock's UI

Copy everything below into Claude Design as one prompt.

---

I have a working fitness/nutrition web app called Bedrock — the logic and data layer are done and I'm keeping them. I need you to redesign the **visual UI only**: layout, typography, color, spacing, iconography, motion. Don't touch app behavior.

**Non-negotiable constraint:** the JavaScript binds to elements by their `id` attributes (e.g. `#btnStartWorkout`, `#todayExerciseList`, `#progressChart`). Whatever markup you produce must keep every existing `id` intact on an element of the same effective role (input, button, container, canvas, etc.) — you can restructure the HTML/CSS freely around them, add wrapper elements, rename classes, but don't rename or drop the `id`s or change an `<input>` to a `<div>` etc. I'll paste you the current `index.html` and `css/style.css` as reference for the full id list and current structure.

**What the app does:** a two-person (my girlfriend and I) home-screen web app for training, progress tracking, and nutrition. No native app, no build step — plain HTML/CSS/JS, deployed to GitHub Pages, opened as an "Add to Home Screen" PWA on our phones.

**Screens to redesign:**
1. Onboarding — multi-step form (name/age/sex → height & weight with unit toggles → goal → experience → days/equipment → optional API key step)
2. Dashboard/Home — today's insight card, training-load gauge, household comparison card (when 2 profiles), today's session preview, quick-access tiles (Progress/Fuel/Ask/Full week)
3. Active workout logger — per-exercise weight/reps set rows, add-set button, expandable "proper form" cue + demo link, equipment notes
4. Full week plan — read-only list of every day's exercises
5. Progress — standing photo capture (live camera view with an overlay framing guide), measurements form, weight trend chart with a projected/dashed continuation, muscle-balance bar chart, per-exercise progression chart, training-load/readiness gauge
6. Fuel — tabbed: Supplements (evidence-tagged cards, filter chips) / Nutrition (calorie+macro targets, water tracker, meal log with a "what did you eat" quick-add, frequent-meal chips, food photo scanner)
7. Ask Bedrock — chat thread with quick-prompt suggestion chips
8. Settings — API key entry, units toggle, Fitbit connect/sync status, custom-equipment manager, profile switcher, data import (drag-and-drop) / export
9. In-app Guide — static help content

**Design direction:**
- Sleek and simple to use one-handed on a phone — this is a gym-use app, big tap targets, minimal typing, thumb-reachable primary actions.
- Functional over decorative — every screen has real data and real actions on it; don't add chrome that doesn't serve a task.
- Explicitly **not** an "AI product" look — no glowing orbs, no purple/blue gradient sci-fi aesthetic, no chat-bubble-everywhere UI. This should feel like a well-made fitness/health app first; the AI features are a layer on top, not the whole identity. Where something is AI-generated, a small consistent marker is enough (we currently use a 🤖 emoji vs 📊 for computed-from-data vs ⌚ for wearable-sourced — happy for you to redesign this into a proper iconography system instead of emoji).
- Current palette is warm earth tones (terracotta/clay, olive, sand, cream) — open to evolving this, but keep it warm and grounded rather than clinical/cold or neon.
- Respect real device constraints: safe-area insets for notches/home indicators, works in both light content on a live camera view and normal light-background screens, bottom nav bar reachable one-handed.
- Charts are currently hand-rolled on `<canvas>` (no chart library) — feel free to redesign their visual style but keep them lightweight/dependency-free if possible.

**Deliverable:** updated `css/style.css` (and any structural changes to `index.html` needed), keeping all existing element `id`s functional. If you want to propose a fundamentally different layout system (e.g. a different nav pattern), explain the tradeoff first rather than assuming.

---

*(Paste your current index.html and css/style.css after this prompt so Claude Design has the real id list and structure to work from.)*
