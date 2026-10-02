/* ==========================================================
   Meridian — analysis engine (Phase 4A)
   Deterministic rules only: no AI/LLM, no network calls.

   One entry point for BOTH the conversation and the manual
   checklist:

       MeridianAnalysis.analyze(assessment)

   It returns a structured, educational result: an urgency
   level, qualitative pattern matches (strong / moderate /
   limited — never a percentage), and plain-language
   explanations. It is a symptom-pattern tool, not a diagnosis.
   ========================================================== */
(function (root) {
"use strict";

const VERSION = "4A.1";

/* ---------- vocabulary ---------- */

const LEVELS = ["selfcare", "soon", "same_day", "emergency"];
const STRENGTHS = ["limited", "moderate", "strong"];
const lvl = u => Math.max(0, LEVELS.indexOf(u));
const strRank = s => STRENGTHS.indexOf(s);

const URGENCY_LABEL = {
  selfcare: "Often manageable with self-care",
  soon: "Worth seeing a doctor soon",
  same_day: "Best to be seen today",
  emergency: "Needs urgent, in-person care"
};

/* Display names for every symptom key used by the manual checklist and the chat. */
const SYMPTOM_LABELS = {
  mild_fever: "mild fever", fever: "fever", chills: "chills", fatigue: "fatigue", night_sweats: "night sweats",
  headache: "headache", dizziness: "dizziness", light_sensitivity: "sensitivity to light",
  visual_aura: "visual disturbances (aura)", neck_stiffness: "stiff neck", trouble_sleeping: "trouble sleeping",
  sore_throat: "sore throat", difficulty_swallowing: "pain swallowing", cough: "cough", runny_nose: "runny nose",
  sneezing: "sneezing", congestion: "nasal congestion", thick_mucus: "thick or discolored mucus",
  facial_pain: "facial pain or pressure", swollen_glands: "swollen glands", nausea: "nausea", vomiting: "vomiting",
  diarrhea: "diarrhea", lower_abdo_pain: "lower abdominal pain", stomach_cramps: "stomach pain or cramps",
  loss_of_appetite: "loss of appetite", rash: "rash", hives: "hives", itching: "itching", swelling: "swelling",
  muscle_aches: "muscle aches", joint_pain: "joint pain", limited_movement: "limited movement or stiffness",
  burning_urination: "burning when urinating", frequent_urination: "frequent urination"
};
const labelFor = k => SYMPTOM_LABELS[k] || String(k).replace(/_/g, " ");

const RED_FLAG_TEXT = {
  cardiac: "possible heart-related emergency",
  stroke: "possible stroke symptoms",
  breathing: "severe breathing difficulty",
  bleeding: "uncontrolled bleeding or coughing/vomiting blood",
  meningitis: "possible meningitis symptoms",
  abdo: "possible serious abdominal emergency",
  confusion: "new confusion or trouble staying alert",
  fainting: "fainting or passing out",
  sudden_headache: "a sudden, severe headache",
  airway: "swelling of the throat or tongue (possible severe allergic reaction)"
};

const DURATIONS = { today: "started today", days: "a few days", week: "about a week", weeks: "more than two weeks" };
const DURATION_IN_EXPLANATION = { today: "recent onset", days: "onset over the last few days", week: "week-long timeline", weeks: "longer timeline" };

/* Phase 3 "acknowledged but never scored" symptoms that deserve a little extra care. */
const CONCERNING_OTHER = ["palpitations", "blurred vision", "numbness or tingling", "wheezing", "weight loss", "some breathlessness"];

const EMERGENCY_SIGNS = [
  "Chest pain or pressure",
  "Severe trouble breathing, or blue-tinged lips",
  "Face drooping, arm weakness, or slurred speech",
  "Confusion, fainting, or being very hard to wake",
  "A sudden, severe headache, or a stiff neck with fever",
  "Swelling of the throat or tongue",
  "Heavy bleeding, or coughing/vomiting blood"
];

/* ==========================================================
   Condition knowledge base
   symptoms      weights (carried over from the original checker)
   needs         symptoms that must be present for the pattern to be considered at all
   anchors       the distinctive symptoms; used to judge how specific an overlap is
   signals       a "limited" match only affects urgency if one of these is present
   combos        symptom combinations that strengthen the pattern
   against       symptoms that make the pattern LESS typical when present (penalty each)
   maxStrength   patterns that can't be told apart by symptoms alone are capped
   capIfDenied   if the user denies this symptom, strength is capped
   ========================================================== */
const CONDITIONS = [
  { id: "common_cold", name: "Common cold", phrase: "a common cold", baseUrgency: "selfcare",
    symptoms: { runny_nose: 2, sore_throat: 2, cough: 1, sneezing: 2, mild_fever: 1, fatigue: 1, congestion: 2 },
    anchors: ["runny_nose", "sneezing", "congestion", "sore_throat", "cough"],
    combos: [{ keys: ["runny_nose", "sneezing", "congestion", "sore_throat", "cough"], min: 3, bonus: 0.10 }],
    against: { chills: 0.06, muscle_aches: 0.06, fever: 0.05 },
    acute: true, feverUnusual: true, fitsDuration: ["days", "week"],
    advice: "Rest, fluids, and warmth usually help most. A pharmacist can suggest over-the-counter options if symptoms are bothersome.",
    whenToSeekCare: "See a doctor if it lasts more than 10 days or gets noticeably worse.",
    selfCare: ["Rest and get plenty of sleep", "Drink fluids regularly; warm drinks can soothe a sore throat", "Steam or a saline nasal spray can ease a blocked nose"],
    monitor: ["Most colds settle within about 7–10 days; a cough can linger a little longer"],
    seekHelpIf: ["Symptoms last more than about 10 days, or improve and then get worse again", "You develop a high fever, ear pain, or facial pain"] },

  { id: "flu", name: "Influenza (flu)", phrase: "flu", baseUrgency: "soon",
    symptoms: { fever: 2, chills: 2, muscle_aches: 2, fatigue: 2, headache: 1, cough: 1, sore_throat: 1 },
    anchors: ["fever", "chills", "muscle_aches"], signals: ["fever", "chills"],
    combos: [{ keys: ["fever", "chills", "muscle_aches", "fatigue"], min: 3, bonus: 0.10 }],
    capIfDenied: { fever: "moderate" },
    acute: true, suddenOnset: true, feverFriendly: true, fitsDuration: ["today", "days"],
    advice: "Rest and hydration are key. Flu can hit hard and fast.",
    whenToSeekCare: "Check in with a doctor if you're over 65, pregnant, or have a chronic condition, or if breathing becomes difficult.",
    selfCare: ["Rest as much as you can", "Drink plenty of fluids", "Stay home while you have a fever to avoid spreading it"],
    monitor: ["Fever, aches and tiredness usually ease over several days; tiredness can linger longer"],
    seekHelpIf: ["Breathing becomes difficult or you feel breathless at rest", "Fever returns or worsens after a few days of improvement"] },

  { id: "migraine", name: "Migraine", phrase: "migraine", baseUrgency: "selfcare",
    symptoms: { headache: 3, nausea: 1, light_sensitivity: 2, visual_aura: 2 },
    needs: ["headache"], anchors: ["headache", "light_sensitivity", "visual_aura", "nausea"],
    combos: [{ keys: ["headache", "light_sensitivity", "nausea"], min: 3, bonus: 0.10 }],
    against: { fever: 0.10, mild_fever: 0.05 },
    severityFit: true, fitsDuration: [],
    advice: "A dark, quiet room and staying hydrated can help during an attack.",
    whenToSeekCare: "If this is a new or unusually severe headache for you, or comes with confusion, get it checked.",
    selfCare: ["Rest in a dark, quiet room", "Stay hydrated and try not to skip meals", "Keep a note of possible triggers such as sleep, stress or foods"],
    monitor: ["Note how long attacks last and how often they happen"],
    seekHelpIf: ["This is the worst or first headache of this kind you've had", "Headaches are becoming more frequent or aren't settling"] },

  { id: "tension_headache", name: "Tension headache", phrase: "a tension headache", baseUrgency: "selfcare",
    symptoms: { headache: 2, neck_stiffness: 1, trouble_sleeping: 1, fatigue: 1 },
    needs: ["headache"], anchors: ["headache", "neck_stiffness", "trouble_sleeping"], maxStrength: "moderate",
    against: { fever: 0.15, mild_fever: 0.08, nausea: 0.06, light_sensitivity: 0.08, visual_aura: 0.08 },
    feverUnusual: true, fitsDuration: ["days", "week", "weeks"],
    advice: "Often linked to stress, screen time, or poor sleep. Gentle stretching, breaks, and rest usually help within a day.",
    whenToSeekCare: "See a doctor if headaches are frequent, keep returning, or don't settle.",
    selfCare: ["Take regular screen breaks and stretch your neck and shoulders", "Keep regular sleep times and drink enough water", "A warm compress on the neck or shoulders can help"],
    monitor: ["Notice whether headaches line up with stress, posture or poor sleep"],
    seekHelpIf: ["Headaches are frequent, or keep coming back despite rest"] },

  { id: "gastroenteritis", name: "Gastroenteritis (stomach bug)", phrase: "a stomach bug (gastroenteritis)", baseUrgency: "selfcare",
    symptoms: { nausea: 2, vomiting: 2, diarrhea: 2, stomach_cramps: 2, mild_fever: 1 },
    anchors: ["nausea", "vomiting", "diarrhea", "stomach_cramps"],
    combos: [{ keys: ["nausea", "vomiting", "diarrhea", "stomach_cramps"], min: 3, bonus: 0.10 }],
    acute: true, fitsDuration: ["today", "days"],
    advice: "Sip fluids often to avoid dehydration, and try bland food once you can tolerate it.",
    whenToSeekCare: "See a doctor if you can't keep liquids down for 24 hours or notice blood.",
    selfCare: ["Sip fluids little and often", "Reintroduce bland food once you can tolerate it", "Rest and wash hands well to avoid spreading it"],
    monitor: ["Watch for signs of dehydration: very dark urine, dizziness, dry mouth, passing little urine"],
    seekHelpIf: ["You can't keep liquids down for 24 hours", "You see blood in vomit or stool", "You're passing very little urine or feel faint"] },

  { id: "food_poisoning", name: "Food poisoning", phrase: "food poisoning", baseUrgency: "soon",
    symptoms: { vomiting: 2, diarrhea: 2, stomach_cramps: 2, nausea: 1, fever: 1 },
    anchors: ["vomiting", "diarrhea", "stomach_cramps"], foodSensitive: true,
    combos: [{ keys: ["vomiting", "diarrhea", "stomach_cramps", "nausea"], min: 3, bonus: 0.10 }],
    acute: true, feverFriendly: true, fitsDuration: ["today", "days"],
    advice: "Focus on rehydration with small, frequent sips.",
    whenToSeekCare: "If symptoms are severe, involve high fever, or last beyond 48 hours, seek medical care.",
    selfCare: ["Take small, frequent sips of fluid", "Rest, and eat bland food only when you feel ready"],
    monitor: ["Think about what you ate in the last day or two, and whether others who ate it are unwell"],
    seekHelpIf: ["Symptoms are severe, include a high fever, or last beyond 48 hours", "You can't keep fluids down"] },

  { id: "allergic_reaction", name: "Allergic reaction", phrase: "an allergic reaction", baseUrgency: "soon",
    symptoms: { rash: 2, itching: 2, swelling: 2, hives: 2, sneezing: 1 },
    anchors: ["rash", "itching", "swelling", "hives"], signals: ["hives"],
    combos: [{ keys: ["hives", "itching", "swelling", "rash"], min: 3, bonus: 0.10 }],
    fitsDuration: ["today"],
    advice: "Avoiding the suspected trigger and cool compresses can ease mild reactions; a pharmacist can advise on over-the-counter options.",
    whenToSeekCare: "If swelling spreads to your face or throat, or breathing feels affected, treat this as an emergency.",
    selfCare: ["Move away from the suspected trigger if you know it", "A cool compress can soothe itching or swelling", "Avoid scratching"],
    monitor: ["Keep an eye on whether swelling or the rash is spreading"],
    seekHelpIf: ["Swelling spreads to your face, lips, tongue or throat", "Breathing feels tight, or you feel faint or dizzy"] },

  { id: "uti", name: "Urinary tract infection", phrase: "a urinary tract infection", baseUrgency: "soon",
    symptoms: { burning_urination: 3, frequent_urination: 2, lower_abdo_pain: 1, mild_fever: 1 },
    anchors: ["burning_urination", "frequent_urination", "lower_abdo_pain"], signals: ["burning_urination"],
    combos: [{ keys: ["burning_urination", "frequent_urination", "lower_abdo_pain"], min: 3, bonus: 0.10 }],
    capIfDenied: { burning_urination: "limited" },
    feverFriendly: true, fitsDuration: ["days"],
    advice: "Drinking plenty of water is reasonable in the meantime.",
    whenToSeekCare: "A clinician can confirm this with a simple urine test and advise on treatment, so a visit is worthwhile.",
    selfCare: ["Drink plenty of water", "Avoid holding in urine"],
    monitor: ["Note whether symptoms are spreading to your back or sides"],
    seekHelpIf: ["You develop fever, chills, or pain in your back or side", "You see blood in your urine", "You are pregnant or have a health condition that lowers immunity"] },

  { id: "muscle_strain", name: "Muscle strain", phrase: "a muscle strain", baseUrgency: "selfcare",
    symptoms: { joint_pain: 1, muscle_aches: 2, swelling: 1, limited_movement: 2 },
    anchors: ["muscle_aches", "limited_movement", "joint_pain"], feverUnusual: true, fitsDuration: ["days", "week"],
    advice: "Rest, gentle movement, and alternating ice/heat typically help over several days.",
    whenToSeekCare: "See a doctor if there's severe swelling or you can't bear weight.",
    selfCare: ["Rest the area, then return to gentle movement", "Ice or heat for short periods can ease soreness"],
    monitor: ["Notice whether movement is slowly getting easier"],
    seekHelpIf: ["There is severe swelling, deformity, or you can't bear weight", "Pain isn't easing after a week or so"] },

  { id: "stress_tension", name: "Stress-related tension", phrase: "stress-related tension", baseUrgency: "selfcare",
    symptoms: { headache: 1, muscle_aches: 1, fatigue: 1, trouble_sleeping: 2 },
    needs: ["trouble_sleeping"], anchors: ["trouble_sleeping", "headache", "muscle_aches", "fatigue"], maxStrength: "moderate",
    feverUnusual: true, fitsDuration: ["week", "weeks"],
    advice: "Physical symptoms from stress are common and real. Sleep, movement, and reducing load where you can often help.",
    whenToSeekCare: "If symptoms persist or affect daily life, talk to a clinician.",
    selfCare: ["Keep regular sleep and wake times", "Gentle exercise and time outdoors can help", "Reduce load where you can"],
    monitor: ["Notice whether symptoms ease on days with better sleep or less pressure"],
    seekHelpIf: ["Symptoms persist for weeks or get in the way of daily life", "You feel overwhelmed, hopeless, or unsafe"] },

  { id: "sinusitis", name: "Sinus infection", phrase: "a sinus infection", baseUrgency: "soon",
    symptoms: { facial_pain: 2, congestion: 2, headache: 1, mild_fever: 1, thick_mucus: 2 },
    anchors: ["facial_pain", "thick_mucus", "congestion"],
    combos: [{ keys: ["facial_pain", "thick_mucus", "congestion"], min: 3, bonus: 0.10 }],
    prolongedFit: true, feverFriendly: true, fitsDuration: ["week", "weeks"],
    advice: "Steam and saline rinses can ease pressure.",
    whenToSeekCare: "If it lasts beyond 10 days or comes with high fever, see a doctor — it may need treatment.",
    selfCare: ["Steam inhalation or a saline rinse can ease pressure", "Rest and drink plenty of fluids"],
    monitor: ["Many sinus symptoms clear on their own within about 10 days"],
    seekHelpIf: ["Symptoms last beyond 10 days", "You develop a high fever, swelling around the eyes, or a severe headache"] },

  { id: "pharyngitis", name: "Strep throat / pharyngitis", phrase: "strep throat or pharyngitis", baseUrgency: "soon",
    symptoms: { sore_throat: 3, fever: 1, swollen_glands: 2, difficulty_swallowing: 1 },
    needs: ["sore_throat"], anchors: ["sore_throat", "swollen_glands", "difficulty_swallowing", "fever"],
    signals: ["swollen_glands", "fever"], maxStrength: "moderate",
    against: { cough: 0.08, runny_nose: 0.08, sneezing: 0.08 },
    combos: [{ keys: ["sore_throat", "swollen_glands", "fever"], min: 3, bonus: 0.10 }],
    acute: true, feverFriendly: true, fitsDuration: ["days"],
    advice: "Warm drinks and rest can ease a sore throat. Symptoms alone can't tell a viral sore throat from a bacterial one.",
    whenToSeekCare: "A throat swab can confirm if it's bacterial. Worth seeing a doctor, especially with fever and swollen glands together.",
    selfCare: ["Warm drinks and plenty of fluids", "Rest your voice and get extra sleep"],
    monitor: ["Notice whether swallowing is getting easier or harder"],
    seekHelpIf: ["You can't swallow saliva, drool, or have trouble opening your mouth", "Fever and swollen glands persist or worsen"] },

  /* Two small additions that the existing symptom vocabulary supports */
  { id: "hay_fever", name: "Hay fever (seasonal allergies)", phrase: "hay fever or seasonal allergies", baseUrgency: "selfcare",
    symptoms: { sneezing: 3, runny_nose: 2, congestion: 2, itching: 1, cough: 1 },
    anchors: ["sneezing", "runny_nose", "congestion"],
    against: { fever: 0.10, mild_fever: 0.05, chills: 0.08, muscle_aches: 0.08 },
    feverUnusual: true, fitsDuration: ["week", "weeks"],
    advice: "Avoiding known triggers and keeping windows closed on high-pollen days can help.",
    whenToSeekCare: "See a doctor or pharmacist if symptoms keep returning or affect sleep or daily life.",
    selfCare: ["Avoid known triggers such as pollen, dust or pets", "Rinse your nose with saline and keep windows closed on high-pollen days"],
    monitor: ["Notice whether symptoms follow a season, place, or exposure"],
    seekHelpIf: ["Symptoms keep returning or affect sleep and daily life", "You develop wheezing or chest tightness"] },

  { id: "chest_cold", name: "Chest cold (acute bronchitis)", phrase: "a chest cold (acute bronchitis)", baseUrgency: "selfcare",
    symptoms: { cough: 3, thick_mucus: 2, fatigue: 1, mild_fever: 1, sore_throat: 1 },
    needs: ["cough"], anchors: ["cough", "thick_mucus"],
    combos: [{ keys: ["cough", "thick_mucus", "fatigue", "sore_throat"], min: 3, bonus: 0.10 }],
    feverFriendly: false, fitsDuration: ["week", "weeks"],
    advice: "Rest, fluids, and warm drinks can help. A cough can linger for a few weeks.",
    whenToSeekCare: "See a doctor if the cough lasts more than about 3 weeks, you become short of breath, or you have a high fever.",
    selfCare: ["Rest and drink plenty of fluids", "Warm drinks can soothe a cough", "Avoid smoke and other irritants"],
    monitor: ["A cough can continue for a few weeks after other symptoms settle"],
    seekHelpIf: ["You become short of breath or wheezy", "The cough lasts more than about 3 weeks", "You cough up blood"] }
];

/* ==========================================================
   Input normalisation — accepts anything, never throws
   ========================================================== */
const uniq = a => Array.from(new Set(a));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round3 = n => Math.round(n * 1000) / 1000;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
function list(a, conj) {
  conj = conj || "and";
  if (a.length <= 1) return a.join("");
  if (a.length === 2) return a[0] + " " + conj + " " + a[1];
  return a.slice(0, -1).join(", ") + " " + conj + " " + a[a.length - 1];
}
const strings = v => (Array.isArray(v) ? v.filter(x => typeof x === "string" && x.trim()).map(x => x.trim()) : []);

function normDuration(d) {
  if (Array.isArray(d)) d = d[0];
  return typeof d === "string" && DURATIONS[d] ? d : null;
}
function normSeverity(v) {
  if (typeof v === "string") {
    const word = { mild: 3, moderate: 5, severe: 8 }[v.toLowerCase().trim()];
    if (word) return word;
    v = parseFloat(v);
  }
  if (typeof v !== "number" || !isFinite(v)) return null;
  v = Math.round(v);
  return v >= 1 && v <= 10 ? v : null;
}
function severityBand(n) {
  if (n == null) return null;
  return n <= 3 ? "mild" : n <= 6 ? "moderate" : n <= 8 ? "significant" : "severe";
}
function normTemp(t) {
  let c = null, text = null;
  if (t && typeof t === "object" && typeof t.c === "number") { c = t.c; text = t.text || null; }
  else if (typeof t === "number") c = t > 45 ? (t - 32) * 5 / 9 : t;
  if (c === null || !isFinite(c) || c < 34 || c > 43) return null;
  c = Math.round(c * 10) / 10;
  const band = c < 37.3 ? "normal" : c < 38 ? "low_grade" : c < 39 ? "fever" : c < 40 ? "high" : "very_high";
  return { c, text: text || c + "°C", band };
}
function normAge(a) {
  if (typeof a === "string") a = parseInt(a, 10);
  return typeof a === "number" && isFinite(a) && a >= 1 && a <= 120 ? Math.round(a) : null;
}
function ageGroup(a) {
  return a == null ? null : a <= 5 ? "young_child" : a <= 17 ? "child" : a <= 64 ? "adult" : "older_adult";
}
function normTrend(t) {
  if (typeof t !== "string") return null;
  t = t.toLowerCase().trim();
  if (/^(worsening|worse|getting worse|deteriorating)$/.test(t)) return "worsening";
  if (/^(improving|better|getting better|easing)$/.test(t)) return "improving";
  if (/^(stable|same|unchanged|no change)$/.test(t)) return "stable";
  return null;
}

function normalize(raw) {
  const inp = raw && typeof raw === "object" ? raw : {};
  const given = uniq(strings(inp.keys));
  const keys = given.filter(k => k in SYMPTOM_LABELS);
  const unrecognized = given.filter(k => !(k in SYMPTOM_LABELS));
  const temp = normTemp(inp.temp);

  /* a measured temperature fills in a missing fever symptom */
  const derivedKeys = [];
  if (temp && !keys.includes("fever") && !keys.includes("mild_fever")) {
    if (temp.c >= 38) { keys.push("fever"); derivedKeys.push("fever"); }
    else if (temp.c >= 37.3) { keys.push("mild_fever"); derivedKeys.push("mild_fever"); }
  }
  const keySet = new Set(keys);
  const denied = uniq(strings(inp.denied)).filter(k => k in SYMPTOM_LABELS && !keySet.has(k));
  const notes = strings(inp.notes), other = strings(inp.other);

  const redFlags = uniq(strings(inp.redFlags)).map(id => ({ id, text: RED_FLAG_TEXT[id] || "a serious warning sign", source: "reported" }));
  /* fever with a stiff neck is treated the same way the conversation treats it */
  if (keySet.has("fever") && keySet.has("neck_stiffness") && !redFlags.some(f => f.id === "meningitis"))
    redFlags.push({ id: "meningitis", text: RED_FLAG_TEXT.meningitis, source: "derived" });

  const age = normAge(inp.age);
  return {
    keys, keySet, derivedKeys, unrecognized, denied, deniedSet: new Set(denied), redFlags,
    duration: normDuration(inp.duration), severity: normSeverity(inp.severity), temp,
    age, ageGroup: ageGroup(age), trend: normTrend(inp.trend), other, notes,
    foodHint: notes.some(n => /after eating/i.test(n)),
    hasInput: keys.length > 0 || redFlags.length > 0 || other.length > 0
  };
}

/* ==========================================================
   Pattern matching
   ========================================================== */
const hasKey = (ctx, k) => ctx.keySet.has(k) || (k === "fever" && ctx.keySet.has("mild_fever"));
function isDenied(ctx, k) {
  if (ctx.keySet.has(k)) return false;
  return ctx.deniedSet.has(k) || (k === "mild_fever" && ctx.deniedSet.has("fever"));
}

function contextAdjust(c, ctx) {
  let adj = 0;
  if (c.acute && ctx.duration === "weeks") adj -= 0.10;                         // acute illnesses rarely last this long
  if (c.suddenOnset && ctx.duration === "today") adj += 0.05;
  if (c.prolongedFit && (ctx.duration === "week" || ctx.duration === "weeks")) adj += 0.05;
  if (ctx.temp) {
    if (c.feverFriendly && ctx.temp.c >= 38) adj += 0.05;
    if (c.feverUnusual && ctx.temp.c >= 39) adj -= 0.08;
  }
  if (c.severityFit && ctx.severity != null && ctx.severity >= 7) adj += 0.05;
  if (c.foodSensitive) adj += ctx.foodHint ? 0.12 : -0.08;
  return adj;
}

function strengthOf(c, f, ctx) {
  let s = null;
  if (f.final >= 0.60 && f.matchedCount >= 3 && f.anchorHits >= 2 && f.penalty < 0.20) s = "strong";
  else if (f.final >= 0.35 && f.matchedCount >= 2 && f.anchorHits >= 2) s = "moderate";
  else if (f.final >= 0.25) s = "limited";
  if (!s) return null;
  if (c.maxStrength && strRank(s) > strRank(c.maxStrength)) s = c.maxStrength;
  Object.keys(c.capIfDenied || {}).forEach(k => {
    if (isDenied(ctx, k) && strRank(s) > strRank(c.capIfDenied[k])) s = c.capIfDenied[k];
  });
  return s;
}

function scoreCondition(c, ctx) {
  if ((c.needs || []).some(k => !hasKey(ctx, k))) return null;
  const keys = Object.keys(c.symptoms);
  const total = keys.reduce((n, k) => n + c.symptoms[k], 0);

  let got = 0; const matchedKeys = [];
  keys.forEach(k => {
    let credit = 0, shown = k;
    if (ctx.keySet.has(k)) credit = 1;
    else if (k === "mild_fever" && ctx.keySet.has("fever")) { credit = 0.5; shown = "fever"; }   // a higher fever is only a partial fit
    else if (k === "fever" && ctx.keySet.has("mild_fever")) { credit = 0.6; shown = "mild_fever"; }
    if (credit) { got += c.symptoms[k] * credit; if (!matchedKeys.includes(shown)) matchedKeys.push(shown); }
  });
  if (!matchedKeys.length) return null;

  const anchorHits = (c.anchors || []).filter(k => hasKey(ctx, k)).length;
  if (!(c.needs && c.needs.length) && anchorHits === 0) return null;

  const coverage = got / total;
  const deniedKeys = keys.filter(k => isDenied(ctx, k));
  const deniedPen = 0.6 * deniedKeys.reduce((n, k) => n + c.symptoms[k], 0) / total;
  const againstHit = Object.keys(c.against || {}).filter(k => ctx.keySet.has(k));
  const againstPen = Math.min(0.25, againstHit.reduce((n, k) => n + c.against[k], 0));
  let bonus = 0;
  (c.combos || []).forEach(cb => { if (cb.keys.filter(k => ctx.keySet.has(k)).length >= cb.min) bonus += cb.bonus; });
  bonus = Math.min(0.15, bonus);
  const adj = contextAdjust(c, ctx);

  const final = round3(clamp(coverage + bonus - deniedPen - againstPen + adj, 0, 1));
  const penalty = deniedPen + againstPen;
  const strength = strengthOf(c, { final, matchedCount: matchedKeys.length, anchorHits, penalty }, ctx);
  if (!strength) return null;

  const missingKeys = keys.filter(k => !ctx.keySet.has(k) && !deniedKeys.includes(k)
    && !(k === "fever" && ctx.keySet.has("mild_fever")) && !(k === "mild_fever" && ctx.keySet.has("fever")))
    .sort((a, b) => c.symptoms[b] - c.symptoms[a]);

  const m = {
    id: c.id, name: c.name, strength,
    matchedSymptoms: matchedKeys.map(labelFor), matchedKeys,
    missingSymptoms: missingKeys.map(labelFor), missingKeys,
    deniedSymptoms: deniedKeys.map(labelFor),
    unusualSymptoms: againstHit.map(labelFor),
    urgency: c.baseUrgency,
    explanation: "", uncertainty: "", advice: c.advice, whenToSeekCare: c.whenToSeekCare,
    _score: final, _cond: c, _againstHit: againstHit, _deniedKeys: deniedKeys
  };
  m.explanation = explain(c, m, ctx);
  m.uncertainty = uncertain(c, m, ctx);
  return m;
}

/* ---------- plain-language explanations ---------- */
function explain(c, m, ctx) {
  const items = m.matchedKeys.map(labelFor);
  if (ctx.duration && (c.fitsDuration || []).includes(ctx.duration)) items.push(DURATION_IN_EXPLANATION[ctx.duration]);
  if (ctx.temp && c.feverFriendly && ctx.temp.c >= 38) items.push("temperature of " + ctx.temp.text);
  const lead = `Your ${list(items)} ${items.length > 1 ? "overlap" : "overlaps"} with symptoms commonly seen with ${c.phrase}.`;
  return m.strength === "limited" ? lead + " Only part of the usual pattern is there, so this is a weaker fit." : lead;
}

function uncertain(c, m, ctx) {
  const parts = [];
  const miss = m.missingKeys.slice(0, 3).map(labelFor);
  if (miss.length) parts.push(`You haven't reported ${list(miss, "or")}, which can also occur with this pattern.`);
  if (m.deniedSymptoms.length) parts.push(`You said you don't have ${list(m.deniedSymptoms.slice(0, 3), "or")}, which makes this pattern a little less typical — though that alone doesn't rule it out.`);
  if (m.unusualSymptoms.length) parts.push(`Having ${list(m.unusualSymptoms.slice(0, 3))} is less typical of this pattern.`);
  if (c.acute && ctx.duration === "weeks") parts.push("Symptoms lasting more than two weeks are less common with this pattern.");
  if (ctx.temp && c.feverUnusual && ctx.temp.c >= 39) parts.push("A high temperature is less typical of this pattern.");
  if (c.maxStrength) parts.push("Symptoms alone can't reliably separate this from similar causes.");
  parts.push(m.strength === "limited"
    ? "Only a small part of this pattern matches, and many other causes can look similar."
    : "Many other causes can look similar, so treat this as something to discuss rather than a conclusion.");
  return parts.join(" ");
}

function rankMatches(matches) {
  matches.sort((a, b) => strRank(b.strength) - strRank(a.strength) || b._score - a._score
    || CONDITIONS.indexOf(a._cond) - CONDITIONS.indexOf(b._cond));
  const stronger = matches.filter(m => m.strength !== "limited").length;
  return (stronger >= 2 ? matches.filter(m => m.strength !== "limited") : matches).slice(0, 4);
}

/* ==========================================================
   Urgency — conservative, deterministic, every step explained
   ========================================================== */
function computeUrgency(ctx, matches) {
  const R = [];
  const add = (level, code, text) => R.push({ level, code, text });
  const has = k => ctx.keySet.has(k);
  const realFever = has("fever") || (ctx.temp && ctx.temp.c >= 38);
  const anyFever = realFever || has("mild_fever");
  const longer = ctx.duration && ctx.duration !== "today";
  const otherText = ctx.other.map(o => o.toLowerCase());
  const concerning = otherText.filter(o => CONCERNING_OTHER.some(x => o.includes(x)));

  /* 1. pattern-based: moderate/strong matches count; weak ones only with a signal symptom */
  matches.forEach(m => {
    if (m.urgency === "selfcare") return;
    const c = m._cond;
    const signalled = (c.signals || []).some(k => has(k));
    if (m.strength !== "limited" || signalled)
      add(m.urgency, "pattern:" + m.id, `The pattern for ${c.phrase} is usually worth a clinician's review.`);
  });

  /* 2. severity — never an automatic emergency */
  if (ctx.severity != null) {
    if (ctx.severity >= 9) add("same_day", "severity", `You rated your symptoms as severe (${ctx.severity}/10).`);
    else if (ctx.severity >= 8) add("soon", "severity", `You rated your symptoms as significant (${ctx.severity}/10).`);
  }

  /* 3. duration and trend */
  if (ctx.duration === "weeks") add("soon", "duration", "Symptoms lasting more than two weeks deserve an assessment.");
  if (ctx.trend === "worsening") {
    add("soon", "trend", "You said your symptoms are getting worse.");
    if ((ctx.severity != null && ctx.severity >= 7) || (ctx.temp && ctx.temp.c >= 39))
      add("same_day", "trend_severe", "Worsening symptoms that are already significant are better checked today.");
  }

  /* 4. temperature and fever */
  if (ctx.temp && ctx.temp.c >= 39.4) add("same_day", "temp", `A temperature of ${ctx.temp.text} is high enough to be checked today.`);
  else if (ctx.temp && ctx.temp.c >= 38 && longer) add("soon", "temp", "A fever that has lasted more than a day is worth a check-in.");
  if (realFever && (ctx.duration === "week" || ctx.duration === "weeks")) add("soon", "fever_duration", "Fever lasting about a week or more should be assessed.");
  if (realFever && has("headache")) add("soon", "fever_headache", "Fever with headache is worth keeping a close eye on.");
  if (anyFever && has("headache") && has("light_sensitivity")) add("same_day", "fever_headache_light", "Fever, headache and sensitivity to light together are better checked today.");
  if (has("mild_fever") && has("neck_stiffness")) add("same_day", "fever_neck", "A stiff neck with any fever is better checked today.");
  if (realFever && (has("burning_urination") || has("lower_abdo_pain") && has("frequent_urination")))
    add("same_day", "uti_fever", "Urinary symptoms with fever can mean the infection is spreading, so same-day review is safer.");

  /* 5. allergy-type combinations */
  if (has("hives") && (has("swelling") || has("difficulty_swallowing")))
    add("same_day", "hives_swelling", "Hives with swelling or painful swallowing are better checked today. Swelling of the throat or tongue is an emergency.");

  /* 6. age — used conservatively, only where it changes the risk */
  const vomDiar = has("vomiting") || has("diarrhea");
  if (ctx.age != null && ctx.age <= 3 && anyFever && realFever) add("same_day", "age_fever", "Fever in a very young child should be checked the same day.");
  else if (ctx.ageGroup === "young_child" && realFever) add("soon", "age_fever", "Fever in a young child is worth a call to a doctor.");
  if (ctx.ageGroup === "young_child" && has("vomiting") && has("diarrhea")) add("same_day", "age_dehydration", "Vomiting and diarrhea together can dehydrate a young child quickly.");
  else if (ctx.ageGroup === "young_child" && vomDiar) add("soon", "age_dehydration", "Vomiting or diarrhea can dehydrate a young child quickly.");
  if (ctx.ageGroup === "older_adult") {
    if (realFever) add("soon", "age_fever", "Fever in people over 65 is worth a check-in.");
    if (vomDiar) add("soon", "age_dehydration", "Vomiting or diarrhea can cause dehydration more quickly after 65.");
    if (ctx.severity != null && ctx.severity >= 7) add("same_day", "age_severity", "Significant symptoms over 65 are better checked today.");
  }

  /* 7. symptoms Meridian acknowledges but doesn't score */
  if (concerning.length) add("soon", "other", `You mentioned ${list(concerning)}, which Meridian can't assess but is worth raising with a clinician.`);
  if ((has("headache")) && otherText.some(o => o.includes("blurred vision") || o.includes("numbness")))
    add("same_day", "headache_neuro", "Headache with vision changes or numbness is better checked today.");
  if (has("night_sweats") && otherText.some(o => o.includes("weight loss"))) add("soon", "night_sweats", "Night sweats with weight loss deserve an assessment.");

  const level = R.reduce((best, r) => (lvl(r.level) > lvl(best) ? r.level : best), "selfcare");
  const reasons = R.filter(r => r.level === level).concat(R.filter(r => r.level !== level).sort((a, b) => lvl(b.level) - lvl(a.level)));
  return { level, reasons };
}

/* ==========================================================
   Assembling the result
   ========================================================== */
const NEXT_STEP = {
  emergency: "Call your local emergency number now (for example, 112 in India, 911 in the US, 999 in the UK) or get to an emergency department. Don't wait to see if it passes.",
  same_day: "Try to be seen by a doctor or urgent-care service today rather than waiting it out. If things get suddenly worse, go to an emergency department.",
  soon: "Consider booking an appointment with a doctor in the next day or two, sooner if symptoms get worse.",
  selfcare: "Rest, drink fluids, and keep an eye on how you feel over the next few days. Contact a clinician if things get worse or don't improve."
};

function buildFacts(ctx, unexplained) {
  return {
    keys: ctx.keys.slice(), labels: ctx.keys.map(labelFor), derivedKeys: ctx.derivedKeys.slice(),
    unrecognizedKeys: ctx.unrecognized.slice(),
    denied: ctx.denied.slice(), deniedLabels: ctx.denied.map(labelFor),
    severity: ctx.severity == null ? null : { value: ctx.severity, band: severityBand(ctx.severity) },
    duration: ctx.duration ? { code: ctx.duration, label: DURATIONS[ctx.duration] } : null,
    temp: ctx.temp ? { c: ctx.temp.c, text: ctx.temp.text, band: ctx.temp.band } : null,
    age: ctx.age == null ? null : { value: ctx.age, group: ctx.ageGroup },
    trend: ctx.trend, other: ctx.other.slice(), notes: ctx.notes.slice(),
    unexplainedKeys: unexplained, unexplainedLabels: unexplained.map(labelFor),
    hasInput: ctx.hasInput
  };
}

function buildEmergency(ctx) {
  const texts = ctx.redFlags.map(f => f.text);
  return {
    version: VERSION, urgency: "emergency", urgencyLabel: URGENCY_LABEL.emergency,
    urgencyReasons: ctx.redFlags.map(f => ({ level: "emergency", code: "red_flag:" + f.id,
      text: f.source === "derived" ? `Your answers combine into a warning sign: ${f.text}.` : `You reported ${f.text}.` })),
    matches: [],
    summary: `Based on what you shared (${list(texts)}), this needs urgent, in-person medical attention. Meridian has stopped comparing symptom patterns on purpose — getting checked promptly matters more.`,
    nextStep: NEXT_STEP.emergency,
    selfCare: [], monitor: [],
    seekHelpIf: ["Don't wait to see if it passes", "If you feel faint or very unwell, don't travel alone or drive yourself"],
    emergencySigns: EMERGENCY_SIGNS.slice(),
    redFlags: ctx.redFlags.map(f => ({ id: f.id, text: f.text, source: f.source })),
    facts: buildFacts(ctx, []),
    disclaimer: "This is general information, not a diagnosis."
  };
}

function firstN(arr, n) { return uniq(arr).slice(0, n); }

function analyze(raw, opts) {
  const ctx = normalize(raw);
  if (ctx.redFlags.length) return buildEmergency(ctx);          // red flags always win, nothing can override them

  const matches = rankMatches(CONDITIONS.map(c => scoreCondition(c, ctx)).filter(Boolean));
  const urg = computeUrgency(ctx, matches);
  const covered = new Set(); matches.forEach(m => m.matchedKeys.forEach(k => covered.add(k)));
  const unexplained = ctx.keys.filter(k => !covered.has(k) && !(k === "fever" && covered.has("mild_fever")) && !(k === "mild_fever" && covered.has("fever")));

  /* summary */
  let summary;
  if (!ctx.hasInput) summary = "No symptoms were provided, so there is nothing to compare yet.";
  else if (!matches.length) summary = "Your symptoms didn't closely overlap with a common pattern in Meridian's list. That doesn't mean nothing is going on — a clinician can assess symptoms Meridian doesn't cover.";
  else {
    const top = matches[0], n = matches.length - 1;
    const word = { strong: "a strong overlap", moderate: "a moderate overlap", limited: "a limited overlap" }[top.strength];
    summary = `Your symptoms show ${word} with the pattern for ${top._cond.phrase}${n > 0 ? `, and some overlap with ${n} other common pattern${n > 1 ? "s" : ""}` : ""}. This is a comparison of symptom patterns, not a diagnosis.`;
  }
  if (ctx.other.length) summary += ` You also mentioned ${list(ctx.other)}, which Meridian doesn't score but is worth raising with a clinician.`;

  /* guidance lists */
  const top2 = matches.slice(0, 2);
  const selfCare = firstN(top2.flatMap(m => m._cond.selfCare).concat(
    matches.length ? [] : ["Rest and drink plenty of fluids", "Make a note of when symptoms started and how they change"]), 5);
  const monitor = [], seek = [];
  if (ctx.trend === "worsening") seek.push("Your symptoms are getting worse or not improving as expected");
  if (ctx.trend === "improving") monitor.push("You said things are improving — watch for any change back");
  if (realFeverAndHeadache(ctx)) monitor.push("With fever and headache, watch for a stiff neck, sensitivity to light, confusion or a rash that doesn't fade — these need urgent care");
  if (ctx.ageGroup === "young_child") monitor.push("Young children can become unwell quickly — lean toward contacting a doctor early");
  if (ctx.ageGroup === "older_adult") monitor.push("Symptoms can progress faster after 65 — lean toward checking in early");
  if (ctx.other.length) monitor.push(`Mention ${list(ctx.other)} to a clinician, since Meridian doesn't score ${ctx.other.length > 1 ? "them" : "it"}`);
  if (unexplained.length) monitor.push(`Meridian's patterns don't cover ${list(unexplained.map(labelFor))} well, so keep track of ${unexplained.length > 1 ? "them" : "it"}`);
  top2.forEach(m => { m._cond.monitor.forEach(x => monitor.push(x)); m._cond.seekHelpIf.forEach(x => seek.push(x)); });
  seek.push("New or worrying symptoms appear, or you're unsure and want reassurance");

  const result = {
    version: VERSION, urgency: urg.level, urgencyLabel: URGENCY_LABEL[urg.level],
    urgencyReasons: urg.reasons.length ? urg.reasons : [{ level: "selfcare", code: "default", text: "Nothing you shared points to needing faster care." }],
    matches: matches.map(m => {
      const o = {}; Object.keys(m).forEach(k => { if (!k.startsWith("_")) o[k] = m[k]; });
      if (opts && opts.debug) o.debug = { score: m._score };
      return o;
    }),
    summary, nextStep: NEXT_STEP[urg.level],
    selfCare: firstN(selfCare, 5), monitor: firstN(monitor, 6), seekHelpIf: firstN(seek, 6),
    emergencySigns: EMERGENCY_SIGNS.slice(),
    redFlags: [],
    facts: buildFacts(ctx, unexplained),
    disclaimer: "This is general information, not a diagnosis. See a licensed clinician for anything you're unsure about."
  };
  return result;
}

function realFeverAndHeadache(ctx) {
  const fever = ctx.keySet.has("fever") || (ctx.temp && ctx.temp.c >= 38);
  return !!fever && ctx.keySet.has("headache");
}

root.MeridianAnalysis = {
  version: VERSION, analyze, normalize,
  labelFor, RED_FLAG_TEXT, URGENCY_LABEL, URGENCY_LEVELS: LEVELS.slice(), STRENGTHS: STRENGTHS.slice(),
  SYMPTOM_LABELS, DURATION_LABELS: DURATIONS,
  conditions: CONDITIONS.map(c => ({ id: c.id, name: c.name }))
};
if (typeof module !== "undefined") module.exports = root.MeridianAnalysis;
})(typeof window !== "undefined" ? window : globalThis);
