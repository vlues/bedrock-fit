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

  function dailyTarget(profile) {
    const base = bmr(profile);
    if (!base) return null;
    const tdee = base * activityMultiplier(Number(profile.days) || 3);
    const adjust = { muscle: 1.12, strength: 1.05, fatloss: 0.82, general: 1.0 }[profile.goal] || 1.0;
    const calories = Math.round(tdee * adjust);
    const kg = Store.lbToKg(profile.weightLb);
    const proteinPerKg = { muscle: 2.0, strength: 2.0, fatloss: 2.2, general: 1.6 }[profile.goal] || 1.8;
    const proteinG = Math.round(kg * proteinPerKg);
    const fatG = Math.round((calories * 0.25) / 9);
    const carbG = Math.max(0, Math.round((calories - proteinG * 4 - fatG * 9) / 4));
    return { bmr: Math.round(base), tdee: Math.round(tdee), calories, proteinG, fatG, carbG };
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

  function addMeal(profile, meal) {
    profile.history.meals.push({
      id: 'm_' + Date.now().toString(36),
      date: Date.now(),
      name: meal.name || 'Meal',
      calories: Number(meal.calories) || 0,
      proteinG: Number(meal.proteinG) || 0,
      photo: meal.photo || null,
      aiEstimated: !!meal.aiEstimated
    });
    Store.upsertProfile(profile);
  }
  function todayMeals(profile) {
    return profile.history.meals.filter(m => isToday(m.date));
  }
  function todayTotals(profile) {
    const meals = todayMeals(profile);
    return meals.reduce((a, m) => ({ calories: a.calories + m.calories, proteinG: a.proteinG + m.proteinG }), { calories: 0, proteinG: 0 });
  }

  // Type what you ate in plain language ("two eggs and toast with butter")
  // and get calories/protein filled in for you — the same one-tap-to-log
  // feel as the photo scanner, without needing the camera.
  async function estimateFromText(description) {
    if (!Sync.isLoggedIn()) return { ok: false, error: 'not_signed_in' };
    const sys = 'You estimate rough calorie/protein content of a described meal for casual tracking. This is NOT precise and you must say so. Respond in EXACTLY this format, nothing else:\nNAME: <short food name>\nCALORIES: <number>\nPROTEIN: <number>\nNOTE: <one short honest caveat about estimate accuracy>';
    const res = await BedrockAPI.chat([{ role: 'user', content: `Estimate the calories and protein of: ${description}` }], sys);
    if (!res.ok) return res;
    const get = (label) => { const m = new RegExp(label + ':\\s*(.+)').exec(res.text); return m ? m[1].trim() : ''; };
    return {
      ok: true,
      name: get('NAME') || description,
      calories: parseInt(get('CALORIES')) || 0,
      proteinG: parseInt(get('PROTEIN')) || 0,
      note: get('NOTE') || 'Rough estimate only.'
    };
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
    const sys = 'You estimate rough calorie/protein content of food photos for casual tracking. This is NOT precise and you must say so. Respond in EXACTLY this format, nothing else:\nNAME: <short food name>\nCALORIES: <number>\nPROTEIN: <number>\nNOTE: <one short honest caveat about estimate accuracy>';
    const res = await BedrockAPI.askAboutImage(dataUrl, 'Estimate the calories and protein of this food.', sys);
    if (!res.ok) return res;
    const get = (label) => { const m = new RegExp(label + ':\\s*(.+)').exec(res.text); return m ? m[1].trim() : ''; };
    return {
      ok: true,
      name: get('NAME') || 'Food',
      calories: parseInt(get('CALORIES')) || 0,
      proteinG: parseInt(get('PROTEIN')) || 0,
      note: get('NOTE') || 'Rough estimate only.'
    };
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
    bmr, dailyTarget, waterTargetMl, logWater, todayWaterMl, addMeal, todayMeals, todayTotals,
    estimateFoodPhoto, estimateFromText, frequentMeals, remainingToday, recentMealSummary, suggestMeal
  };
})();
