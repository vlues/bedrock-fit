/* ===================== Bedrock — shared resilience helpers ===================== */
/* Used by api.js and fitbit.js so a slow/down external API fails fast with
   a clear error instead of hanging the UI forever. */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout:' + (label || 'request'))), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/* ===================== Bedrock — local storage / state ===================== */
/* The source of truth is always localStorage on this device — the app is
   fully usable offline, with or without an account. Structure:
   bedrock_profiles: [{ id, name, age, sex, weightLb, heightIn, goal, exp, days, equipment,
                         limitations, unitWeight, createdAt,
                         history: { workouts:[], checkins:[], chats:[] },
                         planSeed: number (for deterministic-ish variety) }]
   bedrock_activeProfileId: string

   Signing in to an account (see js/sync.js) additionally backs the active
   profile up to the Cloudflare Worker backend and unlocks Bedrock's AI
   features — there's no personal API key stored here or anywhere else in
   this app; js/sync.js's bedrock_sync_token is the only credential kept.
*/

const Store = (() => {
  const PROFILES_KEY = 'bedrock_profiles';
  const ACTIVE_KEY = 'bedrock_activeProfileId';

  function getProfiles() {
    try { return JSON.parse(localStorage.getItem(PROFILES_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveProfiles(list) {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(list));
  }
  function getActiveId() {
    return localStorage.getItem(ACTIVE_KEY);
  }
  function setActiveId(id) {
    localStorage.setItem(ACTIVE_KEY, id);
  }
  function getActiveProfile() {
    const id = getActiveId();
    if (!id) return null;
    const p = getProfiles().find(p => p.id === id) || null;
    return p ? ensureShape(p) : null;
  }
  function upsertProfile(profile) {
    const list = getProfiles();
    const idx = list.findIndex(p => p.id === profile.id);
    if (idx === -1) list.push(profile); else list[idx] = profile;
    saveProfiles(list);
    return profile;
  }
  function newProfileId() {
    return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function createBlankProfile() {
    return {
      id: newProfileId(),
      name: '', age: null, sex: 'other',
      weightLb: null, heightIn: null,
      goal: 'muscle', exp: 'new', days: 3, equipment: 'full', focusAreas: [], excludedExercises: [],
      limitations: '', unitWeight: 'lb', unitHeight: 'ftin',
      createdAt: Date.now(),
      history: { workouts: [], checkins: [], chats: [], water: [], meals: [], fitbitDaily: [] },
      customExercises: [],
      planSeed: Math.floor(Math.random() * 1000)
    };
  }
  // fills in fields missing on profiles created by an earlier version of the app
  function ensureShape(p) {
    p.history = p.history || {};
    p.history.workouts = p.history.workouts || [];
    p.history.checkins = p.history.checkins || [];
    p.history.chats = p.history.chats || [];
    p.history.water = p.history.water || [];
    p.history.meals = p.history.meals || [];
    p.history.fitbitDaily = p.history.fitbitDaily || [];
    p.customExercises = p.customExercises || [];
    p.focusAreas = p.focusAreas || [];
    p.excludedExercises = p.excludedExercises || [];
    return p;
  }
  function deleteProfile(id) {
    const list = getProfiles().filter(p => p.id !== id);
    saveProfiles(list);
    if (getActiveId() === id) {
      setActiveId(list.length ? list[0].id : '');
    }
  }

  // ---------- unit conversions ----------
  const lbToKg = lb => lb * 0.453592;
  const kgToLb = kg => kg / 0.453592;
  const inToCm = inch => inch * 2.54;
  const cmToIn = cm => cm / 2.54;
  const ftInToIn = (ft, inch) => (Number(ft) || 0) * 12 + (Number(inch) || 0);
  const inToFtIn = totalIn => ({ ft: Math.floor(totalIn / 12), inch: Math.round(totalIn % 12) });

  return {
    getProfiles, saveProfiles, getActiveId, setActiveId, getActiveProfile,
    upsertProfile, createBlankProfile, deleteProfile,
    ensureShape,
    lbToKg, kgToLb, inToCm, cmToIn, ftInToIn, inToFtIn
  };
})();
