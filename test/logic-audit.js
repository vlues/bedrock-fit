/* Node-based smoke test for Bedrock's pure-logic modules (store, workout,
   trajectory, insights, nutrition). Not a full browser test — DOM-heavy
   app.js/scan.js/chart.js/camera.js are excluded — but this catches real
   runtime bugs in the data/logic layer before handoff. Run: node test/logic-audit.js */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('FAIL:', msg); } }
function ok(msg) { console.log('ok  -', msg); }

// ---- minimal browser stub ----
const store = {};
const sandbox = {
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  console,
  crypto: require('crypto').webcrypto,
  fetch: async () => ({ ok: false, status: 599, text: async () => '', json: async () => ({}) }),
  document: { documentElement: {}, getElementById: () => null },
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  navigator: { mediaDevices: undefined },
  location: { href: 'https://example.github.io/bedrock-fit/', pathname: '/bedrock-fit/', search: '' },
  history: { replaceState: () => {} },
  alert: () => {}
};
vm.createContext(sandbox);

// vm's runInContext doesn't expose top-level const/let as globals (only
// `var`/functions do), and these files use `const X = (() => {...})();` —
// so concatenate them into one script and explicitly export what we need.
const files = ['js/store.js', 'js/api.js', 'js/workout.js', 'js/supplements.js', 'js/trajectory.js', 'js/fitbit.js', 'js/nutrition.js', 'js/insights.js'];
const combined = files.map(f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n;\n')
  + '\n;\nthis.__EXPORTS__ = { Store, Workout, Trajectory, Insights, Nutrition, Fitbit, SupplementList };';
vm.runInContext(combined, sandbox, { filename: 'combined.js' });

const { Store, Workout, Trajectory, Insights, Nutrition, Fitbit, SupplementList } = sandbox.__EXPORTS__;

// ---- unit conversions round-trip ----
assert(Math.abs(Store.kgToLb(Store.lbToKg(180)) - 180) < 0.001, 'lb<->kg round-trip');
assert(Math.abs(Store.cmToIn(Store.inToCm(70)) - 70) < 0.001, 'in<->cm round-trip');
assert(Store.ftInToIn(5, 9) === 69, 'ftIn helper');
ok('unit conversions');

// ---- profile factory + shape ----
const p = Store.createBlankProfile();
assert(Array.isArray(p.history.workouts) && Array.isArray(p.history.meals), 'blank profile has full history shape');
p.name = 'Test'; p.age = 27; p.sex = 'male'; p.weightLb = 180; p.heightIn = 70;
ok('createBlankProfile shape');

// ---- Workout: every days/equipment/exp/goal combo must produce a usable plan ----
const daysOpts = [2, 3, 4, 5, 6];
const equipOpts = ['full', 'machines', 'dumbbell', 'bodyweight'];
const expOpts = ['new', 'machines', 'intermediate', 'advanced'];
const goalOpts = ['muscle', 'strength', 'fatloss', 'general'];
daysOpts.forEach(days => equipOpts.forEach(equipment => expOpts.forEach(exp => goalOpts.forEach(goal => {
  const prof = { ...Store.createBlankProfile(), days, equipment, exp, goal, limitations: '' };
  let plan;
  try { plan = Workout.buildWeekPlan(prof); }
  catch (e) { failures++; console.error(`FAIL: buildWeekPlan threw for days=${days} equip=${equipment} exp=${exp} goal=${goal}:`, e.message); return; }
  if (plan.length !== days) { failures++; console.error(`FAIL: plan length ${plan.length} !== days ${days}`); }
  plan.forEach(day => {
    if (!day.exercises.length) { failures++; console.error(`FAIL: empty day for days=${days} equip=${equipment} exp=${exp} goal=${goal} label=${day.label}`); }
  });
}))));
ok('Workout.buildWeekPlan across all days/equipment/exp/goal combos');

// ---- Workout: limitation filters shouldn't ever wipe the pool to zero ----
['bad knee', 'shoulder impingement', 'lower back issue', 'no overhead press, bad knee and shoulder'].forEach(lim => {
  const prof = { ...Store.createBlankProfile(), limitations: lim };
  const plan = Workout.buildWeekPlan(prof);
  plan.forEach(day => assert(day.exercises.length > 0, `limitations "${lim}" left a day empty`));
});
ok('Workout limitation-filter fallback never empties a day');

// ---- Workout: custom exercises fold in and can be swapped for plateaued lifts ----
const profCustom = { ...Store.createBlankProfile(), customExercises: [{ id: 'custom_1', name: 'Cybex Leg Press', muscle: 'legs', equip: ['full', 'machines', 'dumbbell', 'bodyweight'], custom: true }] };
const poolWithCustom = Workout.exercisesFor('legs', 'full', '', profCustom.customExercises);
assert(poolWithCustom.some(e => e.id === 'custom_1'), 'custom exercise appears in pool');
const swappedPlan = Workout.buildWeekPlan({ ...profCustom, days: 3 }, [{ id: 'legpress', name: 'Leg Press' }]);
const legsDay = swappedPlan.find(d => d.exercises.some(e => e.muscle === 'legs'));
assert(legsDay, 'a leg day exists to check swap logic against');
ok('custom exercises + stalled-exercise swap wiring');

// ---- Trajectory: simulate a synthetic training history ----
const histProf = { ...Store.createBlankProfile(), weightLb: 180, heightIn: 70, age: 27, sex: 'male', goal: 'muscle', exp: 'new', days: 3 };
const now = Date.now();
for (let i = 0; i < 20; i++) {
  const daysAgo = (20 - i) * 3;
  histProf.history.workouts.push({
    dayIndex: i % 3, label: 'Session', date: now - daysAgo * 24 * 3600 * 1000,
    exercises: [
      { id: 'benchpress', name: 'Barbell Bench Press', targetRepsMin: 8, sets: [{ reps: 8, weight: 95 + i }, { reps: 8, weight: 95 + i }] },
      { id: 'legpress', name: 'Leg Press', targetRepsMin: 8, sets: [{ reps: 10, weight: 150 }, { reps: 10, weight: 150 }] } // flat -> should trigger plateau
    ]
  });
}
assert(Trajectory.volumeSeries(histProf).length === 20, 'volumeSeries length matches logged sessions');
const adherence = Trajectory.weeklyAdherence(histProf);
assert(adherence >= 0 && adherence <= 1, `adherence in [0,1], got ${adherence}`);
const acwr = Trajectory.acwr(histProf);
assert(acwr.hasData, 'ACWR has data with 20 sessions over 60 days');
assert(['undertraining', 'sweet-spot', 'caution', 'high-risk'].includes(acwr.zone), 'ACWR zone is one of the defined bands');
ok('Trajectory volume/adherence/ACWR on synthetic history');

// ---- Trajectory: empty-history edge case must not throw ----
const emptyProf = Store.createBlankProfile();
assert(Trajectory.acwr(emptyProf).hasData === false, 'ACWR gracefully reports no data when empty');
const emptyProj = Trajectory.project(emptyProf);
assert(emptyProj.hasData === false, 'project() handles no check-ins without throwing');
ok('Trajectory empty-history edge cases');

// ---- Insights: plateau detection on the synthetic history ----
const stalled = Insights.stalledExercises(histProf);
assert(stalled.some(s => s.id === 'legpress'), 'flat leg-press weight is detected as stalled');
assert(!stalled.some(s => s.id === 'benchpress'), 'increasing bench weight is NOT flagged as stalled');
ok('Insights.stalledExercises correctness');

const breakdown = Insights.muscleVolumeBreakdown(histProf);
assert(breakdown.legs > 0 && breakdown.push > 0, 'muscle volume breakdown has legs and push entries');
const prs = Insights.exercisePRs(histProf);
assert(prs.benchpress && prs.benchpress.weight >= 95, 'PR tracking finds the top bench weight');
const summary = Insights.summaryText(histProf);
assert(typeof summary === 'string' && summary.length > 20, 'summaryText produces real text');
ok('Insights aggregate functions on synthetic history');

// ---- Nutrition: full profile + missing-data edge case ----
const target = Nutrition.dailyTarget(histProf);
assert(target && target.calories > 1000 && target.calories < 6000, `dailyTarget calories in sane range, got ${target && target.calories}`);
assert(target.proteinG > 0, 'protein target positive');
const incompleteProf = Store.createBlankProfile();
assert(Nutrition.dailyTarget(incompleteProf) === null, 'dailyTarget returns null (not throw) when weight/height/age missing');
['male', 'female', 'other'].forEach(sex => {
  const t = Nutrition.dailyTarget({ ...histProf, sex });
  assert(t && t.calories > 0, `dailyTarget works for sex=${sex}`);
});
ok('Nutrition.dailyTarget sane values + missing-data + sex branches');

const waterTarget = Nutrition.waterTargetMl(histProf);
assert(waterTarget > 1000 && waterTarget < 6000, `water target sane, got ${waterTarget}`);
ok('Nutrition.waterTargetMl sane value');

// ---- Nutrition: meal memory / frequent meals ----
const mealProf = Store.createBlankProfile();
for (let i = 0; i < 3; i++) Nutrition.addMeal(mealProf, { name: 'Chicken and rice', calories: 550, proteinG: 45 });
Nutrition.addMeal(mealProf, { name: 'Protein shake', calories: 200, proteinG: 30 });
const freq = Nutrition.frequentMeals(mealProf);
assert(freq.some(m => m.name === 'Chicken and rice'), 'frequent meal detected after 3 logs');
assert(!freq.some(m => m.name === 'Protein shake'), 'one-off meal not flagged as frequent (needs >=2)');
ok('Nutrition.frequentMeals threshold logic');

// ---- Supplements: static data sanity ----
assert(SupplementList.length > 0, 'supplement list non-empty');
SupplementList.forEach(s => {
  assert(['strong', 'moderate', 'limited'].includes(s.evidence), `supplement ${s.id} has a valid evidence tag`);
  assert(s.dose && s.what, `supplement ${s.id} has dose + description`);
});
ok('SupplementList data integrity');

// ---- Fitbit: PKCE + redirect helpers must not throw without a real browser ----
Store.setApiKey(''); // ensure clean
assert(Fitbit.isConnected() === false, 'Fitbit reports disconnected with no stored token');
ok('Fitbit module loads and reports state correctly with no token');

// ---- Workout: exercise exclusion (shuffle) filters the pool, with a safe fallback ----
const poolBefore = Workout.exercisesFor('legs', 'full', '', [], []);
const excludeAllButOne = poolBefore.slice(1).map(e => e.id);
const poolAfter = Workout.exercisesFor('legs', 'full', '', [], excludeAllButOne);
assert(poolAfter.length === 1 && poolAfter[0].id === poolBefore[0].id, 'excluding all-but-one leaves exactly the un-excluded exercise');
const poolAllExcluded = Workout.exercisesFor('legs', 'full', '', [], poolBefore.map(e => e.id));
assert(poolAllExcluded.length > 0, 'excluding every option in a muscle group still falls back to a non-empty pool');
const planWithExclusion = Workout.buildWeekPlan({ ...Store.createBlankProfile(), excludedExercises: ['legpress', 'squat'], days: 3 });
planWithExclusion.forEach(day => assert(!day.exercises.some(e => e.id === 'legpress' || e.id === 'squat'), 'excluded exercises never appear in a generated week plan'));
ok('Workout exercise exclusion (shuffle) logic');

// ---- Workout: rest-interval seconds are sane and goal-differentiated ----
assert(Workout.restSecondsFor('strength') > Workout.restSecondsFor('fatloss'), 'strength rest interval is longer than fat-loss rest interval');
assert(Workout.restSecondsFor('unknown-goal') > 0, 'restSecondsFor falls back to a sane default for an unrecognized goal');
ok('Workout.restSecondsFor sane, goal-differentiated values');

// ---- Insights: PR detection compares against PRIOR history only, and streak counts consecutive weeks ----
const priorHistoryProf = { ...Store.createBlankProfile(), history: { ...Store.createBlankProfile().history, workouts: [
  { dayIndex: 0, label: 'Session', date: now - 5 * 24 * 3600 * 1000, exercises: [{ id: 'benchpress', name: 'Barbell Bench Press', sets: [{ reps: 8, weight: 100 }] }] }
] } };
const newPRs = Insights.checkNewPRs(priorHistoryProf, [{ id: 'benchpress', name: 'Barbell Bench Press', sets: [{ reps: 8, weight: 110 }] }]);
assert(newPRs.length === 1 && newPRs[0].weight === 110 && newPRs[0].prevWeight === 100, 'checkNewPRs flags a beaten prior best with correct before/after weights');
const noNewPRs = Insights.checkNewPRs(priorHistoryProf, [{ id: 'benchpress', name: 'Barbell Bench Press', sets: [{ reps: 8, weight: 90 }] }]);
assert(noNewPRs.length === 0, 'checkNewPRs does not flag a weight below the prior best');
const streakProf = Store.createBlankProfile();
for (let w = 0; w < 3; w++) streakProf.history.workouts.push({ dayIndex: 0, label: 'Session', date: now - w * 7 * 24 * 3600 * 1000, exercises: [] });
assert(Insights.workoutStreak(streakProf) === 3, `workoutStreak counts 3 consecutive logged weeks, got ${Insights.workoutStreak(streakProf)}`);
assert(Insights.workoutStreak(Store.createBlankProfile()) === 0, 'workoutStreak is 0 with no logged history');
ok('Insights.checkNewPRs + Insights.workoutStreak correctness');

console.log('\n' + (failures === 0 ? `ALL CHECKS PASSED` : `${failures} CHECK(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
