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
  if (!localStorage.getItem(TOUR_DONE_KEY)) startTour();
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

  renderFitbitBanner();
  renderDailyInsight();
  renderReadiness();
  renderHousehold();
  renderFitbitToday();
  silentFitbitAutoSync();
}

/* ---------------------------------------------------------------- */
/* Fitbit (via Google Health) — Home cards                           */
/* ---------------------------------------------------------------- */
const FITBIT_BANNER_DISMISSED_KEY = 'bedrock_fitbit_banner_dismissed';

// Not connected: an easy-to-swipe-away invite, not a permanent nag. Once
// dismissed it stays gone (Settings has a "show it again" link, same
// reversible pattern as excluded exercises).
function renderFitbitBanner() {
  const banner = $('fitbitBanner');
  const dismissed = localStorage.getItem(FITBIT_BANNER_DISMISSED_KEY) === '1';
  banner.hidden = Fitbit.isConnected() || dismissed;
  banner.style.transform = '';
  banner.style.opacity = '';
}
function dismissFitbitBanner() {
  localStorage.setItem(FITBIT_BANNER_DISMISSED_KEY, '1');
  $('fitbitBanner').hidden = true;
}
function wireFitbitBannerSwipe() {
  const banner = $('fitbitBanner');
  let startX = null;
  banner.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
  banner.addEventListener('touchmove', e => {
    if (startX == null) return;
    const dx = e.touches[0].clientX - startX;
    banner.style.transform = `translateX(${dx}px)`;
    banner.style.opacity = String(Math.max(0.15, 1 - Math.abs(dx) / 200));
  }, { passive: true });
  banner.addEventListener('touchend', e => {
    if (startX == null) return;
    const dx = e.changedTouches[0].clientX - startX;
    startX = null;
    if (Math.abs(dx) > 110) dismissFitbitBanner();
    else { banner.style.transform = ''; banner.style.opacity = ''; }
  });
}

// Live-ish Fitbit numbers for today — a lightweight GET, safe to refresh on
// every Home render. Only shows tiles for whatever the backend actually
// returned (some fields are best-effort against a very new API — see
// cloudflare-worker/src/index.js's handleGoogleHealthToday note — so an
// unavailable stat just doesn't render a tile instead of showing a dash).
let FITBIT_TODAY = null;
async function renderFitbitToday() {
  const card = $('fitbitTodayCard');
  if (!Fitbit.isConnected()) { card.hidden = true; return; }
  const res = await Fitbit.fetchTodaySummary();
  if (!res.ok) { card.hidden = true; return; }
  FITBIT_TODAY = res;
  card.hidden = false;
  const stat = (icon, val, label) => val == null ? '' : `
    <div style="min-width:72px; flex:1;">
      <span class="ms" style="font-size:19px; opacity:0.55;">${icon}</span>
      <div style="font-size:19px; font-weight:600; margin-top:4px;">${val}</div>
      <div style="font-size:10px; letter-spacing:.05em; text-transform:uppercase; opacity:0.45; margin-top:1px;">${label}</div>
    </div>`;
  $('fitbitTodayStats').innerHTML = [
    stat('directions_walk', res.steps != null ? res.steps.toLocaleString() : null, 'Steps'),
    stat('favorite', res.restingHeartRate, 'Resting HR'),
    stat('local_fire_department', res.caloriesOut != null ? res.caloriesOut.toLocaleString() : null, 'Calories'),
    stat('bolt', res.activeMinutes, 'Active min'),
    stat('bedtime', res.sleepHours, 'Sleep (hr)'),
    stat('monitor_heart', res.hrv, 'HRV'),
    stat('water_drop', res.spo2Pct, 'SpO2 %'),
    stat('distance', res.distanceKm, 'Distance (km)'),
  ].filter(Boolean).join('');
  $('fitbitTodayNote').textContent = 'Numbers update as your Fitbit syncs through the day — this isn’t a continuous live stream (that needs Google Health’s separate intraday approval), just the latest synced totals. Some stats (active minutes, sleep, HRV, SpO2) depend on what your specific Fitbit model tracks. ⌚ from your Fitbit';
  loadFitbitBreakdown(false);
  recordFitbitDailySnapshot(res);
}

// One row per calendar day (upserted, not appended) so the trend chart in
// Progress has real history to draw — this is what makes "today"'s numbers
// into an actual trend instead of a single floating stat.
function recordFitbitDailySnapshot(today) {
  const day = new Date().toDateString();
  ACTIVE.history.fitbitDaily = ACTIVE.history.fitbitDaily || [];
  const existing = ACTIVE.history.fitbitDaily.find(d => d.day === day);
  const snapshot = { day, date: Date.now(), steps: today.steps, restingHeartRate: today.restingHeartRate, caloriesOut: today.caloriesOut, distanceKm: today.distanceKm, activeMinutes: today.activeMinutes, hrv: today.hrv };
  if (existing) Object.assign(existing, snapshot);
  else ACTIVE.history.fitbitDaily.push(snapshot);
  saveActive();
}

function fitbitBreakdownCacheKey() { return `bedrock_fitbit_breakdown_${ACTIVE.id}_${new Date().toDateString()}`; }

function buildFitbitBreakdownMessage() {
  if (!FITBIT_TODAY) return null;
  const t = FITBIT_TODAY;
  const parts = [`Steps ${t.steps ?? '—'}`, `resting HR ${t.restingHeartRate ?? '—'} bpm`, `${t.caloriesOut ?? '—'} calories out`];
  if (t.activeMinutes != null) parts.push(`${t.activeMinutes} active min`);
  if (t.sleepHours != null) parts.push(`${t.sleepHours}h sleep`);
  if (t.hrv != null) parts.push(`HRV ${t.hrv}`);
  if (t.spo2Pct != null) parts.push(`SpO2 ${t.spo2Pct}%`);
  const wearable = Fitbit.recentWearableSummary(ACTIVE);
  let msg = `Today: ${parts.join(', ')}.`;
  if (wearable) msg += `\nLast ${wearable.days} days (from logged Fitbit exercises): ${wearable.count} activities, ~${wearable.totalSteps} total steps${wearable.avgHr ? `, avg heart rate ~${wearable.avgHr} bpm` : ''}${wearable.totalDistanceKm ? `, ~${wearable.totalDistanceKm} km` : ''}.`;
  return msg;
}

// Auto-populates once a day (cached, same pattern as Insights.getDailyInsight)
// so a live-feeling breakdown is just already there when Home opens — no tap
// required. `force` bypasses the cache for the manual "Refresh" button.
async function loadFitbitBreakdown(force) {
  const key = fitbitBreakdownCacheKey();
  if (!force) {
    const cached = localStorage.getItem(key);
    if (cached) { $('fitbitBreakdownResult').hidden = false; $('fitbitBreakdownResult').textContent = cached; return; }
  }
  if (!Sync.isLoggedIn()) return; // no account signed in — leave it unpopulated rather than erroring
  const msg = buildFitbitBreakdownMessage();
  if (!msg) return;
  $('fitbitBreakdownResult').hidden = false;
  $('fitbitBreakdownResult').textContent = 'Thinking…';
  const sys = BEDROCK_PERSONA + ' You will get today’s Fitbit numbers plus recent trend data. In 2 plain sentences: how today compares to the recent trend, and whether it changes anything about training or recovery today. Resting heart rate trending up over days can flag under-recovery — mention that ONLY if the data actually suggests it. No preamble. Not medical advice.';
  const res = await BedrockAPI.chat([{ role: 'user', content: msg }], sys);
  if (res.ok) { $('fitbitBreakdownResult').textContent = res.text; localStorage.setItem(key, res.text); }
  else $('fitbitBreakdownResult').textContent = 'Couldn’t reach Bedrock — check you’re signed in under Settings → Sync.';
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
    sets: ex.sets.map(() => ({ reps: suggested ? String(ex.targetRepsMin) : '', weight: suggested ? String(suggested) : '', done: false }))
  };
  renderWorkoutList();
  renderWorkoutMeta();
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
          weight: suggested ? String(suggested) : '',
          done: false
        }))
      };
    })
  };
  $('workoutTitle').textContent = session.label;
  // The prescription, stated up front: rep range, rest, and the intensity
  // cue for this goal — the "how hard should this feel" that separates a
  // programmed session from just moving weights around.
  const scheme = Workout.schemeFor(ACTIVE.goal, ACTIVE.exp);
  $('workoutScheme').textContent = `Target ${scheme.sets} × ${scheme.reps} per exercise · rest ${scheme.rest} · ${scheme.note}`;
  renderWorkoutMeta();
  renderWorkoutList();
  showView('workout');
}

// Standard ramp-up warm-up for meaningful working weights: ~50% × 8 then
// ~75% × 3 primes the pattern without eating into working-set capacity.
// Skipped for light loads where "the first set is the warm-up" is fine.
function warmupHint(workingWeight) {
  if (!workingWeight || workingWeight < 60) return '';
  const r5 = w => Math.max(5, Math.round(w / 5) * 5);
  return `Warm-up first: ~${r5(workingWeight * 0.5)} lb × 8, then ~${r5(workingWeight * 0.75)} lb × 3.`;
}

// Plate math for barbell lifts: what to slide on each side of a 45 lb bar
// to hit the suggested weight — the mental arithmetic everyone does at the
// rack, done for you. Standard plate denominations, greedy fill.
function plateHint(targetWeight) {
  const BAR = 45;
  if (!targetWeight || targetWeight <= BAR + 2.5) return '';
  let perSide = (targetWeight - BAR) / 2;
  const plates = [];
  [45, 35, 25, 10, 5, 2.5].forEach(p => { while (perSide >= p - 0.01) { plates.push(p); perSide -= p; } });
  if (!plates.length) return '';
  return ` Bar math: 45 lb bar + ${plates.join(' + ')} per side.`;
}

function renderWorkoutMeta() {
  if (!ACTIVE_WORKOUT) return;
  const totalSets = ACTIVE_WORKOUT.exercises.reduce((a, ex) => a + ex.sets.length, 0);
  const doneSets = ACTIVE_WORKOUT.exercises.reduce((a, ex) => a + ex.sets.filter(s => s.done).length, 0);
  $('workoutMeta').textContent = `${ACTIVE_WORKOUT.exercises.length} exercises · ${doneSets}/${totalSets} sets done`;
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
      <div class="exercise-meta">${suggested ? `Last time you handled ~${suggested} lb for target reps — pre-filled below, adjust if needed. ${warmupHint(suggested)}${exDef && exDef.type === 'barbell' ? plateHint(suggested) : ''}` : 'No history yet — pick a weight you can control for the full rep range, leaving 1-3 reps in the tank.'}</div>
      ${lastLogged ? `<button class="form-toggle" data-repeatlast="${exIdx}" style="color:var(--accent-text);">↺ Same as last time</button>` : ''}
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
      ex.sets = lastLogged.sets.map(s => ({ reps: String(s.reps), weight: String(s.weight), done: false }));
      renderSetRows(exIdx);
      renderWorkoutMeta();
    });
    const formToggle = item.querySelector('[data-formtoggle]');
    if (formToggle) formToggle.addEventListener('click', () => {
      const cueEl = item.querySelector('[data-formcue]');
      cueEl.hidden = !cueEl.hidden;
      formToggle.textContent = cueEl.hidden ? 'Show proper form ▾' : 'Hide proper form ▴';
    });
    renderSetRows(exIdx);
    item.querySelector('.add-set-btn').addEventListener('click', () => {
      ACTIVE_WORKOUT.exercises[exIdx].sets.push({ reps: '', weight: '', done: false });
      renderSetRows(exIdx);
      renderWorkoutMeta();
    });
  });
}

function renderSetRows(exIdx) {
  const wrap = qs(`.setRows[data-ex="${exIdx}"]`);
  const ex = ACTIVE_WORKOUT.exercises[exIdx];
  wrap.innerHTML = '';
  ex.sets.forEach((s, sIdx) => {
    const row = document.createElement('div');
    row.className = 'set-row' + (s.done ? ' set-done' : '');
    row.innerHTML = `
      <span>#${sIdx + 1}</span>
      <input type="number" inputmode="decimal" placeholder="lb" value="${s.weight}" data-field="weight">
      <input type="number" inputmode="numeric" placeholder="reps" value="${s.reps}" data-field="reps">
      <button class="set-check${s.done ? ' checked' : ''}" aria-label="Mark set ${sIdx + 1} done" aria-pressed="${s.done}"><span class="ms">check</span></button>
    `;
    row.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', () => {
        ex.sets[sIdx][inp.dataset.field] = inp.value;
      });
    });
    // Explicit ✓ per set: only checked sets count as performed, and the rest
    // timer starts on the tap. The old behavior (any pre-filled set counted,
    // and the timer fired just from focusing in and out of a field) meant a
    // whole untouched workout could get "logged" by tapping Finish.
    row.querySelector('.set-check').addEventListener('click', () => {
      if (!s.done && (s.weight === '' || s.reps === '')) { showToast('Fill in weight and reps first.'); return; }
      s.done = !s.done;
      row.classList.toggle('set-done', s.done);
      row.querySelector('.set-check').classList.toggle('checked', s.done);
      row.querySelector('.set-check').setAttribute('aria-pressed', String(s.done));
      renderWorkoutMeta();
      if (s.done) startRestTimer(Workout.restSecondsFor(ACTIVE.goal));
      else skipRestTimer();
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

/* ---------------------------------------------------------------- */
/* First-run guided tour — five plain-language cards, one per tab.    */
/* Shows once per device (skippable, never nags again).               */
/* ---------------------------------------------------------------- */
const TOUR_DONE_KEY = 'bedrock_tour_done';
const TOUR_STEPS = [
  { icon: '🏠', title: 'Home', copy: 'Your workout for today lives here, already built for your goal. Tap the big orange play button to start it — that\'s the whole job.' },
  { icon: '📈', title: 'Progress', copy: 'Photos, weight, measurements, and charts. Log a quick check-in whenever you want — Bedrock turns it into trends automatically.' },
  { icon: '🍎', title: 'Fuel', copy: 'Food and water. Snap a photo of your plate and Bedrock counts the calories and macros — you just check its work and tap Log.' },
  { icon: '💬', title: 'Ask', copy: 'A coach that can actually see your numbers. Ask anything — "am I on track?", "what should I eat tonight?" — and it answers from YOUR data.' },
  { icon: '👥', title: 'Two people, one app', copy: 'Tap your avatar (top-left) to add or switch to your partner\'s profile. Separate plans, separate logs, one app.' }
];
let TOUR_STEP = 0;

function startTour() {
  TOUR_STEP = 0;
  renderTourStep();
  $('tourOverlay').hidden = false;
}
function renderTourStep() {
  const step = TOUR_STEPS[TOUR_STEP];
  $('tourIcon').textContent = step.icon;
  $('tourTitle').textContent = step.title;
  $('tourCopy').textContent = step.copy;
  $('tourDots').innerHTML = TOUR_STEPS.map((_, i) => `<span class="tour-dot${i === TOUR_STEP ? ' active' : ''}"></span>`).join('');
  $('btnTourNext').textContent = TOUR_STEP === TOUR_STEPS.length - 1 ? 'Let\'s go 💪' : 'Next';
  $('btnTourSkip').hidden = TOUR_STEP === TOUR_STEPS.length - 1;
}
function endTour() {
  $('tourOverlay').hidden = true;
  localStorage.setItem(TOUR_DONE_KEY, '1');
}
function tourNext() {
  if (TOUR_STEP >= TOUR_STEPS.length - 1) { endTour(); return; }
  TOUR_STEP++;
  renderTourStep();
}

// Small non-blocking notice, reusing the PR toast chrome — alert() freezes
// the whole page and looks like a system error; this doesn't.
function showToast(text, ms = 3200) {
  const toast = $('prToast');
  if (!toast) return;
  toast.innerHTML = `<p>${text}</p>`;
  toast.hidden = false;
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => { toast.hidden = true; }, ms);
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
  const anyDone = ACTIVE_WORKOUT.exercises.some(ex => ex.sets.some(s => s.done));
  // Only ✓-checked sets are saved — pre-filled suggestions the user never
  // touched must not become history (they'd fake PRs and volume). If nothing
  // was checked at all, offer the old behavior once rather than losing work.
  if (!anyDone) {
    const anyFilled = ACTIVE_WORKOUT.exercises.some(ex => ex.sets.some(s => s.reps !== '' && s.weight !== ''));
    if (!anyFilled) { showToast('Nothing logged yet — check off a set first.'); return; }
    if (!confirm('No sets are checked off (✓). Save all filled-in sets as done?')) return;
    ACTIVE_WORKOUT.exercises.forEach(ex => ex.sets.forEach(s => { if (s.reps !== '' && s.weight !== '') s.done = true; }));
  }
  skipRestTimer();
  const cleaned = {
    ...ACTIVE_WORKOUT,
    durationMin: Math.max(1, Math.round((Date.now() - ACTIVE_WORKOUT.date) / 60000)),
    exercises: ACTIVE_WORKOUT.exercises.map(ex => ({
      ...ex,
      sets: ex.sets.filter(s => s.done && s.reps !== '' && s.weight !== '').map(s => ({ reps: s.reps, weight: s.weight }))
    })).filter(ex => ex.sets.length)
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

  renderProgressStatTiles();
  drawWeightChart();
  drawVolumeChart();
  drawMuscleChart();
  drawExerciseChart();
  renderScanHistory();
  renderMeasurementTrends();
  renderPhotoHistory();
  renderTrajectoryStats();
  drawFitbitTrendChart();
  renderPastWorkouts();
}

// Four headline numbers, all straight from logs — the "how am I actually
// doing" answer before any scrolling: weight + 28-day change, week streak,
// recent session count, and the top PR.
function renderProgressStatTiles() {
  const wrap = $('progressStatTiles');
  const checkins = (ACTIVE.history.checkins || []).filter(c => c.weight != null).sort((a, b) => a.date - b.date);
  const latestW = checkins.length ? checkins[checkins.length - 1].weight : null;
  const cutoff = Date.now() - 28 * 24 * 3600 * 1000;
  const monthAgo = checkins.filter(c => c.date <= cutoff);
  const baseline = monthAgo.length ? monthAgo[monthAgo.length - 1].weight : (checkins.length > 1 ? checkins[0].weight : null);
  const delta = latestW != null && baseline != null ? Math.round((latestW - baseline) * 10) / 10 : null;
  const streak = Insights.workoutStreak(ACTIVE);
  const sessions28 = (ACTIVE.history.workouts || []).filter(w => w.date >= cutoff).length;
  const prs = Object.values(Insights.exercisePRs(ACTIVE)).sort((a, b) => b.weight - a.weight);
  const topPr = prs[0];
  const tile = (val, label, sub) => `<div class="stat-tile"><div class="stat-tile-val">${val}</div><div class="stat-tile-label">${label}</div>${sub ? `<div class="stat-tile-sub">${sub}</div>` : ''}</div>`;
  wrap.innerHTML =
    tile(latestW != null ? displayWeight(latestW) : '—', 'weight', delta != null ? `${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${displayWeight(Math.abs(delta))} / 4wk` : 'log check-ins') +
    tile(streak, `week streak${streak === 1 ? '' : 's'}`, streak >= 2 ? 'keep it alive 🔥' : '') +
    tile(sessions28, 'sessions / 28d', `${ACTIVE.days || 3}/wk planned`) +
    tile(topPr ? `${topPr.weight} lb` : '—', 'best lift', topPr ? topPr.name : 'no PRs yet');
}

// First→latest delta per tape measurement — the recomposition signal the
// scale hides. Only fields with 2+ logged values appear; card hides if none.
function renderMeasurementTrends() {
  const fields = [['waist', 'Waist'], ['chest', 'Chest'], ['arm', 'Arm'], ['hips', 'Hips / glutes'], ['thigh', 'Thigh']];
  const rows = fields.map(([field, label]) => {
    const list = (ACTIVE.history.checkins || []).filter(c => c[field] != null && c[field] !== '').sort((a, b) => a.date - b.date);
    if (list.length < 2) return null;
    const first = Number(list[0][field]), last = Number(list[list.length - 1][field]);
    const d = Math.round((last - first) * 10) / 10;
    const arrow = d > 0 ? '↑' : d < 0 ? '↓' : '→';
    return `<div class="scan-history-row"><span>${label}</span><span>${first} → ${last} in <b>${arrow} ${d > 0 ? '+' : ''}${d}</b></span></div>`;
  }).filter(Boolean);
  $('measurementTrendCard').hidden = !rows.length;
  if (rows.length) $('measurementTrends').innerHTML = rows.join('');
}

// Every check-in photo you've ever taken was already being saved
// (profile.history.checkins[].photo) — it just had no browsable UI, only
// the single latest photo ever showed up anywhere. This is that history:
// a tap-to-view strip, oldest logic untouched, purely additive.
function renderPhotoHistory() {
  const card = $('photoHistoryCard');
  const strip = $('photoHistoryStrip');
  const withPhotos = (ACTIVE.history.checkins || []).filter(c => c.photo).slice().reverse();
  if (!withPhotos.length) { card.hidden = true; return; }
  card.hidden = false;
  strip.innerHTML = '';
  withPhotos.forEach(c => {
    const img = document.createElement('img');
    img.className = 'photo-history-thumb';
    img.src = c.photo;
    img.alt = `Check-in from ${new Date(c.date).toLocaleDateString()}`;
    img.addEventListener('click', () => openPhotoLightbox(c));
    strip.appendChild(img);
  });
}

function openPhotoLightbox(checkin) {
  $('photoLightboxImg').src = checkin.photo;
  const parts = [new Date(checkin.date).toLocaleDateString()];
  if (checkin.weight != null) parts.push(displayWeight(checkin.weight));
  $('photoLightboxCaption').textContent = parts.join(' · ');
  $('photoLightbox').hidden = false;
}

// Steps over the last two weeks — built from the daily snapshots
// recordFitbitDailySnapshot() saves each time Home fetches "today". Needs
// at least 2 days of history to draw a real line, same pattern as the
// weight-trend chart. Resting heart rate isn't plotted alongside it (its
// 50-100bpm range would look flat next to a thousands-of-steps y-axis on a
// shared scale) — it gets a first-vs-latest read in the caption instead.
function drawFitbitTrendChart() {
  const card = $('fitbitTrendCard');
  const daily = (ACTIVE.history.fitbitDaily || []).slice().sort((a, b) => a.date - b.date).slice(-14);
  if (!Fitbit.isConnected() || daily.length < 2) { card.hidden = true; return; }
  card.hidden = false;
  const stepsPts = daily.map(d => ({ x: d.date, y: d.steps }));
  MiniChart.draw($('fitbitTrendChart'), [{ points: stepsPts }]);

  const lastSteps = daily[daily.length - 1].steps;
  const hrReadings = daily.filter(d => d.restingHeartRate != null);
  let hrNote = '';
  if (hrReadings.length >= 2) {
    const diff = hrReadings[hrReadings.length - 1].restingHeartRate - hrReadings[0].restingHeartRate;
    hrNote = diff === 0 ? ' Resting HR steady.' : ` Resting HR ${diff > 0 ? 'up' : 'down'} ${Math.abs(diff)} bpm over that window.`;
  }
  $('fitbitTrendCaption').textContent = `Steps over the last ${daily.length} day${daily.length === 1 ? '' : 's'} synced.${lastSteps != null ? ` Latest: ${lastSteps.toLocaleString()}.` : ''}${hrNote}`;
}

// A plain, browsable log of recent sessions — not another aggregate stat,
// just "what did I actually do." Fitbit-sourced sessions (source:'fitbit')
// show a wearable badge; logged-by-hand sessions show total volume instead
// since Fitbit entries don't carry set/rep data the same way.
function renderPastWorkouts() {
  const wrap = $('pastWorkoutsList');
  wrap.innerHTML = '';
  const list = (ACTIVE.history.workouts || []).slice().sort((a, b) => b.date - a.date).slice(0, 15);
  if (!list.length) { wrap.innerHTML = '<p class="muted-copy">No sessions logged yet.</p>'; return; }
  list.forEach(w => {
    const d = new Date(w.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const vol = (w.exercises || []).reduce((a, ex) => a + (ex.sets || []).reduce((b, s) => b + (Number(s.weight) || 0) * (Number(s.reps) || 0), 0), 0);
    const detail = w.source === 'fitbit' ? '⌚ Fitbit' : (vol ? `${Math.round(vol).toLocaleString()} lb·reps` : `${(w.exercises || []).length} exercise${(w.exercises || []).length === 1 ? '' : 's'}`);
    const item = document.createElement('div');
    item.className = 'past-workout';
    item.innerHTML = `
      <button class="scan-history-row past-workout-summary" aria-expanded="false">
        <span>${d} — ${w.label || 'Session'}</span><span>${detail} <span class="ms past-workout-caret">expand_more</span></span>
      </button>
      <div class="past-workout-detail" hidden></div>`;
    const summaryBtn = item.querySelector('.past-workout-summary');
    const detailEl = item.querySelector('.past-workout-detail');
    summaryBtn.addEventListener('click', () => {
      const opening = detailEl.hidden;
      // Built lazily on first open — most rows never get expanded.
      if (opening && !detailEl.dataset.built) {
        const lines = (w.exercises || []).map(ex => {
          const sets = (ex.sets || []).map(s => `${displayWeight(Number(s.weight))} × ${s.reps}`).join(', ');
          return `<div class="past-workout-ex"><span>${ex.name}</span><span>${sets || '—'}</span></div>`;
        }).join('') || '<p class="muted-copy">No set detail on this session.</p>';
        const durLine = w.durationMin ? `<p class="muted-copy" style="margin:6px 0 0;">⏱ ${w.durationMin} min session</p>` : '';
        detailEl.innerHTML = lines + durLine + `<button class="btn btn-ghost btn-block danger" style="margin-top:6px;">Delete this session</button>`;
        detailEl.querySelector('.danger').addEventListener('click', () => {
          if (!confirm(`Delete the ${d} session? This removes it from your charts and PRs too.`)) return;
          ACTIVE.history.workouts = (ACTIVE.history.workouts || []).filter(x => x !== w && x.date !== w.date);
          saveActive();
          renderProgress();
          showToast('Session deleted.');
        });
        detailEl.dataset.built = '1';
      }
      detailEl.hidden = !opening;
      summaryBtn.setAttribute('aria-expanded', String(opening));
      item.classList.toggle('open', opening);
    });
    wrap.appendChild(item);
  });
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
  let caption = Insights.trendCaption(series, unit);
  // Epley estimated 1RM (w × (1 + reps/30)) from the best logged set — the
  // standard strength-app metric for comparing progress across rep ranges.
  const pr = Insights.exercisePRs(ACTIVE)[chosen];
  if (pr && pr.weight && pr.reps > 1) {
    const e1rm = Math.round(pr.weight * (1 + pr.reps / 30));
    caption += ` Estimated 1RM: ~${displayWeight(e1rm)} (from your best set, ${pr.weight} lb × ${pr.reps} — Epley formula, an estimate not a test).`;
  }
  $('exerciseCaption').textContent = caption;
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

  const n = (ACTIVE.history.workouts || []).length;
  const stage = n < 4 ? 'Early data — estimates are rough, mostly based on research norms for your experience level.'
    : n < 15 ? 'Building a real picture — projections are starting to lean on your own numbers.'
    : 'Well-established data — projections here are driven mostly by your actual trend, not just averages.';
  $('dataMaturityNote').textContent = `${n} session${n === 1 ? '' : 's'} logged. ${stage}`;

  loadTrajectoryAi();
}

// Auto-populates once a day (cached, same pattern as the daily insight) — no
// button needed for a passive readout of data already on screen.
async function loadTrajectoryAi() {
  if (!Sync.isLoggedIn()) { $('trajectoryAiResult').hidden = true; return; }
  const key = `bedrock_trajectory_ai_${ACTIVE.id}_${new Date().toDateString()}`;
  const cached = localStorage.getItem(key);
  if (cached) { $('trajectoryAiResult').hidden = false; $('trajectoryAiResult').textContent = cached; return; }
  const proj = Trajectory.project(ACTIVE);
  const sys = BEDROCK_PERSONA + ' You will be given a structured data summary. In 2 plain sentences: a realistic, non-medical read on the trend, and ONE concrete suggestion. Be honest if the data is too sparse to say much yet. No preamble.';
  const msg = Insights.summaryText(ACTIVE) + `\nProjected ${proj.weeksAhead}-week weight change range: ${proj.lowRange} to ${proj.highRange} lb.`;
  $('trajectoryAiResult').hidden = false;
  $('trajectoryAiResult').textContent = 'Thinking…';
  const res = await BedrockAPI.chat([{ role: 'user', content: msg }], sys);
  if (res.ok) { $('trajectoryAiResult').textContent = res.text; localStorage.setItem(key, res.text); }
  else $('trajectoryAiResult').hidden = true;
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
  const sys = BEDROCK_PERSONA + ' Give general, non-medical feedback on this standing progress photo: posture, symmetry, and whether the shot is consistent for future comparisons (angle, lighting, distance). Do NOT estimate body fat percentage, diagnose anything, or make medical claims. 2 sentences max, no preamble.';
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
  const sys = BEDROCK_PERSONA + ' You will see two standing progress photos, oldest first. Give a brief, honest, directional impression of visible change (e.g. posture, general visible tone/fullness) — 2 sentences max, no preamble. Do NOT estimate a body fat percentage or give a medical/diagnostic read; you are not a validated body-composition tool, just giving a casual visual impression. If the photos are too inconsistent (angle/distance/lighting) to compare fairly, say so.';
  const res = await BedrockAPI.ask({
    system: sys, maxTokens: 150,
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
// Maps the profile's training goal onto supplement goal tags so "good for
// your goal" is computed, not hand-waved. fatloss→fatloss, muscle→muscle,
// strength→muscle+performance, general→health.
function goalTagsFor(profileGoal) {
  return {
    muscle: ['muscle'], fatloss: ['fatloss'],
    strength: ['muscle', 'performance'], general: ['health']
  }[profileGoal] || ['health'];
}

function toggleStack(suppId) {
  ACTIVE.supplementStack = ACTIVE.supplementStack || [];
  const idx = ACTIVE.supplementStack.indexOf(suppId);
  if (idx === -1) ACTIVE.supplementStack.push(suppId); else ACTIVE.supplementStack.splice(idx, 1);
  saveActive();
  renderMyStack();
  renderSupplements(qs('#supplementFilter .chip.active')?.dataset.filter || 'all');
}

// The user's own checklist, pinned above the reference list: name + the one
// number that matters daily (dose), so "did I take it?" needs zero scrolling.
function renderMyStack() {
  const card = $('myStackCard');
  const stack = (ACTIVE.supplementStack || []).map(id => SupplementList.find(s => s.id === id)).filter(Boolean);
  card.hidden = !stack.length;
  if (!stack.length) return;
  // Short dose line: first clause only (split on sentence/semicolon
  // boundaries, not bare "." — doses like "1.6-2.2 g" contain decimals),
  // parentheticals dropped.
  const shortDose = d => d.split(';')[0].split(/\.\s/)[0].replace(/\s*\([^)]*\)/g, '').trim();
  $('myStackList').innerHTML = stack.map(s =>
    `<div class="scan-history-row"><span>${s.name}</span><span class="meal-row-right">${shortDose(s.dose)}<button class="meal-remove" data-unstack="${s.id}" aria-label="Remove ${s.name} from stack">✕</button></span></div>`
  ).join('');
  $('myStackList').querySelectorAll('[data-unstack]').forEach(btn =>
    btn.addEventListener('click', () => toggleStack(btn.dataset.unstack)));
}

function renderSupplements(filter = 'all') {
  const wrap = $('supplementList');
  wrap.innerHTML = '';
  renderMyStack();
  const myGoalTags = goalTagsFor(ACTIVE.goal);
  const evRank = { strong: 0, moderate: 1, limited: 2 };
  // Sorted for THIS user: goal-relevant first, then by evidence strength —
  // the strongest option for your actual goal is always the first card.
  const list = SupplementList
    .filter(s => filter === 'all' || s.goals.includes(filter))
    .slice()
    .sort((a, b) => {
      const aFit = a.goals.some(g => myGoalTags.includes(g)) ? 0 : 1;
      const bFit = b.goals.some(g => myGoalTags.includes(g)) ? 0 : 1;
      return (aFit - bFit) || (evRank[a.evidence] - evRank[b.evidence]);
    });
  list.forEach(s => {
    const card = document.createElement('div');
    card.className = 'supplement-card';
    const evClass = 'evidence-' + s.evidence;
    const evLabel = { strong: 'Strong evidence', moderate: 'Moderate evidence', limited: 'Limited evidence' }[s.evidence];
    const forYou = s.goals.some(g => myGoalTags.includes(g));
    const inStack = (ACTIVE.supplementStack || []).includes(s.id);
    card.innerHTML = `
      <button class="supp-head" aria-expanded="false">
        <div class="supp-head-main">
          <h4>${s.name}</h4>
          <div class="supp-tags">
            <span class="evidence-tag ${evClass}">${evLabel}</span>
            ${forYou ? '<span class="evidence-tag supp-goal-tag">fits your goal</span>' : ''}
          </div>
        </div>
        <span class="ms supp-caret">expand_more</span>
      </button>
      <p class="supp-detail supp-what">${s.what}</p>
      <div class="supp-body" hidden>
        <p class="supp-detail"><b>Typical dose:</b> ${s.dose}</p>
        <p class="supp-detail"><b>Timing:</b> ${s.timing}</p>
        <p class="supp-detail"><b>Caution:</b> ${s.caution}</p>
        <button class="btn ${inStack ? 'btn-ghost' : 'btn-secondary'} btn-block supp-stack-btn">${inStack ? '✓ In my stack — remove' : '+ Add to my stack'}</button>
      </div>`;
    const head = card.querySelector('.supp-head');
    head.addEventListener('click', () => {
      const body = card.querySelector('.supp-body');
      const opening = body.hidden;
      body.hidden = !opening;
      head.setAttribute('aria-expanded', String(opening));
      card.classList.toggle('open', opening);
    });
    card.querySelector('.supp-stack-btn').addEventListener('click', () => toggleStack(s.id));
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

// One macro progress bar: label, logged vs target, fill %. Overshooting
// calories flips the bar to the danger tint on a cut (where it matters) but
// stays neutral otherwise — over-target protein is never painted as a problem.
function macroBarHTML(label, logged, target, unit, opts = {}) {
  const pct = target > 0 ? Math.min(100, Math.round(logged / target * 100)) : 0;
  const over = target > 0 && logged > target;
  const cls = over && opts.warnOnOver ? ' over' : (over ? ' met' : '');
  const remaining = target - logged;
  const detail = target > 0
    ? (remaining >= 0 ? `${Math.round(remaining)}${unit} left` : (opts.warnOnOver ? `${Math.abs(Math.round(remaining))}${unit} over` : 'target met ✓'))
    : '';
  return `
    <div class="macro-bar">
      <div class="macro-bar-label"><span>${label}</span><span>${Math.round(logged)} / ${Math.round(target)}${unit}${detail ? ` · <b>${detail}</b>` : ''}</span></div>
      <div class="macro-bar-track"><div class="macro-bar-fill${cls}" style="width:${pct}%"></div></div>
    </div>`;
}

function renderNutrition() {
  const target = Nutrition.dailyTarget(ACTIVE);
  $('nutritionTargets').innerHTML = target ? `
    <div class="target-hero"><span class="target-hero-num">${target.calories.toLocaleString()}</span><span class="target-hero-unit">kcal / day</span></div>
    <div class="target-macro-row">
      <div class="target-macro"><b>${target.proteinG}g</b><span>protein</span></div>
      <div class="target-macro"><b>${target.carbG}g</b><span>carbs</span></div>
      <div class="target-macro"><b>${target.fatG}g</b><span>fat</span></div>
    </div>
    <p class="muted-copy" style="margin:10px 0 0;">${target.goalLabel.charAt(0).toUpperCase() + target.goalLabel.slice(1)} — expect roughly <b>${target.weeklyRateLb > 0 ? '+' : ''}${target.weeklyRateLb} lb/week</b> at this intake. Adjust off real results after 2-3 weeks, not day one.</p>
  ` : '<p class="muted-copy">Add your height, weight, and age in Settings to unlock your targets.</p>';
  $('btnWhyTargets').hidden = !target;
  if (target) {
    $('targetExplainer').innerHTML = `
      <div class="explain-step"><b>1 · Resting burn (BMR): ${target.bmr.toLocaleString()} kcal.</b> Mifflin-St Jeor — the most validated resting-metabolism equation in the sports-nutrition literature — from your height, weight, age, and sex.</div>
      <div class="explain-step"><b>2 · Daily burn (TDEE): ×${target.multiplier} → ${target.tdee.toLocaleString()} kcal.</b> Your ${target.days} training days/week puts you in the "${target.activityLabel}" bracket.</div>
      <div class="explain-step"><b>3 · Goal adjustment: ${target.goalLabel} → ${target.calories.toLocaleString()} kcal.</b> Because ${target.goalWhy}.</div>
      <div class="explain-step"><b>4 · Protein: ${target.proteinPerKg} g/kg → ${target.proteinG}g.</b> The 1.6-2.2 g/kg range is where meta-analyses show muscle-building benefits plateau — more isn't harmful, just unnecessary.</div>
      <div class="explain-step"><b>5 · Fat: 25% of calories → ${target.fatG}g.</b> Keeps you above the ~20% floor that supports hormone production.</div>
      <div class="explain-step"><b>6 · Carbs: the rest → ${target.carbG}g.</b> Training fuel — carbs power hard sets and recovery between them.</div>
      <p class="muted-copy" style="margin:8px 0 0;">A research-standard starting estimate, not a lab measurement. The scale trend over 2-3 weeks is the real answer — nudge calories ±150 based on that.</p>`;
  }

  const totals = Nutrition.todayTotals(ACTIVE);
  $('macroBars').innerHTML = target ? (
    macroBarHTML('Calories', totals.calories, target.calories, ' kcal', { warnOnOver: ACTIVE.goal === 'fatloss' }) +
    macroBarHTML('Protein', totals.proteinG, target.proteinG, 'g') +
    macroBarHTML('Carbs', totals.carbG, target.carbG, 'g') +
    macroBarHTML('Fat', totals.fatG, target.fatG, 'g') +
    (totals.mealCount > totals.trackedMacroMeals && totals.mealCount > 0
      ? '<p class="muted-copy" style="margin:8px 0 0;">Carb/fat bars only count meals logged with full macros (scans and estimates carry them automatically).</p>' : '')
  ) : `<div class="scan-history-row"><span>Logged today</span><span>${totals.calories} kcal · ${totals.proteinG}g protein</span></div>`;

  const waterTarget = Nutrition.waterTargetMl(ACTIVE);
  const waterToday = Nutrition.todayWaterMl(ACTIVE);
  const waterPct = Math.min(100, Math.round(waterToday / waterTarget * 100));
  $('waterBarFill').style.width = waterPct + '%';
  $('waterBadge').textContent = waterPct >= 100 ? 'hydrated ✓' : `${waterPct}%`;
  $('waterCaption').textContent = `${waterToday.toLocaleString()} / ${waterTarget.toLocaleString()} ml — ~35 ml per kg bodyweight plus a training buffer. Hydration measurably affects strength output and perceived effort.`;

  const mealWrap = $('mealList');
  mealWrap.innerHTML = '';
  Nutrition.todayMeals(ACTIVE).slice().reverse().forEach(m => {
    const row = document.createElement('div');
    row.className = 'scan-history-row meal-row';
    const macros = (m.carbG != null || m.fatG != null)
      ? `${m.calories} kcal · ${m.proteinG}P/${m.carbG ?? 0}C/${m.fatG ?? 0}F`
      : `${m.calories} kcal · ${m.proteinG}g protein`;
    row.innerHTML = `<button class="meal-edit-target" aria-label="Edit ${m.name}"><span>${m.name}${m.aiEstimated ? ' 🤖' : ''}</span></button><span class="meal-row-right">${macros}<button class="meal-remove" aria-label="Remove ${m.name}">✕</button></span>`;
    row.querySelector('.meal-edit-target').addEventListener('click', () => openMealEditor(m));
    row.querySelector('.meal-remove').addEventListener('click', () => {
      Nutrition.removeMeal(ACTIVE, m.id);
      Sync.pushDebounced(ACTIVE);
      renderNutrition();
      showToast(`Removed ${m.name}.`);
    });
    mealWrap.appendChild(row);
  });

  const chipWrap = $('frequentMealChips');
  const frequent = Nutrition.frequentMeals(ACTIVE);
  chipWrap.innerHTML = frequent.length ? frequent.map(m => `<button class="chip" data-quicklog='${JSON.stringify(m).replace(/'/g, "&#39;")}'>${m.name} ↺</button>`).join('') : '';
  chipWrap.querySelectorAll('[data-quicklog]').forEach(btn => btn.addEventListener('click', () => {
    const m = JSON.parse(btn.dataset.quicklog.replace(/&#39;/g, "'"));
    Nutrition.addMeal(ACTIVE, m);
    Sync.pushDebounced(ACTIVE);
    renderNutrition();
    showToast(`Logged ${m.name} ✓`);
  }));
}

/* --- Scan review: the editable itemized sheet both estimate paths land in.
   Nothing is logged until the user has seen every item, fixed what's wrong,
   removed what isn't theirs, and added what the model missed. --- */
let SCAN_REVIEW = null; // { items: [...], note }
let SCAN_EDIT_ID = null; // meal id when the review sheet is editing an existing log entry

function openScanReview(items, note, editId = null) {
  SCAN_REVIEW = { items, note };
  SCAN_EDIT_ID = editId;
  $('scanReviewNote').textContent = (note ? note + ' ' : '') + 'Edit anything, remove what’s wrong, add what’s missing.';
  $('btnScanLog').textContent = editId ? 'Save changes' : 'Log meal';
  $('btnScanAddItem').hidden = !!editId;
  renderScanReview();
  $('scanReview').hidden = false;
  $('scanReview').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function closeScanReview() {
  SCAN_REVIEW = null;
  SCAN_EDIT_ID = null;
  $('scanReview').hidden = true;
  $('scanReviewItems').innerHTML = '';
}

function renderScanReview() {
  const wrap = $('scanReviewItems');
  wrap.innerHTML = '';
  SCAN_REVIEW.items.forEach((it, idx) => {
    const row = document.createElement('div');
    row.className = 'scan-review-item';
    row.innerHTML = `
      <div class="scan-review-item-top">
        <input type="text" value="${it.name.replace(/"/g, '&quot;')}" placeholder="Food" data-f="name" aria-label="Food name">
        <button class="meal-remove" data-remove aria-label="Remove item">✕</button>
      </div>
      ${it.portion ? `<p class="muted-copy scan-review-portion">~${it.portion}</p>` : ''}
      ${it.per100 ? `<div class="scan-review-grams"><label>How much did you eat? <input type="number" inputmode="numeric" value="${it.grams || 100}" data-grams> g</label></div>` : ''}
      <div class="scan-review-item-nums">
        <label>kcal<input type="number" inputmode="numeric" value="${it.calories || ''}" data-f="calories"></label>
        <label>protein<input type="number" inputmode="numeric" value="${it.proteinG || ''}" data-f="proteinG"></label>
        <label>carbs<input type="number" inputmode="numeric" value="${it.carbG || ''}" data-f="carbG"></label>
        <label>fat<input type="number" inputmode="numeric" value="${it.fatG || ''}" data-f="fatG"></label>
      </div>`;
    row.querySelectorAll('input[data-f]').forEach(inp => inp.addEventListener('input', () => {
      it[inp.dataset.f] = inp.value;
      renderScanReviewTotals();
    }));
    // Barcode items carry exact label nutrition per 100 g — the grams field
    // rescales all four macros in place, so the numbers stay label-true for
    // whatever portion was actually eaten.
    const gramsInp = row.querySelector('[data-grams]');
    if (gramsInp) gramsInp.addEventListener('input', () => {
      const g = Math.max(0, Number(gramsInp.value) || 0);
      it.grams = g;
      ['calories', 'proteinG', 'carbG', 'fatG'].forEach(f => {
        if (it.per100[f] != null) {
          it[f] = Math.round(it.per100[f] * g / 100);
          const target = row.querySelector(`input[data-f="${f}"]`);
          if (target) target.value = it[f] || '';
        }
      });
      renderScanReviewTotals();
    });
    row.querySelector('[data-remove]').addEventListener('click', () => {
      SCAN_REVIEW.items.splice(idx, 1);
      renderScanReview();
    });
    wrap.appendChild(row);
  });
  renderScanReviewTotals();
}

function renderScanReviewTotals() {
  const totals = SCAN_REVIEW.items.reduce((a, it) => ({
    calories: a.calories + (Number(it.calories) || 0),
    proteinG: a.proteinG + (Number(it.proteinG) || 0),
    carbG: a.carbG + (Number(it.carbG) || 0),
    fatG: a.fatG + (Number(it.fatG) || 0)
  }), { calories: 0, proteinG: 0, carbG: 0, fatG: 0 });
  $('scanReviewTotals').textContent = SCAN_REVIEW.items.length
    ? `Total: ~${totals.calories} kcal · ${totals.proteinG}P / ${totals.carbG}C / ${totals.fatG}F`
    : 'No items — add one, or cancel.';
}

function scanReviewAddItem() {
  SCAN_REVIEW.items.push({ name: '', portion: '', calories: 0, proteinG: 0, carbG: 0, fatG: 0 });
  renderScanReview();
  const rows = $('scanReviewItems').querySelectorAll('.scan-review-item input[data-f="name"]');
  if (rows.length) rows[rows.length - 1].focus();
}

function scanReviewLog() {
  const items = SCAN_REVIEW.items.filter(it => (it.name || '').trim() && (Number(it.calories) || Number(it.proteinG)));
  if (!items.length) { showToast('Nothing to log — every item needs a name and a number.'); return; }
  if (SCAN_EDIT_ID) {
    const it = items[0];
    Nutrition.updateMeal(ACTIVE, SCAN_EDIT_ID, it);
    Sync.pushDebounced(ACTIVE);
    closeScanReview();
    renderNutrition();
    showToast(`Updated ${it.name.trim()} ✓`);
    return;
  }
  items.forEach(it => Nutrition.addMeal(ACTIVE, { ...it, name: it.name.trim(), aiEstimated: true }));
  Sync.pushDebounced(ACTIVE);
  closeScanReview();
  $('mealQuickText').value = '';
  renderNutrition();
  showToast(`Logged ${items.length} item${items.length === 1 ? '' : 's'} ✓`);
}

// Tap a logged meal to fix it in place — same review sheet, single item,
// saves back onto the same log entry instead of creating a new one.
function openMealEditor(meal) {
  openScanReview(
    [{ name: meal.name, portion: '', calories: meal.calories, proteinG: meal.proteinG, carbG: meal.carbG ?? 0, fatG: meal.fatG ?? 0 }],
    `Editing "${meal.name}".`,
    meal.id
  );
}

/* --- Barcode → OpenFoodFacts: exact label nutrition for packaged food --- */
async function handleBarcodeCode(code) {
  showToast('Looking up barcode…');
  const res = await Barcode.lookup(code);
  if (!res.ok) {
    const msg = {
      not_found: 'Not in the OpenFoodFacts database — scan the meal as a photo instead.',
      no_nutrition: 'Product found, but no nutrition data on record — log it by hand or photo.',
      bad_code: 'That doesn’t look like a barcode number — check the digits.',
    }[res.error] || 'Couldn’t reach the food database — check your connection and try again.';
    showToast(msg, 4200);
    return;
  }
  const grams = res.servingG || 100;
  const scale = g => f => res.per100[f] != null ? Math.round(res.per100[f] * g / 100) : 0;
  const s = scale(grams);
  openScanReview([{
    name: res.name,
    portion: res.servingLabel ? `1 serving = ${res.servingLabel}` : 'per 100 g — set your portion below',
    calories: s('calories'), proteinG: s('proteinG'), carbG: s('carbG'), fatG: s('fatG'),
    per100: res.per100, grams
  }], 'From the product label via OpenFoodFacts — set the grams you actually ate.');
}

async function openBarcodeScanner() {
  const res = await Camera.open({
    guide: 'food',
    tip: 'Center the barcode in the box — it detects automatically, no tap needed.',
    barcode: true,
    onBarcode: handleBarcodeCode
  });
  if (!res.ok) {
    // iOS Safari has no BarcodeDetector — typing the printed number is the
    // honest fallback and hits the exact same database.
    $('barcodeManualRow').hidden = false;
    $('barcodeManualCode').focus();
    if (res.error === 'no_detector') showToast('Live scanning isn’t supported in this browser — type the number printed under the barcode instead.', 4500);
  }
}

async function estimateTextClick() {
  const text = $('mealQuickText').value.trim();
  if (!text) { showToast('Type what you ate first.'); return; }
  if (!Sync.isLoggedIn()) { showToast('Sign in under Settings → Sync first — or fill in calories/protein by hand below.'); return; }
  const btn = $('btnEstimateText');
  btn.disabled = true; btn.textContent = 'Estimating…';
  const res = await Nutrition.estimateFromText(text);
  btn.disabled = false; btn.textContent = '✨ Estimate for me';
  if (res.ok) openScanReview(res.items, res.note);
  else showToast('Couldn’t reach Bedrock — fill in calories/protein by hand, or check Settings → Sync.');
}

function addWater(delta) {
  Nutrition.logWater(ACTIVE, Math.max(0, Nutrition.todayWaterMl(ACTIVE) + delta) - Nutrition.todayWaterMl(ACTIVE));
  renderNutrition();
}

function addMealFromForm() {
  const name = $('mealQuickText').value.trim();
  const calories = $('mealCalories').value, proteinG = $('mealProtein').value;
  if (!name || (!calories && !proteinG)) { showToast('Add a food name and at least calories or protein.'); return; }
  Nutrition.addMeal(ACTIVE, { name, calories, proteinG, aiEstimated: false });
  Sync.pushDebounced(ACTIVE);
  $('mealQuickText').value = ''; $('mealCalories').value = ''; $('mealProtein').value = '';
  renderNutrition();
  showToast(`Logged ${name} ✓`);
}

async function scanFoodDataUrl(dataUrl) {
  if (!Sync.isLoggedIn()) { showToast('Sign in under Settings → Sync first.'); return; }
  const btn = $('btnScanFood');
  btn.disabled = true; btn.textContent = 'Scanning…';
  const res = await Nutrition.estimateFoodPhoto(dataUrl);
  btn.disabled = false; btn.textContent = '📷 Scan a photo';
  if (res.ok) openScanReview(res.items, res.note);
  else showToast('Couldn’t reach Bedrock — check you’re signed in under Settings → Sync.');
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

// Auto-populates once a day (cached) when the Supplements panel opens — no
// tap needed for a passive read of the same fixed reference list below it.
async function loadAiSupplements() {
  if (!Sync.isLoggedIn()) { $('aiSupplementResult').hidden = true; return; }
  const key = `bedrock_ai_supplements_${ACTIVE.id}_${new Date().toDateString()}`;
  const cached = localStorage.getItem(key);
  if (cached) { $('aiSupplementResult').hidden = false; $('aiSupplementResult').textContent = cached; return; }
  $('aiSupplementResult').hidden = false;
  $('aiSupplementResult').textContent = 'Thinking…';
  const sys = BEDROCK_PERSONA + ' You will get a data summary and a fixed supplement reference list has already been shown to the user separately. Recommend at most 2-3 supplements from mainstream sports-nutrition evidence (not exotic/unproven ones) that best fit this specific person\'s goal and gaps, one short line each on why. End with a one-line reminder that food and training come first. Under 60 words total, no preamble.';
  const res = await BedrockAPI.chat([{ role: 'user', content: Insights.summaryText(ACTIVE) }], sys);
  if (res.ok) { $('aiSupplementResult').textContent = res.text; localStorage.setItem(key, res.text); }
  else $('aiSupplementResult').hidden = true;
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

function showChatTyping(show) {
  let el = $('chatTyping');
  if (show) {
    if (!el) {
      el = document.createElement('div');
      el.id = 'chatTyping';
      el.className = 'chat-bubble chat-ai chat-typing';
      el.innerHTML = '<span></span><span></span><span></span>';
      $('chatLog').appendChild(el);
    }
    $('chatLog').scrollTop = $('chatLog').scrollHeight;
  } else if (el) el.remove();
}

async function sendChat() {
  const input = $('chatInput');
  const text = input.value.trim();
  if (!text) return;
  if (!Sync.isLoggedIn()) { showToast('Sign in under Settings → Sync first.'); return; }
  ACTIVE.history.chats = ACTIVE.history.chats || [];
  ACTIVE.history.chats.push({ role: 'user', content: text, date: Date.now() });
  input.value = '';
  renderChat();
  saveActive();
  showChatTyping(true);

  // Data-grounded: every chat turn includes a fresh summary of the user's
  // actual logs (the same numbers driving their charts) so answers cite
  // real figures instead of generic advice, and always end with one
  // concrete next step.
  const sys = BEDROCK_PERSONA + `\n\nHere is the user's current data summary — this is exactly what feeds their charts on the Progress and Fuel tabs. Cite specific numbers from it directly in your answer (e.g. "your bench is up to X lb", "legs is Y% of your recent volume") rather than speaking generically. If the summary doesn't have what you'd need to answer precisely, say so plainly instead of guessing. End with one concrete, specific next action.\n\n${Insights.summaryText(ACTIVE)}\n\nKeep answers under ~100 words — direct and plain, no preamble.`;
  const recent = ACTIVE.history.chats.slice(-10).map(m => ({ role: m.role, content: m.content }));
  const res = await BedrockAPI.chat(recent, sys, 300);
  showChatTyping(false);
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
  const connected = Fitbit.isConnected();
  $('btnFitbitConnect').hidden = connected;
  $('btnFitbitSync').hidden = !connected;
  $('btnFitbitDisconnect').hidden = !connected;
  $('fitbitStatus').textContent = connected
    ? `Connected — auto-syncs quietly whenever you open Bedrock (at most every 30 min).${ACTIVE.fitbitLastAutoSyncAt ? ' Last synced ' + timeAgo(ACTIVE.fitbitLastAutoSyncAt) + '.' : ''}`
    : 'Not connected yet.';
  $('btnShowFitbitBanner').hidden = localStorage.getItem(FITBIT_BANNER_DISMISSED_KEY) !== '1';
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
  $('btnClosePhotoLightbox').addEventListener('click', () => { $('photoLightbox').hidden = true; });
  $('photoLightbox').addEventListener('click', e => { if (e.target.id === 'photoLightbox') $('photoLightbox').hidden = true; });
  $('btnSettings').addEventListener('click', () => { showView('settings'); renderSettings(); });
  $('btnGoConnectFitbit').addEventListener('click', () => { showView('settings'); renderSettings(); $('btnFitbitConnect').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  $('btnDismissFitbitBanner').addEventListener('click', dismissFitbitBanner);
  wireFitbitBannerSwipe();
  $('btnToggleTheme').addEventListener('click', toggleTheme);
  applyStoredTheme();

  $('btnStartWorkout').addEventListener('click', startWorkout);
  $('navFab').addEventListener('click', startWorkout);
  qs('[data-close-workout]').addEventListener('click', () => {
    // Leaving mid-session throws the whole log away — worth one question if
    // real sets have been checked off, silent if nothing's been done yet.
    const hasProgress = ACTIVE_WORKOUT && ACTIVE_WORKOUT.exercises.some(ex => ex.sets.some(s => s.done));
    if (hasProgress && !confirm('Leave without saving? Checked-off sets will be lost — use "Finish & save" to keep them.')) return;
    skipRestTimer(); ACTIVE_WORKOUT = null; showView('dashboard'); renderDashboard();
  });
  $('btnFinishWorkout').addEventListener('click', finishWorkout);
  $('btnRestSkip').addEventListener('click', skipRestTimer);
  $('btnRestAdd30').addEventListener('click', () => addRestTime(30));
  $('prToast').addEventListener('click', function () { this.hidden = true; });

  $('tileWeekPlan').addEventListener('click', toggleWeekAccordion);

  $('tileProgress').addEventListener('click', () => { showView('progress'); renderProgress(); });
  qs('[data-close-progress]').addEventListener('click', () => showView('dashboard'));
  $('btnTakePhoto').addEventListener('click', openBodyScanCamera);
  $('btnUploadPhoto').addEventListener('click', () => $('scanPhotoInput').click());
  $('scanPhotoInput').addEventListener('change', e => { if (e.target.files[0]) handlePhotoSelected(e.target.files[0]); e.target.value = ''; });
  Camera.wire();
  $('btnSaveScan').addEventListener('click', saveScan);
  $('btnAskAiScan').addEventListener('click', askAiAboutScan);
  $('btnComparePhotos').addEventListener('click', comparePhotosClick);
  $('btnToggleFocusOverlay').addEventListener('click', toggleFocusOverlay);

  $('tileSupplements').addEventListener('click', () => { showView('supplements'); switchFuelTab('supplements'); renderSupplements(); loadAiSupplements(); });
  qs('[data-close-supplements]').addEventListener('click', () => showView('dashboard'));
  qsa('#supplementFilter .chip').forEach(chip => chip.addEventListener('click', () => {
    qsa('#supplementFilter .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    renderSupplements(chip.dataset.filter);
  }));
  qsa('#fuelTabs .chip').forEach(chip => chip.addEventListener('click', () => switchFuelTab(chip.dataset.tab)));
  qsa('[data-water]').forEach(btn => btn.addEventListener('click', () => addWater(Number(btn.dataset.water))));
  $('btnWaterCustom').addEventListener('click', () => {
    const row = $('waterCustomRow');
    row.hidden = !row.hidden;
    if (!row.hidden) $('waterCustomMl').focus();
  });
  $('btnWaterCustomAdd').addEventListener('click', () => {
    const ml = Math.round(Number($('waterCustomMl').value));
    if (!ml || ml <= 0) { showToast('Enter how many ml you drank.'); return; }
    if (ml > 5000) { showToast('That\'s over 5 liters in one go — double-check the number.'); return; }
    addWater(ml);
    $('waterCustomMl').value = '';
    $('waterCustomRow').hidden = true;
    showToast(`+${ml} ml ✓`);
  });
  $('waterCustomMl').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnWaterCustomAdd').click(); });
  $('btnWaterUndo').addEventListener('click', () => {
    const removed = Nutrition.undoLastWaterToday(ACTIVE);
    Sync.pushDebounced(ACTIVE);
    renderNutrition();
    showToast(removed ? `Removed ${removed.ml} ml.` : 'Nothing logged today to undo.');
  });
  $('btnWhyTargets').addEventListener('click', () => {
    const ex = $('targetExplainer');
    ex.hidden = !ex.hidden;
    $('btnWhyTargets').textContent = ex.hidden ? 'Why these numbers? ▾' : 'Hide the math ▴';
  });
  $('btnAddMeal').addEventListener('click', addMealFromForm);
  $('btnScanFood').addEventListener('click', openFoodScanCamera);
  $('btnScanBarcode').addEventListener('click', openBarcodeScanner);
  $('btnBarcodeLookup').addEventListener('click', () => {
    const code = $('barcodeManualCode').value.trim();
    if (!code) { showToast('Type the number printed under the barcode.'); return; }
    $('barcodeManualCode').value = '';
    $('barcodeManualRow').hidden = true;
    handleBarcodeCode(code);
  });
  $('barcodeManualCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnBarcodeLookup').click(); });
  $('btnUploadFood').addEventListener('click', () => $('foodPhotoInput').click());
  $('foodPhotoInput').addEventListener('change', e => { if (e.target.files[0]) scanFoodPhoto(e.target.files[0]); e.target.value = ''; });
  $('btnEstimateText').addEventListener('click', estimateTextClick);
  $('btnScanAddItem').addEventListener('click', scanReviewAddItem);
  $('btnScanCancel').addEventListener('click', closeScanReview);
  $('btnScanLog').addEventListener('click', scanReviewLog);
  $('btnSuggestMeal').addEventListener('click', suggestMealClick);

  $('btnOpenGuide').addEventListener('click', () => showView('guide'));
  qs('[data-close-guide]').addEventListener('click', () => showView('settings'));

  $('btnAddCustomEx').addEventListener('click', addCustomExercise);

  $('btnFitbitConnect').addEventListener('click', () => Fitbit.connect());
  $('btnFitbitSync').addEventListener('click', fitbitSyncClick);
  $('btnFitbitDisconnect').addEventListener('click', async () => { $('fitbitStatus').textContent = 'Disconnecting…'; await Fitbit.disconnect(); renderFitbitPanel(); });
  $('btnShowFitbitBanner').addEventListener('click', () => { localStorage.removeItem(FITBIT_BANNER_DISMISSED_KEY); renderFitbitBanner(); renderFitbitPanel(); });

  qs('[data-close-chat]').addEventListener('click', () => showView('dashboard'));
  $('btnClearChat').addEventListener('click', () => {
    if (!(ACTIVE.history.chats || []).length) return;
    if (!confirm('Clear this conversation? Your logs and data are untouched — just the chat history goes.')) return;
    ACTIVE.history.chats = [];
    saveActive();
    renderChat();
  });
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
    if (target === 'supplements') { renderSupplements(); loadAiSupplements(); }
    if (target === 'chat') renderChat();
  }));

  $('btnTourNext').addEventListener('click', tourNext);
  $('btnTourSkip').addEventListener('click', endTour);

  if (ACTIVE) {
    showView('dashboard');
    renderDashboard();
    if (!localStorage.getItem(TOUR_DONE_KEY)) startTour();
  } else {
    initOnboarding();
    showView('onboarding');
  }

  // If we just landed back here from the Google Health OAuth redirect,
  // drop the user in Settings so they see "Connected." (The token exchange
  // already happened server-side, in the worker's callback — this is just
  // reading the plain query flag it redirected back with.)
  if (Fitbit.handleRedirectIfPresent() && ACTIVE) { showView('settings'); renderSettings(); }

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
