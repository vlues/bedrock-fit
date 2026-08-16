/* ===================== Bedrock — data insights ===================== */
/* Turns raw logs into a compact structured summary, used for: a cached
   once-a-day dashboard insight, and as grounding context for chat so
   Claude answers questions about YOUR numbers instead of guessing. */

const Insights = (() => {

  // Rough, aggregated set-count/week landmarks (MEV = minimum effective volume,
  // MRV = maximum recoverable volume) per muscle bucket — adapted from the
  // set-volume-landmark research popularized in strength & conditioning
  // circles (e.g. Renaissance Periodization's per-muscle-group work), summed
  // across whatever muscles Bedrock's coarser push/pull/legs/core buckets
  // cover. These are intentionally wide bands, not a precise prescription —
  // see the caveat baked into the caption text below.
  const VOLUME_LANDMARKS = {
    push: { mev: 10, mrv: 34 },
    pull: { mev: 10, mrv: 30 },
    legs: { mev: 10, mrv: 40 },
    core: { mev: 4, mrv: 25 }
  };

  // Total logged SETS per muscle bucket in the last 7 days — the unit these
  // volume landmarks are actually published in (unlike muscleVolumeBreakdown's
  // weight×reps tonnage, which isn't comparable across people/exercises).
  function weeklySetsByMuscle(profile) {
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    const byMuscle = {};
    (profile.history.workouts || []).filter(w => w.date >= cutoff).forEach(w => {
      (w.exercises || []).forEach(ex => {
        const def = Workout.EX.find(e => e.id === ex.id) || (profile.customExercises || []).find(e => e.id === ex.id);
        const muscle = def ? def.muscle : 'other';
        byMuscle[muscle] = (byMuscle[muscle] || 0) + (ex.sets || []).length;
      });
    });
    return byMuscle;
  }

  // One-line read on whether this week's set counts land in, under, or over
  // the rough landmark band for each bucket that has a defined one.
  function volumeLandmarkNote(profile) {
    const sets = weeklySetsByMuscle(profile);
    const notes = Object.entries(VOLUME_LANDMARKS)
      .filter(([muscle]) => sets[muscle] != null)
      .map(([muscle, band]) => {
        const n = sets[muscle];
        if (n < band.mev) return `${muscle} is under its minimum-effective band (${n} of ~${band.mev}+ sets/wk) — probably too little to drive progress there.`;
        if (n > band.mrv) return `${muscle} is above its typical recoverable ceiling (${n} vs ~${band.mrv} sets/wk) — fine occasionally, but not sustainable every week.`;
        return null;
      })
      .filter(Boolean);
    if (!notes.length) return null;
    return notes[0] + ' Rough, aggregated bands (📊 from your logs) — not a precise prescription.';
  }

  function muscleVolumeBreakdown(profile, days = 28) {
    const cutoff = Date.now() - days * 24 * 3600 * 1000;
    const byMuscle = {};
    (profile.history.workouts || []).filter(w => w.date >= cutoff).forEach(w => {
      (w.exercises || []).forEach(ex => {
        const def = Workout.EX.find(e => e.id === ex.id) || (profile.customExercises || []).find(e => e.id === ex.id);
        const muscle = def ? def.muscle : 'other';
        const vol = (ex.sets || []).reduce((a, s) => a + (Number(s.weight) || 0) * (Number(s.reps) || 0), 0);
        byMuscle[muscle] = (byMuscle[muscle] || 0) + vol;
      });
    });
    return byMuscle;
  }

  function exercisePRs(profile) {
    const prs = {};
    (profile.history.workouts || []).forEach(w => {
      (w.exercises || []).forEach(ex => {
        (ex.sets || []).forEach(s => {
          const weight = Number(s.weight) || 0;
          if (weight && (!prs[ex.id] || weight > prs[ex.id].weight)) {
            prs[ex.id] = { name: ex.name, weight, reps: Number(s.reps) || 0, date: w.date };
          }
        });
      });
    });
    return prs;
  }

  function exerciseSeries(profile, exerciseId) {
    return (profile.history.workouts || [])
      .map(w => {
        const ex = (w.exercises || []).find(e => e.id === exerciseId);
        const weights = ex ? (ex.sets || []).map(s => Number(s.weight) || 0).filter(Boolean) : [];
        if (!weights.length) return null;
        return { date: w.date, weight: Math.max(...weights) };
      })
      .filter(Boolean);
  }

  function loggedExerciseOptions(profile) {
    const seen = new Map();
    (profile.history.workouts || []).forEach(w => (w.exercises || []).forEach(ex => {
      if ((ex.sets || []).some(s => s.weight)) seen.set(ex.id, ex.name);
    }));
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }

  function trendCaption(series, unit = 'lb') {
    if (series.length < 2) return 'Log a couple more sessions to see a trend here.';
    const first = series[0].weight, last = series[series.length - 1].weight;
    const diff = Math.round((last - first) * 10) / 10;
    if (diff > 0) return `Up ${diff} ${unit} since your first logged set — progressive overload is working.`;
    if (diff < 0) return `Down ${Math.abs(diff)} ${unit} since your first logged set — check recovery, sleep, or whether the weight jumped too fast.`;
    return `Holding steady at ${last} ${unit} — due for a small jump if reps have felt easy.`;
  }

  function muscleBalanceCaption(byMuscle, profile) {
    const entries = Object.entries(byMuscle);
    if (!entries.length) return 'Log a few sessions to see how volume is spread across muscle groups.';
    entries.sort((a, b) => b[1] - a[1]);
    const [topMuscle] = entries[0];
    const [lowMuscle] = entries[entries.length - 1];
    // A landmark call-out (under/over the rough weekly-set band) is the more
    // actionable read when there's one to make — it says WHAT to do, not just
    // which bucket has more tonnage this month. Falls back to the balance
    // comparison when nothing's clearly outside a band, or no profile is passed.
    const landmark = profile ? volumeLandmarkNote(profile) : null;
    if (landmark) return landmark;
    if (entries.length < 2 || topMuscle === lowMuscle) return `Most of your recent volume is going to ${topMuscle}.`;
    return `${topMuscle} is getting the most volume lately; ${lowMuscle} is trailing — worth a look if you want balanced results.`;
  }

  function summaryText(profile) {
    const workouts = profile.history.workouts || [];
    const checkins = profile.history.checkins || [];
    const totalVol = Trajectory.volumeSeries(profile).reduce((a, s) => a + s.volume, 0);
    const byMuscle = muscleVolumeBreakdown(profile);
    const prs = exercisePRs(profile);
    const adherence = Trajectory.weeklyAdherence(profile);
    const lines = [];
    lines.push(`Profile: ${profile.name}, goal ${profile.goal}, experience ${profile.exp}, ${profile.days} days/week planned, equipment ${profile.equipment}${(profile.focusAreas || []).length ? `, specialization focus: ${profile.focusAreas.join(' + ')}` : ''}.`);
    lines.push(`Sessions logged (all time): ${workouts.length}. Total volume: ${Math.round(totalVol)} lb-reps. 4-week adherence: ${Math.round(adherence * 100)}%.`);
    lines.push('Volume by muscle group (last 28 days): ' + (Object.entries(byMuscle).map(([m, v]) => `${m} ${Math.round(v)}`).join(', ') || 'none yet'));
    const prLines = Object.values(prs).slice(0, 8).map(p => `${p.name} ${p.weight}lb x ${p.reps}`).join('; ');
    lines.push('Best sets logged: ' + (prLines || 'none yet'));
    if (checkins.length) {
      const first = checkins[0], last = checkins[checkins.length - 1];
      lines.push(`Weight check-ins: first ${first.weight ?? '—'}lb on ${new Date(first.date).toLocaleDateString()}, latest ${last.weight ?? '—'}lb on ${new Date(last.date).toLocaleDateString()}.`);
    }
    const target = Nutrition.dailyTarget(profile);
    if (target) lines.push(`Estimated daily target: ~${target.calories} kcal, ~${target.proteinG}g protein.`);
    if (typeof Fitbit !== 'undefined' && Fitbit.isConnected()) {
      const w = Fitbit.recentWearableSummary(profile);
      if (w) lines.push(`Fitbit (last ${w.days} days): ${w.count} logged activities, ~${w.totalSteps} total steps${w.avgHr ? `, avg heart rate ~${w.avgHr} bpm` : ''}${w.totalDistanceKm ? `, ~${w.totalDistanceKm} km covered` : ''}.`);
    }
    return lines.join('\n');
  }

  function cacheKey(profile) { return `bedrock_insight_${profile.id}_${new Date().toDateString()}`; }

  function ruleBasedInsight(profile) {
    const n = (profile.history.workouts || []).length;
    if (n === 0) return 'Log your first session and this card will start reflecting real trends.';
    const adherence = Math.round(Trajectory.weeklyAdherence(profile) * 100);
    if (adherence >= 80) return `Strong consistency — ${adherence}% of planned sessions logged this month. Keep nudging weight up wherever you're hitting the top of your rep range.`;
    if (adherence >= 40) return `${adherence}% adherence over the last 4 weeks — getting sessions in matters more right now than perfecting the plan.`;
    return `Only ${adherence}% of planned sessions logged lately. Pick the easiest day this week to get back in.`;
  }

  async function getDailyInsight(profile) {
    const key = cacheKey(profile);
    const cached = localStorage.getItem(key);
    if (cached) return { ok: true, text: cached, cached: true };
    if (!Sync.isLoggedIn()) return { ok: true, text: ruleBasedInsight(profile), ruleBased: true };
    const sys = BEDROCK_PERSONA + ' Given a structured data summary, write ONE short daily insight in 1-2 plain sentences: what\'s going well, or one concrete thing to focus on today. No preamble.';
    const res = await BedrockAPI.chat([{ role: 'user', content: summaryText(profile) }], sys);
    if (res.ok && res.text) { localStorage.setItem(key, res.text); return { ok: true, text: res.text }; }
    return { ok: true, text: ruleBasedInsight(profile), ruleBased: true };
  }

  // Real adaptive logic, not AI commentary: an exercise counts as "stalled"
  // when its last 3 logged top-weights haven't moved at all. Workout.js
  // uses this list to actually substitute a fresh exercise for next
  // session — the plan itself changes based on your numbers.
  function stalledExercises(profile, lookback = 3) {
    const stalled = [];
    loggedExerciseOptions(profile).forEach(opt => {
      const series = exerciseSeries(profile, opt.id);
      if (series.length < lookback) return;
      const last = series.slice(-lookback).map(s => s.weight);
      if (last.every(w => w === last[0])) stalled.push({ id: opt.id, name: opt.name, weight: last[0] });
    });
    return stalled;
  }

  // Compares a just-finished session against everything logged BEFORE it
  // (pass the profile before pushing the new workout) so a PR badge is a
  // real "you beat your own best," not just "you logged a weight."
  function checkNewPRs(profileBeforeSave, sessionExercises) {
    const priorBest = exercisePRs(profileBeforeSave);
    const prs = [];
    (sessionExercises || []).forEach(ex => {
      const weights = (ex.sets || []).map(s => Number(s.weight) || 0).filter(Boolean);
      if (!weights.length) return;
      const top = Math.max(...weights);
      const prior = priorBest[ex.id];
      if (!prior) { prs.push({ name: ex.name, weight: top, isFirst: true }); }
      else if (top > prior.weight) { prs.push({ name: ex.name, weight: top, prevWeight: prior.weight, isFirst: false }); }
    });
    return prs;
  }

  // Consecutive weeks (Mon-Sun) with at least one logged session, counted
  // back from the current week. Current week gets a grace period — it
  // doesn't break the streak just because it isn't logged yet.
  function workoutStreak(profile) {
    const workouts = profile.history.workouts || [];
    if (!workouts.length) return 0;
    const weekKey = d => {
      const dt = new Date(d);
      const day = (dt.getDay() + 6) % 7; // Mon=0..Sun=6
      dt.setHours(0, 0, 0, 0);
      dt.setDate(dt.getDate() - day);
      return dt.getTime();
    };
    const weeks = new Set(workouts.map(w => weekKey(w.date)));
    const oneWeek = 7 * 24 * 3600 * 1000;
    let cursor = weekKey(Date.now());
    if (!weeks.has(cursor)) cursor -= oneWeek; // this week not logged yet — grace, check last week
    let streak = 0;
    while (weeks.has(cursor)) { streak++; cursor -= oneWeek; }
    return streak;
  }

  return {
    muscleVolumeBreakdown, weeklySetsByMuscle, volumeLandmarkNote, exercisePRs, exerciseSeries, loggedExerciseOptions,
    trendCaption, muscleBalanceCaption, summaryText, getDailyInsight, stalledExercises,
    checkNewPRs, workoutStreak
  };
})();
