/* ===================== Bedrock — nutrition ===================== */
/* Calorie/macro target uses the Mifflin-St Jeor equation (the most
   validated resting-metabolic-rate formula in the sports-nutrition
   literature) times an activity multiplier from training days/week,
   then a goal-based adjustment. Protein targets follow the commonly
   cited 1.6-2.2 g/kg range. Everything here is an estimate for general
   guidance, not a clinical prescription. */

const Nutrition = (() => {

  function bmr(profile) {
    if (!profile.weightLb || !profile.heightIn || !profile.age) return null;
    const kg = Store.lbToKg(profile.weightLb);
    const cm = Store.inToCm(profile.heightIn);
    if (profile.sex === 'male') return 10 * kg + 6.25 * cm - 5 * profile.age + 5;
    if (profile.sex === 'female') return 10 * kg + 6.25 * cm - 5 * profile.age - 161;
    return 10 * kg + 6.25 * cm - 5 * profile.age - 78; // midpoint when unspecified
  }

  function activityMultiplier(days) {
    if (days <= 2) return 1.375;
    if (days <= 4) return 1.55;
    return 1.725;
  }
  function activityLabel(days) {
    if (days <= 2) return 'lightly active';
    if (days <= 4) return 'moderately active';
    return 'very active';
  }

  // Goal adjustments follow the evidence on sustainable rates of change:
  // ~10-12% surplus targets ~0.25-0.5% bodyweight/week gained (minimizes fat
  // gain per unit muscle); ~18% deficit targets ~0.5-1% bodyweight/week lost
  // (preserves muscle when protein + training are in place); strength gets a
  // small surplus (performance without unnecessary fat gain).
  const GOAL_ADJUST = {
    muscle:   { factor: 1.12, label: 'building surplus (+12%)', why: 'a controlled surplus builds muscle with minimal fat gain — bigger surpluses just add fat faster, not muscle faster' },
    strength: { factor: 1.05, label: 'performance surplus (+5%)', why: 'a small surplus supports heavy training and recovery without a bulking phase' },
    fatloss:  { factor: 0.82, label: 'cutting deficit (−18%)', why: 'a moderate deficit loses fat while high protein + lifting protect the muscle underneath — crash deficits lose muscle too' },
    general:  { factor: 1.0,  label: 'maintenance', why: 'eating at maintenance supports health and steady recomposition alongside consistent training' }
  };

  function dailyTarget(profile) {
    const base = bmr(profile);
    if (!base) return null;
    const days = Number(profile.days) || 3;
    const mult = activityMultiplier(days);
    const tdee = base * mult;
    const goal = GOAL_ADJUST[profile.goal] || GOAL_ADJUST.general;
    const calories = Math.round(tdee * goal.factor);
    const kg = Store.lbToKg(profile.weightLb);
    const proteinPerKg = { muscle: 2.0, strength: 2.0, fatloss: 2.2, general: 1.6 }[profile.goal] || 1.8;
    const proteinG = Math.round(kg * proteinPerKg);
    const fatG = Math.round((calories * 0.25) / 9);
    const carbG = Math.max(0, Math.round((calories - proteinG * 4 - fatG * 9) / 4));
    // ~3500 kcal per lb of tissue: the standard back-of-envelope rate estimate.
    const weeklyRateLb = Math.round(((calories - tdee) * 7 / 3500) * 10) / 10;
    return {
      bmr: Math.round(base), tdee: Math.round(tdee), calories, proteinG, fatG, carbG,
      multiplier: mult, activityLabel: activityLabel(days), days,
      goalLabel: goal.label, goalWhy: goal.why, weeklyRateLb, proteinPerKg
    };
  }

  function waterTargetMl(profile) {
    if (!profile.weightLb) return 2700;
    const kg = Store.lbToKg(profile.weightLb);
    return Math.round(kg * 35 + 500); // baseline ml/kg + buffer for training days
  }

  const isToday = ts => new Date(ts).toDateString() === new Date().toDateString();

  function logWater(profile, ml) {
    profile.history.water.push({ date: Date.now(), ml: Number(ml) || 0 });
    Store.upsertProfile(profile);
  }
  function todayWaterMl(profile) {
    return profile.history.water.filter(w => isToday(w.date)).reduce((a, w) => a + w.ml, 0);
  }
  // Undo removes the most recent of today's entries — a real correction for
  // a double-tap, instead of the old "log negative water" workaround.
  function undoLastWaterToday(profile) {
    const water = profile.history.water || [];
    for (let i = water.length - 1; i >= 0; i--) {
      if (isToday(water[i].date)) {
        const [removed] = water.splice(i, 1);
        Store.upsertProfile(profile);
        return removed;
      }
    }
    return null;
  }

  function addMeal(profile, meal) {
    profile.history.meals.push({
      id: 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      date: Date.now(),
      name: meal.name || 'Meal',
      calories: Number(meal.calories) || 0,
      proteinG: Number(meal.proteinG) || 0,
      carbG: meal.carbG != null ? Number(meal.carbG) || 0 : null,
      fatG: meal.fatG != null ? Number(meal.fatG) || 0 : null,
      photo: meal.photo || null,
      aiEstimated: !!meal.aiEstimated
    });
    Store.upsertProfile(profile);
  }
  // Logged the wrong thing, or the scan was off? One tap undoes it — a food
  // log you can't correct just teaches people to stop logging.
  function removeMeal(profile, mealId) {
    profile.history.meals = (profile.history.meals || []).filter(m => m.id !== mealId);
    Store.upsertProfile(profile);
  }
  function updateMeal(profile, mealId, fields) {
    const meal = (profile.history.meals || []).find(m => m.id === mealId);
    if (!meal) return null;
    if (fields.name != null) meal.name = String(fields.name).slice(0, 60) || meal.name;
    ['calories', 'proteinG', 'carbG', 'fatG'].forEach(f => {
      if (fields[f] != null && fields[f] !== '') meal[f] = Math.max(0, Math.round(Number(fields[f]) || 0));
    });
    Store.upsertProfile(profile);
    return meal;
  }
  function todayMeals(profile) {
    return profile.history.meals.filter(m => isToday(m.date));
  }
  // Carb/fat sums only count meals that actually carry those numbers (AI
  // scans do; quick hand-entries may not) — trackedMacroMeals lets the UI
  // caption the carb/fat bars honestly instead of implying full coverage.
  function todayTotals(profile) {
    const meals = todayMeals(profile);
    return meals.reduce((a, m) => ({
      calories: a.calories + m.calories,
      proteinG: a.proteinG + m.proteinG,
      carbG: a.carbG + (Number(m.carbG) || 0),
      fatG: a.fatG + (Number(m.fatG) || 0),
      trackedMacroMeals: a.trackedMacroMeals + (m.carbG != null || m.fatG != null ? 1 : 0),
      mealCount: a.mealCount + 1
    }), { calories: 0, proteinG: 0, carbG: 0, fatG: 0, trackedMacroMeals: 0, mealCount: 0 });
  }

  // Both estimate paths (photo + text) return the same shape: an itemized
  // list of foods with per-item numbers, so the UI can show a review sheet
  // where each item is editable/removable before anything is logged —
  // instead of one opaque total the user has to take or leave.
  const ITEMIZE_SYS = 'You itemize food for casual calorie tracking. Estimates are rough, never precise, and the note must say so honestly. The user may describe food in Spanish or English (they live in Spain) — understand both, including Spanish and regional dishes (tortilla española, gazpacho, fabada, pan con tomate, jamón ibérico, etc.) and Spanish brand/portion conventions, and keep each item\'s name in the language the user used. Use any visible size references (fork, hand, plate rim, packaging) to calibrate portions. Respond with ONLY a JSON object, no markdown fences, no prose, exactly this shape: {"items":[{"name":"short food name","portion":"rough portion e.g. 1 cup","grams":150,"calories":320,"proteinG":12,"carbG":30,"fatG":14,"confidence":"high|medium|low"}],"note":"one short honest caveat about accuracy"} — one entry per distinct food you can identify, whole numbers only. confidence reflects how sure you are of the PORTION SIZE (identification is usually easy; portions are the hard part — be honest, use "low" freely).';

  function parseItemized(text, fallbackName) {
    try {
      const start = text.indexOf('{'), end = text.lastIndexOf('}');
      if (start === -1 || end <= start) throw new Error('no json');
      const data = JSON.parse(text.slice(start, end + 1));
      const items = (data.items || [])
        .map(it => ({
          name: String(it.name || 'Food').slice(0, 60),
          portion: it.portion ? String(it.portion).slice(0, 40) : '',
          estGrams: Math.min(2000, Math.max(0, Math.round(Number(it.grams) || 0))) || null,
          calories: Math.max(0, Math.round(Number(it.calories) || 0)),
          proteinG: Math.max(0, Math.round(Number(it.proteinG) || 0)),
          carbG: Math.max(0, Math.round(Number(it.carbG) || 0)),
          fatG: Math.max(0, Math.round(Number(it.fatG) || 0)),
          confidence: ['high', 'medium', 'low'].includes(it.confidence) ? it.confidence : null
        }))
        .filter(it => it.name && (it.calories || it.proteinG));
      if (!items.length) throw new Error('no items');
      return { ok: true, items, note: String(data.note || 'Rough estimates only.').slice(0, 160) };
    } catch (e) {
      // Model went off-script — hand back one editable blank item rather
      // than failing, so the user can still finish the log by hand.
      return { ok: true, items: [{ name: fallbackName || 'Food', portion: '', calories: 0, proteinG: 0, carbG: 0, fatG: 0 }], note: 'Couldn’t read the estimate — fill the numbers in yourself.' };
    }
  }

  // Type what you ate in plain language ("two eggs and toast with butter")
  // and get an itemized, editable estimate — same review flow as the photo
  // scanner, without needing the camera.
  async function estimateFromText(description) {
    if (!Sync.isLoggedIn()) return { ok: false, error: 'not_signed_in' };
    const res = await BedrockAPI.ask({
      system: ITEMIZE_SYS,
      messages: [{ role: 'user', content: `Itemize and estimate this meal: ${description}` }],
      maxTokens: 600
    });
    if (!res.ok) return res;
    return parseItemized(res.text, description);
  }

  // Meals logged often enough to be worth a one-tap re-add — this is what
  // makes tracking get EASIER over time instead of staying tedious: the
  // more you log, the more of your usual foods become a single tap.
  function frequentMeals(profile, limit = 4) {
    const counts = {};
    (profile.history.meals || []).forEach(m => {
      const key = m.name.trim().toLowerCase();
      if (!counts[key]) counts[key] = { name: m.name, calories: m.calories, proteinG: m.proteinG, count: 0 };
      counts[key].count++;
      counts[key].calories = m.calories; // keep most recent values for that food
      counts[key].proteinG = m.proteinG;
    });
    return Object.values(counts).filter(m => m.count >= 2).sort((a, b) => b.count - a.count).slice(0, limit);
  }

  // What's left today against the goal-linked target — the number that
  // actually matters, front and center, so the goal never gets lost in
  // raw totals.
  function remainingToday(profile) {
    const target = dailyTarget(profile);
    if (!target) return null;
    const totals = todayTotals(profile);
    return {
      calories: target.calories - totals.calories,
      proteinG: target.proteinG - totals.proteinG,
      target, totals
    };
  }

  async function estimateFoodPhoto(dataUrl) {
    if (!Sync.isLoggedIn()) return { ok: false, error: 'not_signed_in' };
    const res = await BedrockAPI.askAboutImage(dataUrl, 'Itemize every distinct food you can see in this photo and estimate each one.', ITEMIZE_SYS, 600);
    if (!res.ok) return res;
    return parseItemized(res.text, 'Food');
  }

  function recentMealSummary(profile, days = 3) {
    const cutoff = Date.now() - days * 24 * 3600 * 1000;
    const meals = profile.history.meals.filter(m => m.date >= cutoff);
    if (!meals.length) return 'No meals logged recently.';
    return meals.map(m => `${new Date(m.date).toLocaleDateString()}: ${m.name} (~${m.calories} kcal, ~${m.proteinG}g protein)`).join('\n');
  }

  // Uses logged meal history as memory so suggestions reflect what the
  // person actually eats, not generic advice.
  async function suggestMeal(profile) {
    if (!Sync.isLoggedIn()) return { ok: false, error: 'not_signed_in' };
    const target = dailyTarget(profile);
    const totals = todayTotals(profile);
    const sys = BEDROCK_PERSONA + ' Suggest ONE concrete next meal or snack (real foods, rough portions) that closes the gap to the remaining daily targets, based on what they usually eat if that\'s clear from the log. 2 sentences max, no preamble. Not medical advice.';
    const msg = `Goal: ${profile.goal}.\nDaily target: ~${target?.calories ?? '?'} kcal, ~${target?.proteinG ?? '?'}g protein, ~${target?.carbG ?? '?'}g carbs, ~${target?.fatG ?? '?'}g fat.\nLogged today so far: ~${totals.calories} kcal, ~${totals.proteinG}g protein.\nRecent meals (memory):\n${recentMealSummary(profile)}`;
    return BedrockAPI.chat([{ role: 'user', content: msg }], sys);
  }

  return {
    bmr, dailyTarget, waterTargetMl, logWater, todayWaterMl, addMeal, removeMeal, updateMeal, todayMeals, todayTotals,
    undoLastWaterToday, estimateFoodPhoto, estimateFromText, frequentMeals, remainingToday, recentMealSummary, suggestMeal
  };
})();
