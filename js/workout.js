/* ===================== Bedrock — workout program engine ===================== */
/*
  Research basis (general, well-established strength & conditioning consensus —
  ACSM position stands, NSCA guidelines, and meta-analyses on training volume):
   - Beginners respond well to full-body sessions 2-3x/week, ~2-3 sets/exercise,
     6-15 rep range, focusing on movement quality before load (Schoenfeld et al.
     on volume; ACSM beginner guidelines).
   - Muscle growth is driven primarily by progressive overload + sufficient
     volume (~10-20 hard sets/muscle/week for most trainees) + proximity to
     failure (1-3 reps in reserve) + adequate protein & recovery.
   - Strength-focused work favors lower rep ranges (3-6) on compound lifts with
     longer rest (2-4 min); hypertrophy favors moderate reps (6-15) with
     shorter rest (60-120s); fat-loss phases keep resistance training volume
     up to preserve muscle while calories are reduced.
   - Split structure scales with weekly frequency: 2-3 days = full body,
     4 days = upper/lower, 5-6 days = push/pull/legs or body-part split.
*/

const Workout = (() => {

  // Exercise DB: tag by muscle group + equipment needed. `cue` is a short,
  // research-grounded form cue shown in-app (see Insights/app.js) — since
  // we can't verify a specific hardcoded video URL stays accurate or live,
  // the "watch a demo" link opens a live YouTube search for the exercise
  // name rather than pointing at one unverified video.
  const EX = [
    // Legs
    { id:'legpress', name:'Leg Press', muscle:'legs', equip:['full','machines'], type:'machine', cue:'Feet shoulder-width on the platform, lower until knees hit ~90°, don\'t let your lower back round off the pad, press through the whole foot.' },
    { id:'squat', name:'Barbell Back Squat', muscle:'legs', equip:['full'], type:'barbell', cue:'Bar on upper traps, brace your core, sit hips back and down, knees track over toes, chest stays up, drive through mid-foot.' },
    { id:'gobletsquat', name:'Goblet Squat', muscle:'legs', equip:['full','dumbbell'], type:'dumbbell', cue:'Hold the dumbbell at chest height, elbows inside knees at the bottom, keep torso upright, sit between your heels.' },
    { id:'legcurl', name:'Seated Leg Curl', muscle:'legs', equip:['full','machines'], type:'machine', cue:'Pad just above the heel, curl under control (no swinging), pause briefly at full contraction.' },
    { id:'legext', name:'Leg Extension', muscle:'legs', equip:['full','machines'], type:'machine', cue:'Pad on the shin above the ankle, extend without locking out violently, control the negative on the way down.' },
    { id:'lunge', name:'Dumbbell Walking Lunge', muscle:'legs', equip:['full','dumbbell'], type:'dumbbell', cue:'Step out far enough that your front knee stays over the ankle, drop the back knee toward the floor, torso stays tall.' },
    { id:'bwsquat', name:'Bodyweight Squat', muscle:'legs', equip:['bodyweight'], type:'bodyweight', cue:'Same pattern as a loaded squat — hips back and down, knees out, heels planted, chest up.' },
    { id:'calfraise', name:'Standing Calf Raise', muscle:'legs', equip:['full','machines','dumbbell','bodyweight'], type:'machine', cue:'Full range — stretch at the bottom, pause at the top, avoid bouncing.' },
    { id:'rdl', name:'Romanian Deadlift (Barbell)', muscle:'legs', equip:['full'], type:'barbell', cue:'Soft knee bend, hinge at the hips pushing them back, bar stays close to your legs, flat back throughout, feel it in the hamstrings.' },
    { id:'dbrdl', name:'Dumbbell RDL', muscle:'legs', equip:['full','dumbbell'], type:'dumbbell', cue:'Same hip-hinge pattern as the barbell version — dumbbells stay close to your shins, flat back, stop when you feel a hamstring stretch.' },

    // Push (chest/shoulders/triceps)
    { id:'benchpress', name:'Barbell Bench Press', muscle:'push', equip:['full'], type:'barbell', cue:'Shoulder blades pulled back and down, slight arch, bar path touches lower chest, elbows ~45° from your torso, drive feet into the floor.' },
    { id:'chestpress', name:'Chest Press Machine', muscle:'push', equip:['full','machines'], type:'machine', cue:'Handles level with mid-chest, press without shrugging your shoulders up, control the return.' },
    { id:'dbbench', name:'Dumbbell Bench Press', muscle:'push', equip:['full','dumbbell'], type:'dumbbell', cue:'Same setup as barbell bench — shoulder blades set, elbows ~45°, don\'t let the dumbbells drift or clang together.' },
    { id:'pushup', name:'Push-Up', muscle:'push', equip:['bodyweight','dumbbell'], type:'bodyweight', cue:'Straight line from head to heels, hands under shoulders, elbows ~45°, chest to just above the floor.' },
    { id:'shoulderpress', name:'Shoulder Press Machine', muscle:'push', equip:['full','machines'], type:'machine', cue:'Seat height so handles start at shoulder level, press straight up without arching your lower back excessively.' },
    { id:'dbshoulderpress', name:'Dumbbell Shoulder Press', muscle:'push', equip:['full','dumbbell'], type:'dumbbell', cue:'Brace your core, press straight overhead (not forward), avoid over-arching the lower back.' },
    { id:'lateralraise', name:'Dumbbell Lateral Raise', muscle:'push', equip:['full','dumbbell'], type:'dumbbell', cue:'Slight elbow bend, raise to about shoulder height leading with the elbows, no swinging or shrugging.' },
    { id:'tricepext', name:'Cable Triceps Pushdown', muscle:'push', equip:['full','machines'], type:'machine', cue:'Elbows pinned to your sides the whole set, extend fully without letting the elbows flare out.' },
    { id:'dips', name:'Bench Dips', muscle:'push', equip:['bodyweight','dumbbell'], type:'bodyweight', cue:'Hands on the bench behind you, lower until elbows hit ~90°, keep shoulders down away from your ears.' },
    { id:'pikepush', name:'Pike Push-Up', muscle:'push', equip:['bodyweight'], type:'bodyweight', cue:'Hips high, form an inverted V, lower the crown of your head toward the floor between your hands.' },

    // Pull (back/biceps)
    { id:'latpulldown', name:'Lat Pulldown Machine', muscle:'pull', equip:['full','machines'], type:'machine', cue:'Slight lean back, pull to upper chest leading with the elbows, avoid using momentum to yank the weight down.' },
    { id:'seatedrow', name:'Seated Cable Row', muscle:'pull', equip:['full','machines'], type:'machine', cue:'Chest up, pull to your lower ribs, squeeze shoulder blades together, don\'t round your back at the stretch.' },
    { id:'pullup', name:'Pull-Up / Assisted Pull-Up', muscle:'pull', equip:['bodyweight','full'], type:'bodyweight', cue:'Full hang at the bottom, pull your chin over the bar leading with the elbows, control the descent.' },
    { id:'dbrow', name:'Dumbbell Row', muscle:'pull', equip:['full','dumbbell'], type:'dumbbell', cue:'Flat back, pull the dumbbell to your hip/ribs (not straight up), avoid twisting your torso for momentum.' },
    { id:'facepull', name:'Face Pull (Cable)', muscle:'pull', equip:['full','machines'], type:'machine', cue:'Pull toward your face with elbows high, rotate your hands back at the end — this is a rear-delt/upper-back exercise, keep it light.' },
    { id:'bicepcurl', name:'Dumbbell Bicep Curl', muscle:'pull', equip:['full','dumbbell'], type:'dumbbell', cue:'Elbows pinned to your sides, curl without swinging your torso, control the lowering phase.' },
    { id:'machinecurl', name:'Machine Bicep Curl', muscle:'pull', equip:['full','machines'], type:'machine', cue:'Upper arms flat on the pad the whole set, full range of motion, no jerking at the bottom.' },
    { id:'invertedrow', name:'Inverted Row (bodyweight)', muscle:'pull', equip:['bodyweight'], type:'bodyweight', cue:'Body in a straight line, pull your chest to the bar, squeeze shoulder blades together at the top.' },

    // Core
    { id:'plank', name:'Plank', muscle:'core', equip:['bodyweight','full','machines','dumbbell'], type:'bodyweight', cue:'Straight line from head to heels, ribs pulled down, don\'t let your hips sag or pike up.' },
    { id:'cablecrunch', name:'Cable Crunch', muscle:'core', equip:['full','machines'], type:'machine', cue:'Kneel below the cable, curl your ribs toward your hips (not just bending forward at the hips), exhale as you crunch.' },
    { id:'hangingleg', name:'Hanging Knee Raise', muscle:'core', equip:['bodyweight','full'], type:'bodyweight', cue:'Hang tall, curl your pelvis up as you raise your knees, avoid swinging — control both directions.' },
  ];

  function exercisesFor(muscle, equipment, limitations, custom, excluded) {
    const limitTxt = (limitations || '').toLowerCase();
    const excludedSet = new Set(excluded || []);
    const fullPool = EX.concat(custom || []); // custom exercises are always considered "available" — the user added them because they have access
    let pool = fullPool.filter(e => e.muscle === muscle && (e.custom || e.equip.includes(equipment)));
    const beforeExclusion = pool;
    pool = pool.filter(e => !excludedSet.has(e.id));
    if (!pool.length) pool = beforeExclusion; // don't let "shuffle away everything" leave a muscle group with zero options
    if (limitTxt.includes('knee')) pool = pool.filter(e => !['squat','legpress','lunge','bwsquat'].includes(e.id));
    if (limitTxt.includes('shoulder') || limitTxt.includes('overhead')) pool = pool.filter(e => !['shoulderpress','dbshoulderpress','pikepush'].includes(e.id));
    if (limitTxt.includes('back') || limitTxt.includes('lower back')) pool = pool.filter(e => !['squat','rdl','dbrdl'].includes(e.id));
    if (!pool.length) pool = fullPool.filter(e => e.muscle === muscle && (e.custom || e.equip.includes(equipment))); // fallback if injury filters wiped it out
    return pool;
  }

  // rep/set/rest scheme by goal
  function schemeFor(goal, exp) {
    const base = {
      muscle:   { sets: 3, reps: '8-12',  rest: '75-90s',  note: 'Push each set to 1-2 reps shy of failure.' },
      strength: { sets: 4, reps: '4-6',   rest: '2-3 min', note: 'Heavier load, full recovery between sets.' },
      fatloss:  { sets: 3, reps: '10-15', rest: '45-75s',  note: 'Keep rest shorter to keep total work high.' },
      general:  { sets: 3, reps: '10-12', rest: '60-90s',  note: 'Consistency matters more than intensity here.' },
    }[goal] || { sets: 3, reps: '10-12', rest: '60-90s', note: '' };
    if (exp === 'new') { base.sets = Math.max(2, base.sets - 1); base.note = 'Focus on clean form over weight. ' + base.note; }
    return base;
  }

  // Build a weekly split: array of days, each { label, muscles: [...] }
  function splitFor(days, exp) {
    if (days <= 3) {
      return Array.from({ length: days }).map((_, i) => ({ label: `Full Body ${i + 1}`, muscles: ['legs', 'push', 'pull', 'core'] }));
    }
    if (days === 4) {
      return [
        { label: 'Upper A', muscles: ['push', 'pull'] },
        { label: 'Lower A', muscles: ['legs', 'core'] },
        { label: 'Upper B', muscles: ['push', 'pull'] },
        { label: 'Lower B', muscles: ['legs', 'core'] },
      ];
    }
    // 5-6 days: push/pull/legs, repeated
    const ppl = [
      { label: 'Push', muscles: ['push', 'core'] },
      { label: 'Pull', muscles: ['pull'] },
      { label: 'Legs', muscles: ['legs'] },
    ];
    return Array.from({ length: days }).map((_, i) => ppl[i % 3]);
  }

  function exercisesPerMuscleForDay(exp, muscle, focusAreas) {
    // how many exercises to pick per muscle group in a given day
    const base = exp === 'new' ? 1 : (exp === 'advanced' ? 3 : 2);
    // Specialization: research on training volume (e.g. dose-response
    // studies on sets/muscle/week) supports giving a chosen muscle group
    // extra volume rather than spreading it evenly — this is that, applied
    // as +1 exercise on days that hit a focus-area muscle.
    const isFocus = (focusAreas || []).includes(muscle);
    return isFocus ? base + 1 : base;
  }

  // stalledIds: exercise ids that have gone 3 straight sessions with no
  // weight increase (see Insights.stalledExercises) — when present, the
  // generator itself swaps in a fresh alternative from the same muscle
  // pool instead of just repeating a plateaued lift. This is the plan
  // actually adapting to your numbers, not commentary about them.
  function buildWeekPlan(profile, stalledIds) {
    stalledIds = stalledIds || [];
    const stalledSet = new Set(stalledIds.map(s => (typeof s === 'string' ? s : s.id)));
    const days = Number(profile.days) || 3;
    const split = splitFor(days, profile.exp);
    const scheme = schemeFor(profile.goal, profile.exp);

    return split.map((day, idx) => {
      const exercises = [];
      day.muscles.forEach(muscle => {
        const perMuscle = exercisesPerMuscleForDay(profile.exp, muscle, profile.focusAreas);
        const pool = exercisesFor(muscle, profile.equipment, profile.limitations, profile.customExercises, profile.excludedExercises);
        // deterministic-ish rotation using planSeed so both partners on same settings don't get identical lists
        const seed = (profile.planSeed || 0) + idx;
        const rotated = pool.slice(seed % Math.max(1, pool.length)).concat(pool.slice(0, seed % Math.max(1, pool.length)));
        let picks = rotated.slice(0, Math.min(perMuscle, pool.length));
        picks = picks.map(ex => {
          if (!stalledSet.has(ex.id)) return ex;
          const alt = pool.find(p => p.id !== ex.id && !picks.some(pk => pk.id === p.id));
          return alt ? { ...alt, swappedFor: ex.name } : ex;
        });
        picks.forEach(ex => exercises.push(ex));
      });
      return {
        dayIndex: idx,
        label: day.label,
        exercises: exercises.map(ex => ({ ...ex, sets: scheme.sets, reps: scheme.reps, rest: scheme.rest })),
        note: scheme.note
      };
    });
  }

  // sessionOffset: user-controlled "slide" through the rotation (see the
  // Not-today button on Home) — missing a day never needs a fake logged
  // workout to move on, and sliding is cyclical so nothing is ever lost.
  function todaysSession(profile, stalledIds) {
    const plan = buildWeekPlan(profile, stalledIds);
    const completed = (profile.history.workouts || []).length;
    const idx = (completed + (profile.sessionOffset || 0)) % plan.length;
    return plan[idx];
  }

  // Suggest a weight for an exercise from logged performance — double-progression
  // auto-regulation, not just "repeat last time":
  //  - hit the top of the rep range on every set last session → nudge up ~2.5-5%
  //    (classic double-progression: raise weight only after earning it with reps)
  //  - missed the rep range on the SAME weight for the last two logged sessions in
  //    a row → back off ~10% instead of asking for a third grind at a weight
  //    that's stalled (a small, standard autoregulation deload, not just
  //    silently repeating a number that isn't working)
  //  - anything else → hold at last week's weight
  function suggestWeight(profile, exerciseId) {
    const workouts = profile.history.workouts || [];
    const logged = [];
    for (let i = workouts.length - 1; i >= 0 && logged.length < 2; i--) {
      const entry = workouts[i].exercises?.find(e => e.id === exerciseId);
      if (entry && entry.sets?.length) logged.push(entry);
    }
    if (!logged.length) return null; // no history yet

    const last = logged[0];
    const lastWeights = last.sets.map(s => Number(s.weight) || 0);
    const lastReps = last.sets.map(s => Number(s.reps) || 0);
    const topWeight = Math.max(...lastWeights);
    if (topWeight <= 0) return null;
    const hitTopReps = lastReps.every(r => r >= (last.targetRepsMin || 8));
    if (hitTopReps) {
      const bump = Math.max(2.5, Math.round(topWeight * 0.03));
      return Math.round((topWeight + bump) * 2) / 2; // round to nearest 0.5
    }

    const prev = logged[1];
    if (prev) {
      const prevTopWeight = Math.max(...prev.sets.map(s => Number(s.weight) || 0));
      const prevReps = prev.sets.map(s => Number(s.reps) || 0);
      const prevMissed = !prevReps.every(r => r >= (prev.targetRepsMin || 8));
      // Two in a row at the same (or higher) weight, neither hitting the range.
      if (prevMissed && prevTopWeight >= topWeight - 0.01) {
        const deload = Math.round((topWeight * 0.9) * 2) / 2;
        return Math.max(deload, 2.5);
      }
    }
    return topWeight; // hold — one missed session isn't a trend yet
  }

  // Numeric rest-interval seconds matching the ranges already shown in
  // schemeFor() above — strength work needs longer full recovery between
  // heavy sets, hypertrophy/fat-loss work benefits from shorter rest to
  // keep total session volume/density up (standard resistance-training
  // guidance, e.g. NSCA rest-interval recommendations by training goal).
  function restSecondsFor(goal) {
    return { muscle: 90, strength: 150, fatloss: 60, general: 75 }[goal] || 75;
  }

  return { EX, exercisesFor, schemeFor, splitFor, buildWeekPlan, todaysSession, suggestWeight, restSecondsFor };
})();
