/* ===================== Bedrock — app shell / controller ===================== */

const $ = id => document.getElementById(id);
const qs = sel => document.querySelector(sel);
const qsa = sel => Array.from(document.querySelectorAll(sel));

let ACTIVE = null;           // active profile object (cache)
let ONBOARD_STEP = 0;
let ONBOARD_DRAFT = null;
let ACTIVE_WORKOUT = null;   // in-progress workout session state

const VIEWS = ['onboarding', 'dashboard', 'workout', 'progress', 'supplements', 'chat', 'settings', 'guide'];

function showView(name) {
  VIEWS.forEach(v => { const el = $('view-' + v); if (el) el.hidden = (v !== name); });
  // "Gym mode" (an in-progress workout) drops the chrome entirely, same as
  // onboarding — the logger screen's own close button is the way out.
  const chromeless = name === 'onboarding' || name === 'workout';
  $('topbar').hidden = (name === 'onboarding');
  $('bottomnav').hidden = chromeless;
  $('navFab').hidden = chromeless;
  const navMap = { dashboard: 'dashboard', progress: 'progress', supplements: 'supplements', chat: 'chat' };
  qsa('.navbtn').forEach(b => b.classList.toggle('active', b.dataset.nav === navMap[name]));
  const titles = { dashboard: 'Bedrock', progress: 'Progress', supplements: 'Fuel', chat: 'Ask Bedrock', settings: 'Settings', workout: 'Session', guide: 'Guide' };
  if ($('topbarTitle')) $('topbarTitle').textContent = titles[name] || 'Bedrock';
  window.scrollTo(0, 0);
}

/* ---------------------------------------------------------------- */
/* Units helpers bound to the active profile's display preference    */
/* ---------------------------------------------------------------- */
function displayWeight(lb) {
  if (lb == null || isNaN(lb)) return '—';
  if (ACTIVE && ACTIVE.unitWeight === 'kg') return Math.round(Store.lbToKg(lb) * 10) / 10 + ' kg';
  return Math.round(lb * 10) / 10 + ' lb';
}
function inputToLb(val) {
  const n = Number(val);
  if (isNaN(n)) return null;
  return (ACTIVE && ACTIVE.unitWeight === 'kg') ? Store.kgToLb(n) : n;
}

/* ---------------------------------------------------------------- */
/* Theme (light/dark) — defaults to the OS preference (see css/style.css's */
/* prefers-color-scheme block); an explicit tap overrides and persists.    */
/* ---------------------------------------------------------------- */
const THEME_KEY = 'bedrock_theme';
function applyStoredTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') document.documentElement.dataset.theme = stored;
  updateThemeIcon();
}
function toggleTheme() {
  const systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const current = document.documentElement.dataset.theme || (systemDark ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_KEY, next);
  updateThemeIcon();
}
function updateThemeIcon() {
  const systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : systemDark;
  const icon = $('themeIcon');
  if (icon) icon.textContent = isDark ? 'light_mode' : 'dark_mode';
}

// Single choke point for "save the active profile": writes to localStorage
// (always) and, if signed in, queues a debounced cloud push (see js/sync.js)
// so every mutation site doesn't need to know sync exists.
function saveActive() {
  Store.upsertProfile(ACTIVE);
  Sync.pushDebounced(ACTIVE);
}

/* ---------------------------------------------------------------- */
/* Onboarding                                                        */
/* ---------------------------------------------------------------- */
function initOnboarding() {
  const profiles = Store.getProfiles();
  $('loadExisting').hidden = profiles.length === 0;
  $('loadExisting').onclick = () => openSwitcher(true);

  ONBOARD_DRAFT = Store.createBlankProfile();
  ONBOARD_STEP = 0;
  renderOnboardStep();

  $('startOnboard').onclick = () => { ONBOARD_STEP = 1; renderOnboardStep(); };

  qsa('.onboard-step [data-next]').forEach(btn => btn.addEventListener('click', onboardNext));
  qsa('.onboard-step [data-back]').forEach(btn => btn.addEventListener('click', () => { ONBOARD_STEP--; renderOnboardStep(); }));

  // unit toggles (weight)
  wireUnitToggle('unit-toggle-weight', unit => { ONBOARD_DRAFT.unitWeight = unit; });
  // unit toggle (height)
  wireUnitToggle('unit-toggle-height', unit => {
    ONBOARD_DRAFT.unitHeight = unit;
    $('height-ftin').hidden = unit !== 'ftin';
    $('height-cm').hidden = unit !== 'cm';
  });

  // goal / experience choice cards
  wireChoiceGrid('ob-goal', v => ONBOARD_DRAFT.goal = v);
  wireChoiceGrid('ob-exp', v => ONBOARD_DRAFT.exp = v);
  ONBOARD_DRAFT.focusAreas = [];
  wireMultiChoiceGrid('ob-focus', vals => ONBOARD_DRAFT.focusAreas = vals);

  $('ob-sync-signin').onclick = () => onboardSyncSignIn();
}

async function onboardSyncSignIn() {
  const username = $('ob-sync-username').value.trim();
  const password = $('ob-sync-password').value;
  if (!username || !password) { $('obSyncStatus').textContent = 'Enter a username and password.'; return; }
  $('obSyncStatus').textContent = 'Signing in…';
  const res = await Sync.login(username, password);
  $('obSyncStatus').textContent = res.ok ? `Signed in as ${res.username}.` : (res.error === 'no_backend' ? 'No backend deployed yet — skip for now.' : 'Incorrect username or password.');
}

function wireUnitToggle(containerId, onChange) {
  const container = $(containerId);
  if (!container) return;
  container.querySelectorAll('.unit-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.unit-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onChange(btn.dataset.unit);
    });
  });
}
function wireChoiceGrid(containerId, onChange) {
  const container = $(containerId);
  if (!container) return;
  container.querySelectorAll('.choice-card').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.choice-card').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      onChange(btn.dataset.value);
    });
  });
}
function wireMultiChoiceGrid(containerId, onChange) {
  const container = $(containerId);
  if (!container) return;
  const max = Number(container.dataset.multi) || 2;
  container.querySelectorAll('.choice-card').forEach(btn => {
    btn.addEventListener('click', () => {
      const selected = container.querySelectorAll('.choice-card.selected');
      if (btn.classList.contains('selected')) {
        btn.classList.remove('selected');
      } else {
        if (selected.length >= max) selected[0].classList.remove('selected'); // oldest pick drops off
        btn.classList.add('selected');
      }
      const values = Array.from(container.querySelectorAll('.choice-card.selected')).map(b => b.dataset.value).filter(Boolean);
      onChange(values);
    });
  });
}

function renderOnboardStep() {
  qsa('.onboard-step').forEach(el => el.hidden = Number(el.dataset.step) !== ONBOARD_STEP);
}

function onboardNext() {
  // pull values from current step into draft before advancing
  if (ONBOARD_STEP === 1) {
    ONBOARD_DRAFT.name = $('ob-name').value.trim() || 'Athlete';
    ONBOARD_DRAFT.age = Number($('ob-age').value) || null;
    ONBOARD_DRAFT.sex = $('ob-sex').value;
  }
  if (ONBOARD_STEP === 2) {
    const wVal = Number($('ob-weight').value) || null;
    ONBOARD_DRAFT.weightLb = wVal == null ? null : (ONBOARD_DRAFT.unitWeight === 'kg' ? Store.kgToLb(wVal) : wVal);
    if (ONBOARD_DRAFT.unitHeight === 'cm') {
      const cm = Number($('ob-height-cm-val').value) || null;
      ONBOARD_DRAFT.heightIn = cm == null ? null : Store.cmToIn(cm);
    } else {
      ONBOARD_DRAFT.heightIn = Store.ftInToIn($('ob-height-ft').value, $('ob-height-in').value);
    }
  }
  if (ONBOARD_STEP === 6) {
    ONBOARD_DRAFT.days = Number($('ob-days').value);
    ONBOARD_DRAFT.equipment = $('ob-equipment').value;
    ONBOARD_DRAFT.limitations = $('ob-limitations').value.trim();
  }
  if (ONBOARD_STEP === 7) {
    finishOnboarding();
    return;
  }
  ONBOARD_STEP++;
  renderOnboardStep();
}

function finishOnboarding() {
  Store.upsertProfile(ONBOARD_DRAFT);
  Store.setActiveId(ONBOARD_DRAFT.id);
  ACTIVE = ONBOARD_DRAFT;
  // If they just signed in on the previous step, this seeds their new
  // account with this profile (or pulls down an existing one — see
  // Sync.syncAfterLogin). If they skipped sign-in, this is a no-op.
  Sync.syncAfterLogin(ACTIVE);
  showView('dashboard');
  renderDashboard();
  maybeAskOnboardingFollowUps();
}

async function maybeAskOnboardingFollowUps() {
  if (!Sync.isLoggedIn()) return;
  const sys = BEDROCK_PERSONA + ` The user just onboarded. Ask ONE short, specific follow-up question (max 2 sentences) that would meaningfully sharpen their training or nutrition plan (e.g. typical diet pattern, sleep, past injuries, schedule constraints). Do not repeat info you already have: name ${ONBOARD_DRAFT.name}, goal ${ONBOARD_DRAFT.goal}, experience ${ONBOARD_DRAFT.exp}, days/week ${ONBOARD_DRAFT.days}, equipment ${ONBOARD_DRAFT.equipment}.`;
  const res = await BedrockAPI.chat([{ role: 'user', content: 'Ask me your one follow-up question.' }], sys);
  if (res.ok && res.text) {
    ACTIVE.history.chats.push({ role: 'assistant', content: res.text, date: Date.now() });
    saveActive();
  }
}

/* ---------------------------------------------------------------- */
/* Dashboard                                                          */
/* ---------------------------------------------------------------- */
function renderDashboard() {
  if (!ACTIVE) return;
  $('avatarInitial').textContent = (ACTIVE.name || '?').charAt(0).toUpperCase();
  const goalLabels = { muscle: 'Build muscle', strength: 'Get stronger', fatloss: 'Lose fat, keep muscle', general: 'General fitness' };
  $('dashGoalLabel').textContent = 'Goal: ' + (goalLabels[ACTIVE.goal] || ACTIVE.goal);
  $('dashGreeting').textContent = `Hey ${ACTIVE.name || ''}`.trim();
  const count = (ACTIVE.history.workouts || []).length;
  const weekStreak = Insights.workoutStreak(ACTIVE);
  $('dashStreak').textContent = count === 0
    ? 'No workouts logged yet'
    : `${count} workout${count === 1 ? '' : 's'} logged${weekStreak >= 2 ? ` · 🔥 ${weekStreak}-week streak` : ''}`;

  const stalled = Insights.stalledExercises(ACTIVE);
  const session = Workout.todaysSession(ACTIVE, stalled);
  $('todayDayPill').textContent = session.label;
  const list = $('todayExerciseList');
  list.innerHTML = '';
  session.exercises.forEach(ex => {
    const row = document.createElement('div');
    row.className = 'exercise-row';
    row.innerHTML = `<span class="exercise-name">${ex.name}${ex.swappedFor ? ' <span class="badge-optional">swapped in</span>' : ''}</span><span class="exercise-meta">${ex.sets} × ${ex.reps} <button class="shuffle-btn" data-shuffle="${ex.id}" title="Not feeling this one? Swap it">🔀</button></span>`;
    list.appendChild(row);
    row.querySelector('[data-shuffle]').addEventListener('click', () => { excludeExerciseAndRefresh(ex.id); renderDashboard(); });
    if (ex.swappedFor) {
      const note = document.createElement('p');
      note.className = 'muted-copy'; note.style.margin = '-4px 0 6px';
      note.textContent = `${ex.swappedFor} plateaued (flat for 3 sessions) — mixing it up to break through. 📊 from your logs`;
      list.appendChild(note);
    }
  });

  $('fitbitBanner').hidden = Fitbit.isConnected();

  renderDailyInsight();
  renderReadiness();
  renderHousehold();
  renderFitbitToday();
  silentFitbitAutoSync();
}

// Live-ish Fitbit numbers for today (steps, resting HR, calories, active
// minutes) — a lightweight GET, safe to refresh on every Home render.
let FITBIT_TODAY = null;
async function renderFitbitToday() {
  const card = $('fitbitTodayCard');
  if (!Fitbit.isConnected()) { card.hidden = true; return; }
  const res = await Fitbit.fetchTodaySummary();
  if (!res.ok) { card.hidden = true; return; }
  FITBIT_TODAY = res;
  card.hidden = false;
  const stat = (icon, val, label) => `
    <div style="flex:1;">
      <span class="ms" style="font-size:20px; opacity:0.55;">${icon}</span>
      <div style="font-size:20px; font-weight:600; margin-top:4px;">${val ?? '—'}</div>
      <div style="font-size:10.5px; letter-spacing:.05em; text-transform:uppercase; opacity:0.45; margin-top:1px;">${label}</div>
    </div>`;
  $('fitbitTodayStats').innerHTML =
    stat('directions_walk', res.steps != null ? res.steps.toLocaleString() : null, 'Steps') +
    stat('favorite', res.restingHeartRate, 'Resting HR') +
    stat('local_fire_department', res.caloriesOut != null ? res.caloriesOut.toLocaleString() : null, 'Calories');
  $('fitbitTodayNote').textContent = 'Resting heart rate updates as your Fitbit syncs through the day — this isn’t a continuous live feed (that needs Fitbit’s separate intraday API approval), just the latest synced numbers. ⌚ from your Fitbit';
}

async function askFitbitBreakdown() {
  if (!FITBIT_TODAY) return;
  $('fitbitBreakdownResult').hidden = false;
  $('fitbitBreakdownResult').textContent = 'Thinking…';
  const wearable = Fitbit.recentWearableSummary(ACTIVE);
  const msg = `Today: ${FITBIT_TODAY.steps ?? '—'} steps, resting HR ${FITBIT_TODAY.restingHeartRate ?? '—'} bpm, ${FITBIT_TODAY.caloriesOut ?? '—'} calories out, ${FITBIT_TODAY.activeMinutes ?? 0} active minutes.` +
    (wearable ? `\nLast ${wearable.days} days (from logged Fitbit exercises): ${wearable.count} activities, ~${wearable.totalSteps} total steps${wearable.avgHr ? `, avg heart rate ~${wearable.avgHr} bpm` : ''}${wearable.totalDistanceKm ? `, ~${wearable.totalDistanceKm} km` : ''}.` : '');
  const sys = BEDROCK_PERSONA + ' You will get today’s Fitbit numbers plus recent trend data. Give a short (3-4 sentence), practical read: how today looks relative to the recent trend, and whether it changes anything about training or recovery today. Resting heart rate trending up over days can flag under-recovery — mention that ONLY if the data actually suggests it. Not medical advice.';
  const res = await BedrockAPI.chat([{ role: 'user', content: msg }], sys);
  $('fitbitBreakdownResult').textContent = res.ok ? res.text : 'Couldn’t reach Bedrock — check you’re signed in under Settings → Sync.';
}

// Not single-player: when two profiles share a device, show both side by
// side. Pure local computation, no server, no accounts — just reads the
// other profile already sitting in localStorage.
function renderHousehold() {
  const card = $('householdCard');
  const profiles = Store.getProfiles();
  if (profiles.length < 2) { card.hidden = true; return; }
  card.hidden = false;
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const rows = profiles.map(p => {
    const sessions = (p.history.workouts || []).filter(w => w.date >= weekAgo).length;
    return { name: p.name || 'Athlete', sessions, isActive: p.id === ACTIVE.id };
  }).sort((a, b) => b.sessions - a.sessions);

  let line;
  if (rows[0].sessions === 0) line = 'No sessions logged by either of you yet this week — first one in sets the pace.';
  else if (rows.length > 1 && rows[0].sessions === rows[1].sessions) line = `Tied at ${rows[0].sessions} session${rows[0].sessions === 1 ? '' : 's'} each this week — good pace.`;
  else line = `${rows[0].name} leads ${rows[0].sessions}-${rows[1] ? rows[1].sessions : 0} this week.`;

  $('householdBody').innerHTML = rows.map(r =>
    `<div class="scan-history-row"><span>${r.name}${r.isActive ? ' (you)' : ''}</span><span>${r.sessions} session${r.sessions === 1 ? '' : 's'}</span></div>`
  ).join('') + `<p class="muted-copy" style="margin-top:6px;">${line}</p>`;
}

function renderReadiness() {
  const card = $('readinessCard');
  if (!card) return;
  const r = Trajectory.acwr(ACTIVE);
  if (!r.hasData) { card.hidden = true; return; }
  card.hidden = false;
  const zoneLabel = { 'undertraining': 'Easing off', 'sweet-spot': 'Sweet spot', 'caution': 'Rising fast', 'high-risk': 'Spiked' }[r.zone];
  const zoneClass = { 'undertraining': 'evidence-moderate', 'sweet-spot': 'evidence-strong', 'caution': 'evidence-moderate', 'high-risk': 'evidence-limited' }[r.zone];
  const zoneColor = { 'undertraining': 'var(--accent-text)', 'sweet-spot': 'var(--olive-text)', 'caution': 'var(--accent-text)', 'high-risk': 'var(--danger)' }[r.zone];
  // Ring fill is a simple visual scale, not a clinical readout: ratio 0 →
  // empty, ratio 2.0 (double your recent baseline load) → full ring. ACWR
  // itself typically runs ~0.8-1.5 day to day, so this keeps the "sweet
  // spot" comfortably mid-ring rather than pinned at either end.
  const circumference = 264;
  const fillFrac = Math.max(0, Math.min(1, r.ratio / 2));
  const dashoffset = Math.round(circumference * (1 - fillFrac));
  $('readinessBody').innerHTML = `
    <div class="ring-gauge-wrap">
      <svg viewBox="0 0 100 100">
        <circle class="ring-gauge-track" cx="50" cy="50" r="42"></circle>
        <circle class="ring-gauge-fill" cx="50" cy="50" r="42" style="stroke:${zoneColor}; stroke-dashoffset:${dashoffset};"></circle>
      </svg>
      <div class="ring-gauge-center">
        <div><div class="val">${r.ratio}</div><div class="lbl">ACWR</div></div>
      </div>
    </div>
    <p class="muted-copy" style="text-align:center; margin:12px 0 0;"><span class="evidence-tag ${zoneClass}" style="margin:0 0 6px;">${zoneLabel}</span></p>
    <p class="muted-copy" style="text-align:center;">${r.message} <span class="badge-optional">📊 from your logs</span></p>
  `;
}

// Fires on every dashboard load. No-ops instantly if not connected or if
// synced recently — this is the whole "connect once, forget it" behavior.
async function silentFitbitAutoSync() {
  if (!Fitbit.isConnected()) return;
  const res = await Fitbit.autoSyncIfDue(ACTIVE);
  if (res.ok && res.added) {
    ACTIVE = Store.getActiveProfile();
    renderDashboard(); // refresh streak/insight now that new sessions landed
  }
}

async function renderDailyInsight() {
  $('insightText').textContent = 'Thinking…';
  const res = await Insights.getDailyInsight(ACTIVE);
  $('insightText').textContent = res.text;
  $('insightBadge').textContent = res.ruleBased ? '📊 built-in' : '🤖 Bedrock';
}

/* ---------------------------------------------------------------- */
/* Workout session                                                    */
/* ---------------------------------------------------------------- */
// Finds the most recent logged instance of an exercise, if any — used to
// both suggest a weight and to pre-fill/one-tap-repeat a whole exercise.
function lastLoggedExercise(exerciseId) {
  const workouts = ACTIVE.history.workouts || [];
  for (let i = workouts.length - 1; i >= 0; i--) {
    const entry = (workouts[i].exercises || []).find(e => e.id === exerciseId);
    if (entry && entry.sets && entry.sets.length) return entry;
  }
  return null;
}

// One tap, no confirmation dialog: user's choice, not friction. Excluding an
// exercise is reversible (see Settings > "Skipped exercises") so a shuffle
// is never a one-way door.
function excludeExerciseAndRefresh(exerciseId) {
  ACTIVE.excludedExercises = ACTIVE.excludedExercises || [];
  if (!ACTIVE.excludedExercises.includes(exerciseId)) ACTIVE.excludedExercises.push(exerciseId);
  saveActive();
}

// Swaps just one exercise inside an in-progress workout for an alternative
// from the same muscle pool — doesn't touch the other exercises, so any
// sets already logged for them stay put.
function shuffleWorkoutExercise(exIdx) {
  const ex = ACTIVE_WORKOUT.exercises[exIdx];
  const exDef = Workout.EX.find(e => e.id === ex.id) || (ACTIVE.customExercises || []).find(e => e.id === ex.id);
  if (!exDef) return;
  excludeExerciseAndRefresh(ex.id);
  const pool = Workout.exercisesFor(exDef.muscle, ACTIVE.equipment, ACTIVE.limitations, ACTIVE.customExercises, ACTIVE.excludedExercises)
    .filter(p => p.id !== ex.id);
  if (!pool.length) { renderWorkoutList(); return; } // nothing left to swap to — keep current, exclusion still saved for future plans
  const replacement = pool[Math.floor(Math.random() * pool.length)];
  const suggested = Workout.suggestWeight(ACTIVE, replacement.id);
  ACTIVE_WORKOUT.exercises[exIdx] = {
    id: replacement.id, name: replacement.name, targetRepsMin: ex.targetRepsMin,
    sets: ex.sets.map(() => ({ reps: suggested ? String(ex.targetRepsMin) : '', weight: suggested ? String(suggested) : '' }))
  };
  renderWorkoutList();
}

// Less typing, not more: pre-fill each set with a real suggested
// weight/rep-target value (not just a placeholder) so logging is mostly
// "confirm or nudge" rather than typing from a blank field every time.
function startWorkout() {
  const stalled = Insights.stalledExercises(ACTIVE);
  const session = Workout.todaysSession(ACTIVE, stalled);
  ACTIVE_WORKOUT = {
    dayIndex: session.dayIndex,
    label: session.label,
    date: Date.now(),
    exercises: session.exercises.map(ex => {
      const targetRepsMin = parseInt(ex.reps, 10) || 8;
      const suggested = Workout.suggestWeight(ACTIVE, ex.id);
      return {
        id: ex.id, name: ex.name, targetRepsMin,
        sets: Array.from({ length: ex.sets }).map(() => ({
          reps: suggested ? String(targetRepsMin) : '',
          weight: suggested ? String(suggested) : ''
        }))
      };
    })
  };
  $('workoutTitle').textContent = session.label;
  renderWorkoutList();
  showView('workout');
}

function renderWorkoutList() {
  const container = $('workoutList');
  container.innerHTML = '';
  ACTIVE_WORKOUT.exercises.forEach((ex, exIdx) => {
    const suggested = Workout.suggestWeight(ACTIVE, ex.id);
    const item = document.createElement('div');
    item.className = 'log-item';
    const exDef = Workout.EX.find(e => e.id === ex.id) || (ACTIVE.customExercises || []).find(e => e.id === ex.id);
    const lastLogged = lastLoggedExercise(ex.id);
    item.innerHTML = `
      <div class="log-item-head">
        <h4>${ex.name}</h4>
        <button class="shuffle-btn" data-shuffleworkout="${exIdx}" title="Don't like this one? Swap it for another">🔀 Swap</button>
      </div>
      <div class="exercise-meta">${suggested ? `Last time you handled ~${suggested} lb for target reps — pre-filled below, adjust if needed.` : 'No history yet — pick a weight you can control for the full rep range.'}</div>
      ${lastLogged ? `<button class="form-toggle" data-repeatlast="${exIdx}" style="color:var(--clay-dark);">↺ Same as last time</button>` : ''}
      ${exDef && exDef.cue ? `
        <button class="form-toggle" data-formtoggle="${exIdx}">Show proper form ▾</button>
        <div class="form-cue" data-formcue="${exIdx}" hidden>
          <p class="muted-copy">${exDef.cue}</p>
          <a href="https://www.youtube.com/results?search_query=${encodeURIComponent('how to do ' + ex.name + ' proper form')}" target="_blank" rel="noopener" class="form-demo-link">Watch a demo ↗</a>
        </div>
      ` : ''}
      <input type="text" class="equip-note" placeholder="Equipment / setup notes (optional)" value="${ex.equipmentNote || ''}" data-eqnote="${exIdx}">
      <div class="setRows" data-ex="${exIdx}"></div>
      <button class="add-set-btn" data-addset="${exIdx}">+ add set</button>
    `;
    container.appendChild(item);
    item.querySelector('[data-shuffleworkout]').addEventListener('click', () => shuffleWorkoutExercise(exIdx));
    item.querySelector('.equip-note').addEventListener('input', e => { ex.equipmentNote = e.target.value; });
    const repeatBtn = item.querySelector('[data-repeatlast]');
    if (repeatBtn) repeatBtn.addEventListener('click', () => {
      ex.sets = lastLogged.sets.map(s => ({ reps: String(s.reps), weight: String(s.weight) }));
      renderSetRows(exIdx);
    });
    const formToggle = item.querySelector('[data-formtoggle]');
    if (formToggle) formToggle.addEventListener('click', () => {
      const cueEl = item.querySelector('[data-formcue]');
      cueEl.hidden = !cueEl.hidden;
      formToggle.textContent = cueEl.hidden ? 'Show proper form ▾' : 'Hide proper form ▴';
    });
    renderSetRows(exIdx);
    item.querySelector('.add-set-btn').addEventListener('click', () => {
      ACTIVE_WORKOUT.exercises[exIdx].sets.push({ reps: '', weight: '' });
      renderSetRows(exIdx);
    });
  });
}

function renderSetRows(exIdx) {
  const wrap = qs(`.setRows[data-ex="${exIdx}"]`);
  const ex = ACTIVE_WORKOUT.exercises[exIdx];
  wrap.innerHTML = '';
  ex.sets.forEach((s, sIdx) => {
    const row = document.createElement('div');
    row.className = 'set-row';
    row.innerHTML = `
      <span>Set ${sIdx + 1}</span>
      <input type="number" inputmode="decimal" placeholder="lb" value="${s.weight}" data-field="weight">
      <input type="number" inputmode="numeric" placeholder="reps" value="${s.reps}" data-field="reps">
    `;
    row.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', () => {
        ex.sets[sIdx][inp.dataset.field] = inp.value;
      });
      // Rest timer starts itself the moment a set looks "done" (both fields
      // filled) — no extra tap needed. It's a plain dismissible banner, not
      // a lock screen, so it never gets in the way if the user just keeps
      // going without it.
      inp.addEventListener('blur', () => {
        if (row.dataset.rested) return;
        if (ex.sets[sIdx].weight !== '' && ex.sets[sIdx].reps !== '') {
          row.dataset.rested = '1';
          startRestTimer(Workout.restSecondsFor(ACTIVE.goal));
        }
      });
    });
    wrap.appendChild(row);
  });
}

/* ---------------------------------------------------------------- */
/* Rest timer — auto-starts after each set, always skippable          */
/* ---------------------------------------------------------------- */
let restTimerInterval = null;
let restTimerRemaining = 0;

function startRestTimer(seconds) {
  clearInterval(restTimerInterval);
  restTimerRemaining = seconds;
  const bar = $('restTimerBar');
  if (!bar) return;
  bar.hidden = false;
  renderRestTimer();
  restTimerInterval = setInterval(() => {
    restTimerRemaining--;
    if (restTimerRemaining <= 0) {
      clearInterval(restTimerInterval);
      if (navigator.vibrate) navigator.vibrate([120, 60, 120]); // silent-friendly nudge, no sound permission needed
      bar.hidden = true;
      return;
    }
    renderRestTimer();
  }, 1000);
}
function renderRestTimer() {
  const label = $('restTimerLabel');
  if (label) {
    const m = Math.floor(restTimerRemaining / 60), s = restTimerRemaining % 60;
    label.textContent = `Rest — ${m}:${String(s).padStart(2, '0')}`;
  }
}
function skipRestTimer() {
  clearInterval(restTimerInterval);
  const bar = $('restTimerBar');
  if (bar) bar.hidden = true;
}
function addRestTime(sec) {
  restTimerRemaining = Math.max(0, restTimerRemaining + sec);
  renderRestTimer();
}

// Celebrates real, data-verified wins (a beaten prior best, a maintained
// streak) — never fabricated hype. Auto-dismisses; tap to close early.
function showPRToast(prs, streak) {
  const toast = $('prToast');
  if (!toast) return;
  const realPRs = prs.filter(p => !p.isFirst);
  const lines = realPRs.slice(0, 3).map(p => `🏆 New PR — ${p.name}: ${p.weight} lb (up from ${p.prevWeight} lb)`);
  if (streak >= 2) lines.push(`🔥 ${streak}-week streak — keep it going`);
  if (!lines.length) return;
  toast.innerHTML = lines.map(l => `<p>${l}</p>`).join('');
  toast.hidden = false;
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => { toast.hidden = true; }, 5500);
}

function finishWorkout() {
  if (!ACTIVE_WORKOUT) return;
  skipRestTimer();
  const cleaned = {
    ...ACTIVE_WORKOUT,
    exercises: ACTIVE_WORKOUT.exercises.map(ex => ({
      ...ex,
      sets: ex.sets.filter(s => s.reps !== '' && s.weight !== '')
    }))
  };
  // Diff against history BEFORE this session is pushed in, so "PR" means
  // you actually beat your own prior best — not just that you typed a number.
  const prs = Insights.checkNewPRs(ACTIVE, cleaned.exercises);
  ACTIVE.history.workouts = ACTIVE.history.workouts || [];
  ACTIVE.history.workouts.push(cleaned);
  saveActive();
  ACTIVE_WORKOUT = null;
  showPRToast(prs, Insights.workoutStreak(ACTIVE));
  showView('dashboard');
  renderDashboard();
}

/* ---------------------------------------------------------------- */
/* Week plan — an expandable accordion on Home, not a separate screen */
/* ---------------------------------------------------------------- */
function toggleWeekAccordion() {
  const card = $('weekAccordionCard');
  const btn = $('tileWeekPlan');
  const opening = card.hidden;
  card.hidden = !opening;
  btn.textContent = opening ? '🗓 Hide full week ▴' : '🗓 See full week ▾';
  if (opening) renderWeekAccordion();
}

function renderWeekAccordion() {
  const stalled = Insights.stalledExercises(ACTIVE);
  const plan = Workout.buildWeekPlan(ACTIVE, stalled);
  const container = $('weekAccordionCard');
  container.innerHTML = '';
  plan.forEach(day => {
    const card = document.createElement('div');
    card.className = 'week-day-card';
    card.innerHTML = `<h4>${day.label}</h4>` + day.exercises.map(ex =>
      `<div class="exercise-row"><span class="exercise-name">${ex.name}${ex.swappedFor ? ' <span class="badge-optional">swapped</span>' : ''}</span><span class="exercise-meta">${ex.sets} × ${ex.reps} · rest ${ex.rest}</span></div>`
    ).join('');
    container.appendChild(card);
  });
}

/* ---------------------------------------------------------------- */
/* Progress / scan                                                    */
/* ---------------------------------------------------------------- */
let PENDING_PHOTO = null;
let PENDING_KEYPOINTS = null;

function renderProgress() {
  $('scanTip').textContent = Scan.randomTip();
  PENDING_PHOTO = null;
  PENDING_KEYPOINTS = null;
  $('scanPhotoPreview').hidden = true;
  $('scanPhotoPreview').innerHTML = '';
  $('scan-weight').value = '';
  $('scan-waist').value = '';
  $('scan-chest').value = '';
  $('scan-arm').value = '';
  $('scan-hips').value = '';
  $('scan-thigh').value = '';
  $('scanAiResult').hidden = true;
  $('comparePhotosResult').hidden = true;
  $('focusOverlayCanvas').hidden = true;

  const latest = Scan.latestPhoto(ACTIVE);
  const photosWithPics = (ACTIVE.history.checkins || []).filter(c => c.photo);
  $('latestPhotoWrap').hidden = !latest;
  if (latest) $('scanHistoryPhoto').src = latest.photo;
  $('btnComparePhotos').hidden = photosWithPics.length < 2;
  renderFocusOverlayToggle();
  $('scanAiCard').style.opacity = Sync.isLoggedIn() ? '1' : '0.55';

  drawWeightChart();
  drawVolumeChart();
  drawMuscleChart();
  drawExerciseChart();
  renderScanHistory();
  renderTrajectoryStats();
}

function drawMuscleChart() {
  const byMuscle = Insights.muscleVolumeBreakdown(ACTIVE);
  const items = Object.entries(byMuscle).map(([label, value]) => ({ label, value: Math.round(value) }));
  MiniChart.drawBars($('muscleChart'), items);
  $('muscleCaption').textContent = Insights.muscleBalanceCaption(byMuscle, ACTIVE);
}

function drawExerciseChart() {
  const options = Insights.loggedExerciseOptions(ACTIVE);
  const picker = $('exercisePicker');
  const prevChoice = picker.value;
  picker.innerHTML = options.map(o => `<option value="${o.id}">${o.name}</option>`).join('') || '<option value="">No lifts logged yet</option>';
  if (options.some(o => o.id === prevChoice)) picker.value = prevChoice;
  picker.onchange = drawExerciseChart;

  const chosen = picker.value || (options[0] && options[0].id);
  const series = chosen ? Insights.exerciseSeries(ACTIVE, chosen) : [];
  const unit = ACTIVE.unitWeight === 'kg' ? 'kg' : 'lb';
  const points = series.map(s => ({ y: ACTIVE.unitWeight === 'kg' ? Math.round(Store.lbToKg(s.weight) * 10) / 10 : s.weight }));
  MiniChart.draw($('exerciseChart'), [{ points }]);
  $('exerciseCaption').textContent = Insights.trendCaption(series, unit);
}

function renderScanHistory() {
  const wrap = $('scanHistory');
  wrap.innerHTML = '';
  const list = (ACTIVE.history.checkins || []).slice().reverse().slice(0, 6);
  if (!list.length) { wrap.innerHTML = '<p class="muted-copy">No check-ins yet.</p>'; return; }
  list.forEach(c => {
    const row = document.createElement('div');
    row.className = 'scan-history-row';
    const d = new Date(c.date).toLocaleDateString();
    row.innerHTML = `<span>${d}</span><span>${c.weight != null ? displayWeight(c.weight) : '—'}</span>`;
    wrap.appendChild(row);
  });
}

function drawWeightChart() {
  const checkins = (ACTIVE.history.checkins || []).filter(c => c.weight != null).sort((a, b) => a.date - b.date);
  const points = checkins.map(c => ({ x: c.date, y: ACTIVE.unitWeight === 'kg' ? Store.lbToKg(c.weight) : c.weight }));
  const proj = Trajectory.project(ACTIVE);
  const projPoints = proj.projectionPoints.filter(p => p.y != null).map(p => ({ x: p.x, y: ACTIVE.unitWeight === 'kg' ? Store.lbToKg(p.y) : p.y }));
  MiniChart.draw($('progressChart'), [{ points, projection: projPoints }]);
  const unit = ACTIVE.unitWeight === 'kg' ? 'kg' : 'lb';
  $('weightCaption').textContent = checkins.length >= 2
    ? `Dashed line = ${proj.weeksAhead}-week projection at your current pace. Solid = what you've actually logged.`
    : `Log a couple more check-ins (weight in ${unit}) to unlock a projection here.`;
}

function drawVolumeChart() {
  const series = Trajectory.volumeSeries(ACTIVE);
  const points = series.map((s, i) => ({ x: i, y: Math.round(s.volume) }));
  MiniChart.draw($('volumeChart'), [{ points: points.map(p => ({ y: p.y })) }]);
}

function renderTrajectoryStats() {
  const proj = Trajectory.project(ACTIVE);
  const unit = ACTIVE.unitWeight === 'kg' ? 'kg' : 'lb';
  const wrap = $('trajectoryStats');
  const totalVolume = Trajectory.volumeSeries(ACTIVE).reduce((a, s) => a + s.volume, 0);
  wrap.innerHTML = `
    <div class="scan-history-row"><span>Sessions logged</span><span>${(ACTIVE.history.workouts || []).length}</span></div>
    <div class="scan-history-row"><span>Total volume lifted</span><span>${Math.round(totalVolume).toLocaleString()} lb·reps</span></div>
    <div class="scan-history-row"><span>Plan adherence (4wk)</span><span>${proj.adherencePct}%</span></div>
  `;
  const p = document.createElement('p');
  p.className = 'muted-copy';
  p.style.marginTop = '8px';
  p.textContent = Trajectory.narrativeText(proj, unit);
  wrap.appendChild(p);

  $('btnAskTrajectory').hidden = !Sync.isLoggedIn();

  const n = (ACTIVE.history.workouts || []).length;
  const stage = n < 4 ? 'Early data — estimates are rough, mostly based on research norms for your experience level.'
    : n < 15 ? 'Building a real picture — projections are starting to lean on your own numbers.'
    : 'Well-established data — projections here are driven mostly by your actual trend, not just averages.';
  $('dataMaturityNote').textContent = `${n} session${n === 1 ? '' : 's'} logged. ${stage}`;
}

async function askTrajectoryAi() {
  const proj = Trajectory.project(ACTIVE);
  const sys = BEDROCK_PERSONA + ' You will be given a structured data summary. Give a short (3-4 sentence), realistic, non-medical read on the trend and ONE concrete suggestion. Be honest if the data is too sparse to say much yet.';
  const msg = Insights.summaryText(ACTIVE) + `\nProjected ${proj.weeksAhead}-week weight change range: ${proj.lowRange} to ${proj.highRange} lb.`;
  $('trajectoryAiResult').hidden = false;
  $('trajectoryAiResult').textContent = 'Thinking…';
  const res = await BedrockAPI.chat([{ role: 'user', content: msg }], sys);
  $('trajectoryAiResult').textContent = res.ok ? res.text : 'Couldn’t reach Bedrock — check you’re signed in under Settings → Sync.';
}

function setPendingPhoto(dataUrl, keypoints) {
  PENDING_PHOTO = dataUrl;
  PENDING_KEYPOINTS = keypoints || null;
  $('scanPhotoPreview').hidden = false;
  $('scanPhotoPreview').innerHTML = `<img src="${dataUrl}" alt="progress photo">`;
}

function handlePhotoSelected(file) {
  Scan.fileToCompressedDataUrl(file).then(setPendingPhoto);
}

// Tries the live in-page camera (with the standing-guide + skeleton
// overlay) first; falls back to the plain OS file/camera picker if
// unsupported or denied.
async function openBodyScanCamera() {
  const res = await Camera.open({
    guide: 'body',
    tip: 'Line up head-to-toe with the guide, stand centered, arms slightly out.',
    onCapture: setPendingPhoto
  });
  if (!res.ok) $('scanPhotoInput').click();
}

function saveScan() {
  Scan.addCheckin(ACTIVE, {
    photo: PENDING_PHOTO,
    poseKeypoints: PENDING_KEYPOINTS,
    weight: $('scan-weight').value ? inputToLb($('scan-weight').value) : null,
    waist: $('scan-waist').value,
    chest: $('scan-chest').value,
    arm: $('scan-arm').value,
    hips: $('scan-hips').value,
    thigh: $('scan-thigh').value
  });
  renderProgress();
}

// Maps onboarding focus areas onto real measurement trends (first vs
// latest logged value) plus, when available, the pose landmarks captured
// with the most recent photo — a labeled overlay, not a fabricated
// fat/muscle heatmap. No camera can see body composition; this only shows
// what's actually been measured, positioned near the relevant joints.
const FOCUS_REGION_MAP = {
  push: { label: 'Upper body (push)', field: 'chest', joints: ['left_shoulder', 'right_shoulder'] },
  pull: { label: 'Upper body (pull) — arm width', field: 'arm', joints: ['left_shoulder', 'right_shoulder'] },
  legs: { label: 'Legs & glutes', field: 'hips', joints: ['left_hip', 'right_hip'] },
  core: { label: 'Core / stomach', field: 'waist', joints: ['left_hip', 'right_hip'] }
};

function measurementDelta(field) {
  const checkins = (ACTIVE.history.checkins || []).filter(c => c[field] != null).sort((a, b) => a.date - b.date);
  if (checkins.length < 2) return null;
  const first = checkins[0][field], last = checkins[checkins.length - 1][field];
  return Math.round((last - first) * 10) / 10;
}

function renderFocusOverlayToggle() {
  const btn = $('btnToggleFocusOverlay');
  if (!btn) return;
  const hasFocus = (ACTIVE.focusAreas || []).length > 0;
  const hasPhoto = !!Scan.latestPhoto(ACTIVE);
  btn.hidden = !(hasFocus && hasPhoto);
}

function toggleFocusOverlay() {
  const canvas = $('focusOverlayCanvas');
  const opening = canvas.hidden;
  canvas.hidden = !opening;
  if (opening) drawFocusOverlay();
}

function drawFocusOverlay() {
  const latest = Scan.latestPhoto(ACTIVE);
  const canvas = $('focusOverlayCanvas');
  const img = $('scanHistoryPhoto');
  if (!latest || !img) return;
  canvas.width = img.clientWidth; canvas.height = img.clientHeight;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const kp = latest.poseKeypoints;
  const byName = {};
  if (kp) kp.forEach(k => { if (k.score > 0.3) byName[k.name] = k; });

  ctx.font = '12px -apple-system, sans-serif';
  (ACTIVE.focusAreas || []).forEach((area, i) => {
    const region = FOCUS_REGION_MAP[area];
    if (!region) return;
    const delta = measurementDelta(region.field);
    const label = delta == null ? `🎯 ${region.label} — log a couple more check-ins to see a trend`
      : `🎯 ${region.label} — ${delta > 0 ? '+' : ''}${delta}in since your first check-in`;

    let x = 12, y = 22 + i * 20;
    const joint = region.joints.find(j => byName[j]);
    if (joint) { x = byName[joint].x * canvas.width; y = byName[joint].y * canvas.height - 10 * (i + 1); }

    const textW = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(28,23,18,0.72)';
    ctx.fillRect(x - 4, y - 13, textW + 8, 18);
    ctx.fillStyle = '#f4ede0';
    ctx.fillText(label, x, y);
  });
}

async function askAiAboutScan() {
  const latest = Scan.latestPhoto(ACTIVE);
  const photo = PENDING_PHOTO || (latest && latest.photo);
  if (!photo) { alert('Take or upload a photo first.'); return; }
  if (!Sync.isLoggedIn()) { alert('Sign in under Settings → Sync first.'); return; }
  $('scanAiResult').hidden = false;
  $('scanAiResult').textContent = 'Looking…';
  const sys = BEDROCK_PERSONA + ' Give general, non-medical feedback on this standing progress photo: posture, symmetry, and whether the shot is consistent for future comparisons (angle, lighting, distance). Do NOT estimate body fat percentage, diagnose anything, or make medical claims. Keep it to 3-4 sentences.';
  const res = await BedrockAPI.askAboutImage(photo, 'Give me general posture/consistency feedback on this progress photo.', sys);
  $('scanAiResult').textContent = res.ok ? res.text : 'Couldn’t reach Bedrock — check you’re signed in under Settings → Sync.';
}

// Published research on smartphone photo-based body composition tracking
// (e.g. visual-comparison methods validated against DXA in npj Digital
// Medicine) shows this CAN work directionally when photos are consistent
// — but that's a dedicated, validated model, not a general-purpose vision
// model doing a casual read. This is scoped accordingly: a qualitative,
// directional impression only, never a percentage or a diagnosis, and only
// offered once there are two consistent check-in photos to compare.
async function comparePhotosClick() {
  const photos = (ACTIVE.history.checkins || []).filter(c => c.photo).slice(-2);
  if (photos.length < 2) return;
  if (!Sync.isLoggedIn()) { alert('Sign in under Settings → Sync first.'); return; }
  $('comparePhotosResult').hidden = false;
  $('comparePhotosResult').textContent = 'Comparing…';
  const sys = BEDROCK_PERSONA + ' You will see two standing progress photos, oldest first. Give a brief, honest, directional impression of visible change (e.g. posture, general visible tone/fullness) — 3 sentences max. Do NOT estimate a body fat percentage or give a medical/diagnostic read; you are not a validated body-composition tool, just giving a casual visual impression. If the photos are too inconsistent (angle/distance/lighting) to compare fairly, say so.';
  const res = await BedrockAPI.ask({
    system: sys, maxTokens: 300,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: `Photo 1 (${new Date(photos[0].date).toLocaleDateString()}):` },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: photos[0].photo.split(',')[1] } },
        { type: 'text', text: `Photo 2 (${new Date(photos[1].date).toLocaleDateString()}):` },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: photos[1].photo.split(',')[1] } },
        { type: 'text', text: 'What visible change, if any, do you notice between these two?' }
      ]
    }]
  });
  $('comparePhotosResult').textContent = res.ok ? res.text : 'Couldn’t reach Bedrock — check you’re signed in under Settings → Sync.';
}

/* ---------------------------------------------------------------- */
/* Supplements                                                        */
/* ---------------------------------------------------------------- */
function renderSupplements(filter = 'all') {
  const wrap = $('supplementList');
  wrap.innerHTML = '';
  const list = SupplementList.filter(s => filter === 'all' || s.goals.includes(filter));
  list.forEach(s => {
    const card = document.createElement('div');
    card.className = 'supplement-card';
    const evClass = 'evidence-' + s.evidence;
    const evLabel = { strong: 'Strong evidence', moderate: 'Moderate evidence', limited: 'Limited evidence' }[s.evidence];
    card.innerHTML = `
      <span class="evidence-tag ${evClass}">${evLabel}</span>
      <h4>${s.name}</h4>
      <p class="supp-detail">${s.what}</p>
      <p class="supp-detail"><b>Typical dose:</b> ${s.dose}</p>
      <p class="supp-detail"><b>Timing:</b> ${s.timing}</p>
      <p class="supp-detail"><b>Caution:</b> ${s.caution}</p>
    `;
    wrap.appendChild(card);
  });
}

/* ---------------------------------------------------------------- */
/* Nutrition (part of the Fuel tab)                                   */
/* ---------------------------------------------------------------- */
function switchFuelTab(tab) {
  qsa('#fuelTabs .chip').forEach(c => c.classList.toggle('active', c.dataset.tab === tab));
  $('panel-supplements').hidden = tab !== 'supplements';
  $('panel-nutrition').hidden = tab !== 'nutrition';
  if (tab === 'nutrition') renderNutrition();
}

function renderNutrition() {
  const target = Nutrition.dailyTarget(ACTIVE);
  $('nutritionTargets').innerHTML = target ? `
    <div class="scan-history-row"><span>Calories</span><span>~${target.calories} kcal</span></div>
    <div class="scan-history-row"><span>Protein</span><span>~${target.proteinG} g</span></div>
    <div class="scan-history-row"><span>Carbs</span><span>~${target.carbG} g</span></div>
    <div class="scan-history-row"><span>Fat</span><span>~${target.fatG} g</span></div>
  ` : '<p class="muted-copy">Add your height and weight in Settings to unlock this.</p>';

  const waterTarget = Nutrition.waterTargetMl(ACTIVE);
  const waterToday = Nutrition.todayWaterMl(ACTIVE);
  $('waterProgress').innerHTML = `<div class="scan-history-row"><span>Today</span><span>${waterToday} / ${waterTarget} ml</span></div>`;

  const remaining = Nutrition.remainingToday(ACTIVE);
  $('remainingToday').innerHTML = remaining ? `
    <div class="scan-history-row"><span>Logged today</span><span>${remaining.totals.calories} kcal · ${remaining.totals.proteinG}g protein</span></div>
    <div class="scan-history-row"><span><b>Remaining vs. ${ACTIVE.goal} goal</b></span><span><b>${remaining.calories >= 0 ? remaining.calories + ' kcal' : 'over by ' + Math.abs(remaining.calories)} · ${remaining.proteinG >= 0 ? remaining.proteinG + 'g protein' : 'protein met'}</b></span></div>
  ` : `<div class="scan-history-row"><span>Logged today</span><span>${Nutrition.todayTotals(ACTIVE).calories} kcal</span></div>`;

  const mealWrap = $('mealList');
  mealWrap.innerHTML = '';
  Nutrition.todayMeals(ACTIVE).slice().reverse().forEach(m => {
    const row = document.createElement('div');
    row.className = 'scan-history-row';
    row.innerHTML = `<span>${m.name}${m.aiEstimated ? ' 🤖' : ''}</span><span>${m.calories} kcal / ${m.proteinG}g</span>`;
    mealWrap.appendChild(row);
  });

  const chipWrap = $('frequentMealChips');
  const frequent = Nutrition.frequentMeals(ACTIVE);
  chipWrap.innerHTML = frequent.length ? frequent.map(m => `<button class="chip" data-quicklog='${JSON.stringify(m).replace(/'/g, "&#39;")}'>${m.name} ↺</button>`).join('') : '';
  chipWrap.querySelectorAll('[data-quicklog]').forEach(btn => btn.addEventListener('click', () => {
    const m = JSON.parse(btn.dataset.quicklog.replace(/&#39;/g, "'"));
    Nutrition.addMeal(ACTIVE, m);
    renderNutrition();
  }));
}

async function estimateTextClick() {
  const text = $('mealQuickText').value.trim();
  if (!text) return;
  if (!Sync.isLoggedIn()) { alert('Sign in under Settings → Sync first — or just fill in calories/protein by hand below.'); return; }
  $('mealName').value = 'Estimating…';
  const res = await Nutrition.estimateFromText(text);
  if (res.ok) {
    $('mealName').value = res.name;
    $('mealCalories').value = res.calories;
    $('mealProtein').value = res.proteinG;
  } else {
    $('mealName').value = text;
    alert('Couldn’t reach Bedrock — fill in calories/protein by hand, or check you’re signed in under Settings → Sync.');
  }
}

function addWater(delta) {
  Nutrition.logWater(ACTIVE, Math.max(0, Nutrition.todayWaterMl(ACTIVE) + delta) - Nutrition.todayWaterMl(ACTIVE));
  renderNutrition();
}

function addMealFromForm() {
  const name = $('mealName').value.trim() || $('mealQuickText').value.trim();
  const calories = $('mealCalories').value, proteinG = $('mealProtein').value;
  if (!name || (!calories && !proteinG)) { alert('Add a food name and at least calories or protein.'); return; }
  Nutrition.addMeal(ACTIVE, { name, calories, proteinG, aiEstimated: !!$('mealName').value.trim() && $('mealName').value !== $('mealQuickText').value });
  $('mealName').value = ''; $('mealQuickText').value = ''; $('mealCalories').value = ''; $('mealProtein').value = '';
  renderNutrition();
}

async function scanFoodDataUrl(dataUrl) {
  if (!Sync.isLoggedIn()) { alert('Sign in under Settings → Sync first.'); return; }
  $('mealName').value = 'Scanning…';
  const res = await Nutrition.estimateFoodPhoto(dataUrl);
  if (res.ok) {
    $('mealName').value = res.name;
    $('mealCalories').value = res.calories;
    $('mealProtein').value = res.proteinG;
    alert(res.note + ' Edit the numbers if they look off, then tap Log it.');
  } else {
    $('mealName').value = '';
    alert('Couldn’t reach Bedrock — check you’re signed in under Settings → Sync.');
  }
}

async function scanFoodPhoto(file) {
  const dataUrl = await Scan.fileToCompressedDataUrl(file, 400);
  scanFoodDataUrl(dataUrl);
}

// Live in-page camera with the food-framing + reference-object guide;
// falls back to the OS picker if camera access isn't available.
async function openFoodScanCamera() {
  const res = await Camera.open({
    guide: 'food',
    tip: 'Center the plate. Including something of known size (fork, hand, coin) helps portion accuracy.',
    onCapture: scanFoodDataUrl
  });
  if (!res.ok) $('foodPhotoInput').click();
}

async function suggestMealClick() {
  if (!Sync.isLoggedIn()) { alert('Sign in under Settings → Sync first.'); return; }
  $('mealSuggestResult').hidden = false;
  $('mealSuggestResult').textContent = 'Thinking…';
  const res = await Nutrition.suggestMeal(ACTIVE);
  $('mealSuggestResult').textContent = res.ok ? res.text : 'Couldn’t reach Bedrock — check you’re signed in under Settings → Sync.';
}

async function aiSupplementsClick() {
  if (!Sync.isLoggedIn()) { alert('Sign in under Settings → Sync first.'); return; }
  $('aiSupplementResult').hidden = false;
  $('aiSupplementResult').textContent = 'Thinking…';
  const sys = BEDROCK_PERSONA + ' You will get a data summary and a fixed supplement reference list has already been shown to the user separately. Recommend at most 2-3 supplements from mainstream sports-nutrition evidence (not exotic/unproven ones) that best fit this specific person\'s goal and gaps, and say briefly why each one. End with a one-line reminder that food and training come first. Under 130 words.';
  const res = await BedrockAPI.chat([{ role: 'user', content: Insights.summaryText(ACTIVE) }], sys);
  $('aiSupplementResult').textContent = res.ok ? res.text : 'Couldn’t reach Bedrock — check you’re signed in under Settings → Sync.';
}

/* ---------------------------------------------------------------- */
/* Chat                                                                */
/* ---------------------------------------------------------------- */
const CHAT_PROMPTS = [
  'How is my training actually going?',
  'What should I focus on this week?',
  'What should I eat today?',
  'Am I on track for my goal?'
];

function renderChat() {
  const log = $('chatLog');
  log.innerHTML = '';
  const history = ACTIVE.history.chats || [];
  if (!history.length) {
    log.innerHTML = '<div class="chat-bubble chat-ai">Ask me anything about your plan, form, recovery, or food — I can see your logged data. Sign in under Settings → Sync if you haven’t yet.</div>';
  }
  history.forEach(m => {
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble ' + (m.role === 'user' ? 'chat-user' : 'chat-ai');
    bubble.textContent = m.content;
    log.appendChild(bubble);
  });
  log.scrollTop = log.scrollHeight;

  const chipRow = $('chatPrompts');
  if (chipRow && !chipRow.dataset.built) {
    chipRow.innerHTML = CHAT_PROMPTS.map(p => `<button class="chip" data-prompt="${p}">${p}</button>`).join('');
    chipRow.dataset.built = '1';
    chipRow.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => { $('chatInput').value = c.dataset.prompt; sendChat(); }));
  }
}

async function sendChat() {
  const input = $('chatInput');
  const text = input.value.trim();
  if (!text) return;
  if (!Sync.isLoggedIn()) { alert('Sign in under Settings → Sync first.'); return; }
  ACTIVE.history.chats = ACTIVE.history.chats || [];
  ACTIVE.history.chats.push({ role: 'user', content: text, date: Date.now() });
  input.value = '';
  renderChat();
  saveActive();

  // Data-grounded: every chat turn includes a fresh summary of the user's
  // actual logs (the same numbers driving their charts) so answers cite
  // real figures instead of generic advice, and always end with one
  // concrete next step.
  const sys = BEDROCK_PERSONA + `\n\nHere is the user's current data summary — this is exactly what feeds their charts on the Progress and Fuel tabs. Cite specific numbers from it directly in your answer (e.g. "your bench is up to X lb", "legs is Y% of your recent volume") rather than speaking generically. If the summary doesn't have what you'd need to answer precisely, say so plainly instead of guessing. End with one concrete, specific next action.\n\n${Insights.summaryText(ACTIVE)}\n\nKeep answers under ~130 words.`;
  const recent = ACTIVE.history.chats.slice(-10).map(m => ({ role: m.role, content: m.content }));
  const res = await BedrockAPI.chat(recent, sys);
  ACTIVE.history.chats.push({ role: 'assistant', content: res.ok ? res.text : 'Couldn’t reach Bedrock — check you’re signed in under Settings → Sync.', date: Date.now() });
  saveActive();
  renderChat();
}

/* ---------------------------------------------------------------- */
/* Settings                                                            */
/* ---------------------------------------------------------------- */
function renderSettings() {
  renderSyncPanel();
  qs('#settingsUnitWeight').querySelectorAll('.unit-opt').forEach(b => b.classList.toggle('active', b.dataset.unit === ACTIVE.unitWeight));
  renderProfileManageList();
  renderCustomExerciseList();
  renderExcludedExerciseList();
  $('importStatus').textContent = '';
  renderFitbitPanel();
}

function renderSyncPanel() {
  const loggedIn = Sync.isLoggedIn();
  $('syncSignedOut').hidden = loggedIn;
  $('syncSignedIn').hidden = !loggedIn;
  if (loggedIn) {
    $('syncStatus').textContent = `Signed in as ${Sync.getUsername()} — backed up and AI features unlocked.`;
  } else {
    $('settingsSyncUsername').value = '';
    $('settingsSyncPassword').value = '';
    $('syncStatus').textContent = Sync.backendUrl() ? 'Not signed in.' : 'No backend deployed yet — see cloudflare-worker/README.md.';
  }
}

async function syncSignInClick() {
  const username = $('settingsSyncUsername').value.trim();
  const password = $('settingsSyncPassword').value;
  if (!username || !password) { $('syncStatus').textContent = 'Enter a username and password.'; return; }
  $('syncStatus').textContent = 'Signing in…';
  const res = await Sync.login(username, password);
  if (!res.ok) {
    $('syncStatus').textContent = res.error === 'no_backend' ? 'No backend deployed yet — see cloudflare-worker/README.md.' : 'Incorrect username or password.';
    return;
  }
  $('syncStatus').textContent = 'Syncing…';
  const syncRes = await Sync.syncAfterLogin(ACTIVE);
  if (syncRes.applied) { ACTIVE = Store.getActiveProfile(); renderDashboard(); }
  renderSyncPanel();
}

async function syncSignOutClick() {
  await Sync.logout();
  renderSyncPanel();
}

async function syncNowClick() {
  $('syncStatus').textContent = 'Syncing…';
  await Sync.push(ACTIVE);
  renderSyncPanel();
}

function renderFitbitPanel() {
  $('fitbitRedirectUri').textContent = location.href.split('?')[0].split('#')[0];
  $('fitbitClientId').value = Fitbit.getClientId();
  const connected = Fitbit.isConnected();
  $('btnFitbitConnect').hidden = connected;
  $('btnFitbitSync').hidden = !connected;
  $('btnFitbitDisconnect').hidden = !connected;
  $('fitbitStatus').textContent = connected
    ? `Connected — auto-syncs quietly whenever you open Bedrock (at most every 30 min).${ACTIVE.fitbitLastAutoSyncAt ? ' Last synced ' + timeAgo(ACTIVE.fitbitLastAutoSyncAt) + '.' : ''}`
    : 'Not connected yet.';
}

function timeAgo(ts) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} day(s) ago`;
}

async function fitbitSyncClick() {
  $('fitbitStatus').textContent = 'Syncing…';
  const res = await Fitbit.syncToProfile(ACTIVE);
  ACTIVE.fitbitLastAutoSyncAt = Date.now(); // manual sync also resets the auto-sync timer
  saveActive();
  ACTIVE = Store.getActiveProfile();
  $('fitbitStatus').textContent = res.ok ? `Synced — ${res.added} new session(s).` : 'Sync failed — try reconnecting.';
  renderDashboard();
}

function renderCustomExerciseList() {
  const wrap = $('customExList');
  wrap.innerHTML = '';
  (ACTIVE.customExercises || []).forEach(ex => {
    const row = document.createElement('div');
    row.className = 'scan-history-row';
    row.innerHTML = `<span>${ex.name} (${ex.muscle})</span><button class="btn btn-ghost danger" style="padding:2px 8px;" data-delex="${ex.id}">Remove</button>`;
    row.querySelector('[data-delex]').addEventListener('click', () => {
      ACTIVE.customExercises = ACTIVE.customExercises.filter(e => e.id !== ex.id);
      saveActive();
      renderCustomExerciseList();
    });
    wrap.appendChild(row);
  });
}

// Shuffling an exercise away isn't permanent — this list is where the user
// takes back control and brings one back into rotation.
function renderExcludedExerciseList() {
  const wrap = $('excludedExList');
  if (!wrap) return;
  const excluded = ACTIVE.excludedExercises || [];
  const section = $('excludedExSection');
  if (section) section.hidden = excluded.length === 0;
  wrap.innerHTML = '';
  excluded.forEach(id => {
    const def = Workout.EX.find(e => e.id === id) || (ACTIVE.customExercises || []).find(e => e.id === id);
    const row = document.createElement('div');
    row.className = 'scan-history-row';
    row.innerHTML = `<span>${def ? def.name : id}</span><button class="btn btn-ghost" style="padding:2px 8px;" data-unex="${id}">Bring back</button>`;
    row.querySelector('[data-unex]').addEventListener('click', () => {
      ACTIVE.excludedExercises = ACTIVE.excludedExercises.filter(e => e !== id);
      saveActive();
      renderExcludedExerciseList();
    });
    wrap.appendChild(row);
  });
}

function addCustomExercise() {
  const name = $('customExName').value.trim();
  if (!name) return;
  ACTIVE.customExercises = ACTIVE.customExercises || [];
  ACTIVE.customExercises.push({
    id: 'custom_' + Date.now().toString(36),
    name, muscle: $('customExMuscle').value,
    equip: ['full', 'machines', 'dumbbell', 'bodyweight'], custom: true
  });
  saveActive();
  $('customExName').value = '';
  renderCustomExerciseList();
}

function renderProfileManageList() {
  const wrap = $('profileManageList');
  wrap.innerHTML = '';
  Store.getProfiles().forEach(p => {
    const row = document.createElement('div');
    row.className = 'switcher-row' + (p.id === ACTIVE.id ? ' active' : '');
    row.innerHTML = `<span class="avatar">${(p.name || '?').charAt(0).toUpperCase()}</span>
      <div style="flex:1"><div class="swname">${p.name}</div><div class="swgoal">${p.goal}</div></div>
      <button class="btn btn-ghost danger" data-del="${p.id}" style="padding:6px 10px;">Delete</button>`;
    row.querySelector('[data-del]').addEventListener('click', e => {
      e.stopPropagation();
      if (confirm(`Delete ${p.name}'s profile and history? This can't be undone.`)) {
        Store.deleteProfile(p.id);
        const newId = Store.getActiveId();
        if (newId) { ACTIVE = Store.getActiveProfile(); renderDashboard(); renderSettings(); }
        else { location.reload(); }
      }
    });
    row.addEventListener('click', () => { Store.setActiveId(p.id); ACTIVE = Store.getActiveProfile(); renderDashboard(); renderSettings(); });
    wrap.appendChild(row);
  });
}

function exportData() {
  const blob = new Blob([JSON.stringify(ACTIVE, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `bedrock-${ACTIVE.name || 'profile'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const text = e.target.result;
      let importedCount = 0, source = 'file';

      if (file.name.endsWith('.json')) {
        const data = JSON.parse(text);
        const sessions = Array.isArray(data) ? data : (data.workouts || data.activities || []);
        sessions.forEach(s => { ACTIVE.history.workouts.push(normalizeImportedSession(s)); importedCount++; });
        source = 'JSON';

      } else if (file.name.endsWith('.xml') || text.trim().startsWith('<?xml') || text.includes('<HealthData')) {
        // Apple Health export.xml — pull <Workout ...> records
        source = 'Apple Health export';
        const doc = new DOMParser().parseFromString(text, 'application/xml');
        Array.from(doc.getElementsByTagName('Workout')).forEach(node => {
          const start = node.getAttribute('startDate');
          const energy = parseFloat(node.getAttribute('totalEnergyBurned')) || 0;
          const duration = parseFloat(node.getAttribute('duration')) || 0;
          const d = start ? new Date(start).getTime() : NaN;
          if (isNaN(d)) return;
          const vol = energy || duration * 8; // fall back to a rough duration-based load proxy
          ACTIVE.history.workouts.push({
            dayIndex: -1, label: node.getAttribute('workoutActivityType')?.replace('HKWorkoutActivityType', '') || 'Apple Health workout', date: d,
            exercises: [{ id: 'imported', name: 'Imported activity', targetRepsMin: 0, sets: vol ? [{ reps: 1, weight: vol }] : [] }]
          });
          importedCount++;
        });

      } else {
        // Garmin Connect (or similar) CSV export — header names vary, so match loosely
        source = 'CSV';
        const lines = text.split('\n').filter(l => l.trim());
        const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
        const dateIdx = header.findIndex(h => h.includes('date'));
        const volIdx = header.findIndex(h => h.includes('volume') || h.includes('load') || h.includes('calor') || h.includes('training') || h.includes('duration') || h.includes('time'));
        lines.slice(1).forEach(line => {
          const cols = line.split(',').map(c => c.replace(/"/g, ''));
          const dateStr = dateIdx >= 0 ? cols[dateIdx] : null;
          const vol = volIdx >= 0 ? parseFloat(cols[volIdx]) : null;
          if (!dateStr) return;
          const d = new Date(dateStr).getTime();
          if (isNaN(d)) return;
          ACTIVE.history.workouts.push({
            dayIndex: -1, label: 'Imported session', date: d,
            exercises: [{ id: 'imported', name: 'Imported activity', targetRepsMin: 0, sets: vol ? [{ reps: 1, weight: vol }] : [] }]
          });
          importedCount++;
        });
      }

      saveActive();
      $('importStatus').textContent = importedCount
        ? `Imported ${importedCount} session(s) from ${source}.`
        : `Read the ${source} file but found no recognizable sessions.`;
      renderDashboard();
    } catch (err) {
      $('importStatus').textContent = 'Couldn’t read that file — try a CSV with a date column, or an Apple Health export.xml.';
    }
  };
  reader.readAsText(file);
}
function normalizeImportedSession(s) {
  const date = s.date ? new Date(s.date).getTime() : Date.now();
  const vol = s.volume || s.load || s.totalVolume || s.calories || 0;
  return { dayIndex: -1, label: s.label || 'Imported session', date, exercises: [{ id: 'imported', name: s.name || 'Imported activity', targetRepsMin: 0, sets: vol ? [{ reps: 1, weight: vol }] : [] }] };
}

/* ---------------------------------------------------------------- */
/* Profile switcher sheet                                             */
/* ---------------------------------------------------------------- */
function openSwitcher(forceSelect) {
  const wrap = $('switcherList');
  wrap.innerHTML = '';
  const profiles = Store.getProfiles();
  profiles.forEach(p => {
    const row = document.createElement('div');
    row.className = 'switcher-row' + (ACTIVE && p.id === ACTIVE.id ? ' active' : '');
    row.innerHTML = `<span class="avatar">${(p.name || '?').charAt(0).toUpperCase()}</span>
      <div><div class="swname">${p.name}</div><div class="swgoal">${p.goal}</div></div>`;
    row.addEventListener('click', () => {
      Store.setActiveId(p.id);
      ACTIVE = Store.getActiveProfile();
      $('switcherBackdrop').hidden = true;
      showView('dashboard');
      renderDashboard();
    });
    wrap.appendChild(row);
  });
  const addRow = document.createElement('button');
  addRow.className = 'btn btn-secondary btn-block';
  addRow.style.marginTop = '4px';
  addRow.textContent = '+ Add new profile';
  addRow.addEventListener('click', () => {
    $('switcherBackdrop').hidden = true;
    ONBOARD_DRAFT = Store.createBlankProfile();
    ONBOARD_STEP = 1;
    showView('onboarding');
    renderOnboardStep();
  });
  wrap.appendChild(addRow);
  $('switcherBackdrop').hidden = false;
}

/* ---------------------------------------------------------------- */
/* Wire-up                                                            */
/* ---------------------------------------------------------------- */
function init() {
  ACTIVE = Store.getActiveProfile();

  $('btnSwitchProfile').addEventListener('click', () => openSwitcher(false));
  $('btnCloseSwitcher').addEventListener('click', () => { $('switcherBackdrop').hidden = true; });
  $('switcherBackdrop').addEventListener('click', e => { if (e.target.id === 'switcherBackdrop') $('switcherBackdrop').hidden = true; });
  $('btnSettings').addEventListener('click', () => { showView('settings'); renderSettings(); });
  $('btnGoConnectFitbit').addEventListener('click', () => { showView('settings'); renderSettings(); $('fitbitClientId').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  $('btnFitbitBreakdown').addEventListener('click', askFitbitBreakdown);
  $('btnToggleTheme').addEventListener('click', toggleTheme);
  applyStoredTheme();

  $('btnStartWorkout').addEventListener('click', startWorkout);
  $('navFab').addEventListener('click', startWorkout);
  qs('[data-close-workout]').addEventListener('click', () => { skipRestTimer(); ACTIVE_WORKOUT = null; showView('dashboard'); renderDashboard(); });
  $('btnFinishWorkout').addEventListener('click', finishWorkout);
  $('btnRestSkip').addEventListener('click', skipRestTimer);
  $('btnRestAdd30').addEventListener('click', () => addRestTime(30));
  $('prToast').addEventListener('click', function () { this.hidden = true; });

  $('tileWeekPlan').addEventListener('click', toggleWeekAccordion);

  $('tileProgress').addEventListener('click', () => { showView('progress'); renderProgress(); });
  qs('[data-close-progress]').addEventListener('click', () => showView('dashboard'));
  $('btnTakePhoto').addEventListener('click', openBodyScanCamera);
  $('scanPhotoInput').addEventListener('change', e => { if (e.target.files[0]) handlePhotoSelected(e.target.files[0]); });
  Camera.wire();
  $('btnSaveScan').addEventListener('click', saveScan);
  $('btnAskAiScan').addEventListener('click', askAiAboutScan);
  $('btnComparePhotos').addEventListener('click', comparePhotosClick);
  $('btnToggleFocusOverlay').addEventListener('click', toggleFocusOverlay);
  $('btnAskTrajectory').addEventListener('click', askTrajectoryAi);

  $('tileSupplements').addEventListener('click', () => { showView('supplements'); switchFuelTab('supplements'); renderSupplements(); });
  qs('[data-close-supplements]').addEventListener('click', () => showView('dashboard'));
  qsa('#supplementFilter .chip').forEach(chip => chip.addEventListener('click', () => {
    qsa('#supplementFilter .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    renderSupplements(chip.dataset.filter);
  }));
  qsa('#fuelTabs .chip').forEach(chip => chip.addEventListener('click', () => switchFuelTab(chip.dataset.tab)));
  $('btnAiSupplements').addEventListener('click', aiSupplementsClick);
  qsa('[data-water]').forEach(btn => btn.addEventListener('click', () => addWater(Number(btn.dataset.water))));
  $('btnAddMeal').addEventListener('click', addMealFromForm);
  $('btnScanFood').addEventListener('click', openFoodScanCamera);
  $('foodPhotoInput').addEventListener('change', e => { if (e.target.files[0]) scanFoodPhoto(e.target.files[0]); });
  $('btnEstimateText').addEventListener('click', estimateTextClick);
  $('btnSuggestMeal').addEventListener('click', suggestMealClick);

  $('btnOpenGuide').addEventListener('click', () => showView('guide'));
  qs('[data-close-guide]').addEventListener('click', () => showView('settings'));

  $('btnAddCustomEx').addEventListener('click', addCustomExercise);

  $('btnFitbitConnect').addEventListener('click', () => { Fitbit.setClientId($('fitbitClientId').value.trim()); Fitbit.connect(); });
  $('fitbitClientId').addEventListener('change', e => Fitbit.setClientId(e.target.value.trim()));
  $('btnFitbitSync').addEventListener('click', fitbitSyncClick);
  $('btnFitbitDisconnect').addEventListener('click', async () => { $('fitbitStatus').textContent = 'Disconnecting…'; await Fitbit.disconnect(); renderFitbitPanel(); });

  qs('[data-close-chat]').addEventListener('click', () => showView('dashboard'));
  $('btnChatSend').addEventListener('click', sendChat);
  $('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

  qs('[data-close-settings]').addEventListener('click', () => showView('dashboard'));
  $('btnSyncSignIn').addEventListener('click', syncSignInClick);
  $('btnSyncSignOut').addEventListener('click', syncSignOutClick);
  $('btnSyncNow').addEventListener('click', syncNowClick);
  wireUnitToggle('settingsUnitWeight', unit => { ACTIVE.unitWeight = unit; saveActive(); renderDashboard(); });
  $('btnAddProfile').addEventListener('click', () => {
    ONBOARD_DRAFT = Store.createBlankProfile();
    ONBOARD_STEP = 1;
    showView('onboarding');
    renderOnboardStep();
  });
  $('btnExportData').addEventListener('click', exportData);
  $('importDataInput').addEventListener('change', e => { if (e.target.files[0]) importData(e.target.files[0]); });
  const dz = $('importDropzone');
  dz.addEventListener('click', () => $('importDataInput').click());
  ['dragover', 'dragenter'].forEach(evt => dz.addEventListener(evt, e => { e.preventDefault(); dz.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(evt => dz.addEventListener(evt, e => { e.preventDefault(); dz.classList.remove('dragover'); }));
  dz.addEventListener('drop', e => { if (e.dataTransfer.files[0]) importData(e.dataTransfer.files[0]); });
  $('btnResetProfile').addEventListener('click', () => {
    if (confirm('Reset all workouts, check-ins, and chats for this profile? Your profile settings stay.')) {
      ACTIVE.history = { workouts: [], checkins: [], chats: [] };
      saveActive();
      renderDashboard(); renderSettings();
    }
  });

  qsa('.navbtn').forEach(btn => btn.addEventListener('click', () => {
    const target = btn.dataset.nav;
    showView(target);
    if (target === 'progress') renderProgress();
    if (target === 'supplements') renderSupplements();
    if (target === 'chat') renderChat();
  }));

  if (ACTIVE) {
    showView('dashboard');
    renderDashboard();
  } else {
    initOnboarding();
    showView('onboarding');
  }

  // If we just landed back here from Fitbit's OAuth redirect, finish the
  // flow and drop the user in Settings so they see "Connected."
  Fitbit.handleRedirectIfPresent().then(connected => {
    if (connected && ACTIVE) { showView('settings'); renderSettings(); }
  });

  // Already signed in from a previous visit (token persists in
  // localStorage) — quietly pull whatever's newer from the cloud, e.g. a
  // session logged on the other person's device or another phone.
  if (Sync.isLoggedIn()) {
    Sync.pull().then(res => {
      if (res.applied) { ACTIVE = Store.getActiveProfile(); renderDashboard(); }
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
