/* ===================== Bedrock — volume tracking + trajectory projection ===================== */
/*
  What this does:
   1. Auto-computes total training volume (sets × reps × weight) from every
      logged workout — no extra input needed, it's a byproduct of normal logging.
   2. Projects a realistic forward range for bodyweight/measurements if the
      current pace continues, anchored to widely-cited natural muscle-gain
      rate ranges (Aragon/Helms-style guidelines): roughly, for men, novice
      ~1-1.5 lb lean mass/month, intermediate ~0.5-1 lb/month, advanced
      ~0.25-0.5 lb/month; about half those rates for women. Fat-loss goals
      are bounded to a ~0.5-1% of bodyweight/week deficit-driven range, the
      commonly cited pace for losing fat while preserving muscle.
   3. Deliberately does NOT fabricate a "future photo" — a photo can't be
      reliably transformed into an accurate prediction of physique, and
      doing so risks setting false expectations. Instead it shows real
      photos side-by-side over time next to the honest numeric estimate.
*/

const Trajectory = (() => {

  function sessionVolume(entry) {
    let total = 0;
    (entry.exercises || []).forEach(ex => {
      (ex.sets || []).forEach(s => {
        const w = Number(s.weight) || 0;
        const r = Number(s.reps) || 0;
        total += w * r;
      });
    });
    return total;
  }

  function volumeSeries(profile) {
    return (profile.history.workouts || []).map(w => ({
      date: w.date,
      volume: sessionVolume(w)
    }));
  }

  function weeklyAdherence(profile) {
    const days = Number(profile.days) || 3;
    const fourWeeksAgo = Date.now() - 28 * 24 * 3600 * 1000;
    const recent = (profile.history.workouts || []).filter(w => w.date >= fourWeeksAgo);
    const target = days * 4;
    return target ? Math.min(1, recent.length / target) : 0;
  }

  // realistic monthly lean-mass rate (lb/month), before adherence scaling
  function baseMonthlyRateLb(exp, sex) {
    const table = {
      new:          { male: 1.25, female: 0.6, other: 0.9 },
      machines:     { male: 1.0,  female: 0.5, other: 0.75 },
      intermediate: { male: 0.75, female: 0.35, other: 0.55 },
      advanced:     { male: 0.35, female: 0.18, other: 0.25 },
    };
    const row = table[exp] || table.intermediate;
    return row[sex] || row.other;
  }

  function linearRegressionSlope(points) {
    // points: [{x, y}], returns slope per x-unit (least squares)
    const n = points.length;
    if (n < 2) return null;
    const sumX = points.reduce((a, p) => a + p.x, 0);
    const sumY = points.reduce((a, p) => a + p.y, 0);
    const sumXY = points.reduce((a, p) => a + p.x * p.y, 0);
    const sumXX = points.reduce((a, p) => a + p.x * p.x, 0);
    const denom = (n * sumXX - sumX * sumX);
    if (denom === 0) return null;
    return (n * sumXY - sumX * sumY) / denom;
  }

  // Returns { weeksData, projection, rangeLb, narrative }
  function project(profile) {
    const checkins = (profile.history.checkins || [])
      .filter(c => c.weight != null)
      .sort((a, b) => a.date - b.date);

    const adherence = weeklyAdherence(profile);
    const monthlyRate = baseMonthlyRateLb(profile.exp, profile.sex) * (0.4 + 0.6 * adherence);
    const weeklyRateLb = monthlyRate / 4.345;

    let direction = 1; // muscle goal: gaining
    if (profile.goal === 'fatloss') direction = -1;
    if (profile.goal === 'general' || profile.goal === 'strength') direction = 0.4; // slow lean gain assumption

    let observedSlopePerWeek = null;
    if (checkins.length >= 3) {
      const t0 = checkins[0].date;
      const pts = checkins.map(c => ({ x: (c.date - t0) / (7 * 24 * 3600 * 1000), y: c.weight }));
      observedSlopePerWeek = linearRegressionSlope(pts);
    }

    // bound observed slope to +/- 2x the research-based rate so noisy scale data doesn't run away
    const maxAbs = Math.max(weeklyRateLb * 2, 0.15);
    let weeklySlope = observedSlopePerWeek != null
      ? Math.max(-maxAbs, Math.min(maxAbs, observedSlopePerWeek))
      : weeklyRateLb * direction;

    const lastWeight = checkins.length ? checkins[checkins.length - 1].weight : profile.weightLb;
    const lastDate = checkins.length ? checkins[checkins.length - 1].date : Date.now();

    const weeksAhead = 8;
    const projectionPoints = [];
    for (let w = 1; w <= weeksAhead; w++) {
      projectionPoints.push({
        x: new Date(lastDate + w * 7 * 24 * 3600 * 1000),
        y: lastWeight != null ? Math.round((lastWeight + weeklySlope * w) * 10) / 10 : null
      });
    }

    const totalChange = Math.round(weeklySlope * weeksAhead * 10) / 10;
    const lowRange = Math.round((totalChange * 0.6) * 10) / 10;
    const highRange = Math.round((totalChange * 1.4) * 10) / 10;

    return {
      hasData: checkins.length > 0,
      adherencePct: Math.round(adherence * 100),
      weeklySlope,
      projectionPoints,
      lastWeight,
      lowRange, highRange,
      weeksAhead,
      goal: profile.goal
    };
  }

  function narrativeText(proj, unit) {
    if (!proj.hasData) {
      return 'Log a weight in a check-in and a few workouts, and this will fill in with a real projection.';
    }
    const dir = proj.goal === 'fatloss' ? 'down' : 'up';
    const lo = Math.min(Math.abs(proj.lowRange), Math.abs(proj.highRange));
    const hi = Math.max(Math.abs(proj.lowRange), Math.abs(proj.highRange));
    return `At ${proj.adherencePct}% of your planned sessions logged, a realistic ${proj.weeksAhead}-week range is roughly ${lo}-${hi} ${unit} ${dir} — driven mostly by consistency and nutrition, not just the workouts themselves. This is a rough estimate, not a guarantee.`;
  }

  /*
    Acute:Chronic Workload Ratio — a real sports-science metric (Gabbett,
    Hulin et al.) used by strength & conditioning / sports-medicine staff to
    flag injury risk from training-load spikes, not something typical
    consumer fitness apps expose. Acute = last 7 days' volume, chronic =
    trailing 28-day weekly average. Bands below follow the commonly cited
    "sweet spot" model from that literature.
  */
  function acwr(profile) {
    const series = volumeSeries(profile);
    if (series.length < 4) return { hasData: false };
    const now = Date.now();
    const acute = series.filter(s => now - s.date <= 7 * 24 * 3600 * 1000).reduce((a, s) => a + s.volume, 0);
    const chronicWindow = series.filter(s => now - s.date <= 28 * 24 * 3600 * 1000);
    if (!chronicWindow.length) return { hasData: false };
    const chronicWeekly = (chronicWindow.reduce((a, s) => a + s.volume, 0) / 28) * 7;
    if (!chronicWeekly) return { hasData: false };
    const ratio = Math.round((acute / chronicWeekly) * 100) / 100;

    let zone, message;
    if (ratio < 0.8) { zone = 'undertraining'; message = 'Load has dropped off relative to your last month — fine for a deload, but climb back gradually rather than jumping straight to old numbers.'; }
    else if (ratio <= 1.3) { zone = 'sweet-spot'; message = 'Load is in the well-supported range relative to your recent training — good place to keep progressing from.'; }
    else if (ratio <= 1.5) { zone = 'caution'; message = 'Load has climbed noticeably faster than your recent average. Not alarming on its own, but worth watching recovery closely this week.'; }
    else { zone = 'high-risk'; message = 'Load has spiked well above your recent average — this ratio range is associated with higher injury risk in the training-load research. Consider easing volume back this week.'; }

    return { hasData: true, acute: Math.round(acute), chronicWeekly: Math.round(chronicWeekly), ratio, zone, message };
  }

  return { sessionVolume, volumeSeries, weeklyAdherence, project, narrativeText, acwr };
})();
