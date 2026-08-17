/* ===================== Bedrock — lightweight i18n (Español beta) ===================== */
/* Deliberately small: a dictionary over the core interface chrome (nav,
   headings, primary buttons, macro labels) rather than a full translation
   framework. Dynamic coach copy (AI answers, insights, captions) stays in
   English for now — the Settings toggle says so honestly. Static HTML opts
   in via data-i18n attributes; JS strings go through I18N.t() at render
   time. English is always the key, so a missing entry falls back safely. */

const I18N = (() => {
  const LANG_KEY = 'bedrock_lang';

  const ES = {
    // nav + view titles
    'Home': 'Inicio', 'Progress': 'Progreso', 'Fuel': 'Nutrición', 'Ask': 'Pregunta',
    'Settings': 'Ajustes', 'Session': 'Sesión', 'Guide': 'Guía',
    // dashboard
    "Today's insight": 'Idea del día', "Today's session": 'Sesión de hoy',
    'Start workout': 'Empezar entreno', 'Your week': 'Tu semana', 'Today': 'Hoy',
    'Last session': 'Última sesión', 'Training load': 'Carga de entreno', 'Household': 'Casa',
    // workout
    'Finish & save': 'Terminar y guardar',
    // progress
    'Progress check-in': 'Control de progreso', 'At a glance': 'De un vistazo',
    'Standing photo': 'Foto de pie', 'Measurements': 'Medidas', 'Save check-in': 'Guardar control',
    'Weight trend': 'Tendencia de peso', 'Muscle balance': 'Balance muscular',
    'Measurement trends': 'Tendencia de medidas', 'Exercise progression': 'Progresión por ejercicio',
    'Past workouts': 'Entrenos anteriores', 'Progress photos': 'Fotos de progreso',
    'Trophy case': 'Vitrina de trofeos', 'Trajectory': 'Trayectoria',
    '📷 Take photo': '📷 Hacer foto', '🖼 Upload': '🖼 Subir',
    // fuel
    'Supplements': 'Suplementos', 'Nutrition': 'Nutrición', 'My stack': 'Mis suplementos',
    'Your daily targets': 'Tus objetivos diarios', 'Today so far': 'Hoy hasta ahora',
    'Water': 'Agua', "Today's food": 'Comida de hoy',
    'Calories': 'Calorías', 'Protein': 'Proteína', 'Carbs': 'Carbohidratos', 'Fat': 'Grasa',
    '✨ Estimate for me': '✨ Estímalo por mí', '📷 Scan a photo': '📷 Escanear foto',
    'Log it': 'Registrar', 'What should I eat next?': '¿Qué como ahora?',
    'What did you eat?': '¿Qué has comido?',
    '🥛 Glass +250': '🥛 Vaso +250', '🍶 Bottle +500': '🍶 Botella +500',
    '🫙 Large +750': '🫙 Grande +750', '✏️ Custom': '✏️ Otra cantidad', '↩ Undo': '↩ Deshacer',
    'Log meal': 'Registrar comida', 'Save changes': 'Guardar cambios', 'Cancel': 'Cancelar',
    '+ Add an item': '+ Añadir alimento', 'Check what Bedrock saw': 'Revisa lo que vio Bedrock',
    // chat
    'Ask Bedrock': 'Pregunta a Bedrock', 'Clear chat': 'Borrar chat', 'Send': 'Enviar',
    // misc labels used in JS renders
    'left': 'quedan', 'target met ✓': 'objetivo cumplido ✓', 'over': 'de más',
    'week streak': 'semanas seguidas', 'week streaks': 'semanas seguidas',
    'weight': 'peso', 'best lift': 'mejor marca', 'sessions / 28d': 'sesiones / 28d'
  };

  function lang() { return localStorage.getItem(LANG_KEY) === 'es' ? 'es' : 'en'; }
  function setLang(l) {
    localStorage.setItem(LANG_KEY, l === 'es' ? 'es' : 'en');
    document.documentElement.lang = lang();
    apply();
  }
  function t(s) { return lang() === 'es' ? (ES[s] || s) : s; }
  // Static HTML opts in per element; the attribute always holds the English
  // key, so toggling back to English restores the original text.
  function apply() {
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  }
  return { lang, setLang, t, apply };
})();
