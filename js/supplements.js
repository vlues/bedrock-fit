/* ===================== Bedrock — supplement guide (educational only) ===================== */
/* Dosing ranges reflect commonly cited research consensus (e.g. ISSN position
   stands, meta-analyses). This is general education, not a prescription —
   individual needs vary, and this app never claims to replace medical advice. */

const SupplementList = [
  {
    id: 'protein',
    name: 'Whey / Plant Protein Powder',
    goals: ['muscle', 'fatloss', 'performance'],
    evidence: 'strong',
    what: 'A convenient way to hit daily protein targets when food alone is hard to fit in.',
    dose: 'Total daily protein ~1.6-2.2 g per kg bodyweight (research-supported range for muscle building); powder just fills the gap between food and that number.',
    timing: 'Anytime — total daily intake matters far more than timing around workouts.',
    caution: 'Whole food first. Check with a doctor if you have kidney disease.'
  },
  {
    id: 'creatine',
    name: 'Creatine Monohydrate',
    goals: ['muscle', 'performance'],
    evidence: 'strong',
    what: 'One of the most researched supplements in sports science — supports strength, power output, and lean mass gains over time.',
    dose: '3-5 g per day, every day (no need to cycle). Loading phases speed onset but aren’t required.',
    timing: 'Any time of day, consistency matters more than timing.',
    caution: 'Causes water retention in muscle (normal, not fat). Drink enough water. Skip if you have kidney issues without medical clearance.'
  },
  {
    id: 'caffeine',
    name: 'Caffeine',
    goals: ['performance', 'fatloss'],
    evidence: 'strong',
    what: 'Reliable, well-studied performance booster — improves strength output, endurance, and focus in training.',
    dose: '~3-6 mg per kg bodyweight, about 30-60 min pre-workout.',
    timing: 'Pre-workout; avoid within ~6-8 hours of bedtime.',
    caution: 'Can raise heart rate/anxiety in sensitive people. Watch total intake from coffee/pre-workout combined.'
  },
  {
    id: 'creatine_alt',
    name: 'Multivitamin',
    goals: ['health'],
    evidence: 'moderate',
    what: 'Insurance against gaps in a busy or imperfect diet — not a performance enhancer.',
    dose: 'Per label, once daily with food.',
    timing: 'With a meal for better absorption of fat-soluble vitamins.',
    caution: 'Not a substitute for eating a varied diet. More isn’t better — avoid megadosing fat-soluble vitamins (A, D, E, K).'
  },
  {
    id: 'betaalanine',
    name: 'Beta-Alanine',
    goals: ['performance'],
    evidence: 'moderate',
    what: 'May help with muscular endurance in the 1-4 minute effort range (higher rep sets, circuits).',
    dose: '3.2-6.4 g per day, split into smaller doses.',
    timing: 'Any time, consistently, for at least 2-4 weeks to build up.',
    caution: 'Causes a harmless tingling sensation (paresthesia) at higher single doses — split the dose to reduce it.'
  },
  {
    id: 'fishoil',
    name: 'Fish Oil / Omega-3',
    goals: ['health'],
    evidence: 'moderate',
    what: 'General cardiovascular and joint-health support; some evidence for reducing exercise-induced inflammation.',
    dose: '1-2 g combined EPA/DHA per day.',
    timing: 'With a meal.',
    caution: 'Can mildly thin blood — check with a doctor if you’re on blood thinners.'
  },
  {
    id: 'fatburner',
    name: '"Fat burner" / stimulant blends',
    goals: ['fatloss'],
    evidence: 'limited',
    what: 'Usually just caffeine plus a mix of ingredients with weak individual evidence, marked up in price.',
    dose: 'N/A — a calorie deficit and training drive fat loss, not a pill.',
    timing: '—',
    caution: 'Often underdosed or overdosed on stimulants versus the label. Proceed with skepticism; your money is usually better spent on food quality or a coach.'
  },
  {
    id: 'mass_gainer',
    name: '"Mass gainer" shakes',
    goals: ['muscle'],
    evidence: 'limited',
    what: 'Just a high-calorie shake (protein + sugar/maltodextrin + fat). Convenient for genuinely hard gainers, but easy to replicate cheaper with real food + protein powder + oats/peanut butter.',
    dose: 'Only if you’re struggling to eat enough in a day.',
    timing: 'Between meals if appetite is the limiter.',
    caution: 'Easy to way overshoot calories and gain mostly fat. Track intake if using regularly.'
  }
];
