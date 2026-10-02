/* ==========================================================
   Meridian — conversation engine (Phase 3)
   Deterministic rules only: no AI/LLM, no network calls.
   Turns free text into structured facts (symptoms, duration,
   temperature, severity, age), asks one useful question at a
   time, and stops on red flags. Results still come from the
   existing CONDITIONS scoring in script.js.
   ========================================================== */
(function (root) {
"use strict";

/* [key, display name, definite pattern, tentative pattern] — keys match the manual checklist */
const LEX = [
["mild_fever","mild fever",/\b(low[- ]grade|slight|mild)\s+(fever|temperature)\b/],
["fever","fever",/\bfevers?\b|\b(high|raised|elevated) temperature\b|\brunning a temp/,/\bfeverish\b|\bburning up\b|\b(feel|feeling|feels|am|i'm|im)\s+(really |very |so |quite )?(hot|warm|overheated)\b/],
["chills","chills",/\bchills?\b|\bshiver(ing|s|y)\b/],
["fatigue","fatigue",/\b(tired|tiredness|fatigued?|exhausted|exhaustion|worn out|run down|drained|lethargic|no energy|low energy)\b/,/\bweak(ness)?\b/],
["night_sweats","night sweats",/\bnight sweats?\b|\bsweat(ing)? (a lot )?(at|during|through) the night\b/],
["headache","headache",/\bhead ?aches?\b|\bmigraines?\b|\bhead (hurts|aches|is (pounding|throbbing|splitting|killing me))\b|\bhead pain\b/],
["dizziness","dizziness",/\bdizz(y|iness)\b|\blight[- ]?headed\b|\bvertigo\b|\bfeel(ing)? faint\b|\broom (is )?spinning\b/],
["light_sensitivity","sensitivity to light",/\b(sensitive|sensitivity) to (the )?light\b|\blight (hurts|bothers)\b|\bphotophobia\b/],
["visual_aura","visual disturbances (aura)",/\baura\b|\bzig-?zag\b|\bflashing lights\b/],
["neck_stiffness","stiff neck",/\bstiff neck\b|\bneck (is )?(stiff|rigid)\b|\bneck stiffness\b/,/\bneck (pain|hurts|ache|is sore)\b|\bsore neck\b/],
["trouble_sleeping","trouble sleeping",/\b(trouble|difficulty|problems?) (sleeping|falling asleep|staying asleep)\b|\binsomnia\b|\bcan'?t (fall asleep|sleep)\b|\bnot sleeping\b/],
["sore_throat","sore throat",/\bsore throat\b|\bthroat (is )?(sore|hurts|scratchy|itchy|raw|painful)\b|\bscratchy throat\b|\bthroat pain\b/],
["difficulty_swallowing","pain swallowing",/\b(hurts|painful|difficult|hard|trouble|pain) (to |when |on )?swallow\w*|\bswallowing (hurts|is (painful|hard|difficult))\b/],
["cough","cough",/\bcough(s|ing|ed)?\b/],
["runny_nose","runny nose",/\brunny nose\b|\bnose (is )?running\b|\bsniffles\b/],
["sneezing","sneezing",/\bsneez\w*/],
["congestion","nasal congestion",/\b(blocked|stuffy|stuffed|congested|clogged)( up)? nose\b|\bnose (is )?(blocked|stuffy|stuffed|congested|clogged)\b|\bcongest\w*|\bstuffed up\b/],
["thick_mucus","thick or discolored mucus",/\b(thick|green|yellow|discolou?red)\s+(mucus|phlegm|snot|discharge)\b/,/\bphlegm\b|\bmucus\b/],
["facial_pain","facial pain or pressure",/\b(facial|face|sinus) (pain|pressure|ache)\b|\bpressure (in|around|behind) (my )?(face|cheeks|eyes|forehead|sinuses)\b/],
["swollen_glands","swollen glands",/\bswollen (glands|lymph nodes)\b|\b(glands|lymph nodes) (are )?(swollen|enlarged|tender)\b/],
["nausea","nausea",/\bnaus(ea|eous|eated)\b|\bqueasy\b|\bsick to my stomach\b/,/\b(feel|feeling|feels) sick\b|\b(stomach|tummy) (feels|is) (sick|upset|queasy)\b|\bupset stomach\b|\bfeel like (i'?m going to|i might|i'?ll) (throw up|vomit)\b/],
["vomiting","vomiting",/\bvomit\w*|\bthrow(ing|n)? up\b|\bthrew up\b|\bpuk(e|ing|ed)\b/],
["diarrhea","diarrhea",/\bdiarrh?oea\b|\bdiarrhea\b|\bloose (stools?|motions?)\b|\bwatery (stools?|poop)\b/],
["lower_abdo_pain","lower abdominal pain",/\blower (abdominal|abdomen|belly|tummy|stomach) (pain|ache|cramps?)\b|\bpain in (my )?lower (abdomen|belly|stomach)\b/,/\bpelvic pain\b/],
["stomach_cramps","stomach pain or cramps",/\bstomach (cramps?|cramping|pain|ache|aches|hurts|is hurting)\b|\b(tummy|belly|abdominal|abdomen) (pain|ache|cramps?|hurts)\b|\bmy (stomach|tummy|belly) (hurts|aches)\b|\bpain in (my )?(stomach|belly|abdomen|tummy)\b/,/\bcramps\b|\bcramping\b/],
["loss_of_appetite","loss of appetite",/\bloss of appetite\b|\b(no|poor|low|lost (my )?|reduced) appetite\b|\bnot hungry\b|\b(don'?t|do not) (feel like|want to) eat(ing)?\b|\boff (my )?food\b/],
["rash","rash",/\brash(es)?\b/,/\bred (spots|patches|bumps)\b|\bbreaking out\b/],
["hives","hives",/\bhives\b|\burticaria\b|\bwelts\b/],
["itching","itching",/\bitch(y|ing|es)?\b(?!\s+(eyes?|nose|throat|ears?))/],
["swelling","swelling",/\bswollen\b|\bswelling\b/,/\bpuffy\b/],
["muscle_aches","muscle aches",/\bmuscle (aches?|pain|pains|soreness)\b|\b(body|bodily) (aches?|pains?)\b|\bachy\b|\baches? (all over|everywhere)\b|\bmuscles? (are |feel )?(sore|achy|aching)\b|\bsore muscles?\b/],
["joint_pain","joint pain",/\bjoint (pain|pains|ache|aches|stiffness)\b|\bjoints? (hurt|hurts|are (sore|painful|stiff|aching))\b/,/\b(knee|elbow|wrist|ankle|hip|finger)s? (pain|hurts|ache)\b/],
["limited_movement","limited movement or stiffness",/\b(limited|reduced|restricted) (range of )?(movement|motion|mobility)\b|\bhard to move\b/,/\bstiff(ness)?\b/],
["burning_urination","burning when urinating",/\bburning (when|while|during|on) (i )?(urinat\w*|pee\w*)|\b(painful|pain|stinging) (when|while|to) (i )?(urinat\w*|pee\w*)|\bburning urination\b|\bpainful urination\b|\bpee burns\b/],
["frequent_urination","frequent urination",/\b(urinat\w*|pee\w*) (a lot|often|frequently)\b|\bfrequent urination\b|\bneed to (pee|urinate) (a lot|often|all the time)\b|\bkeep (needing|having) to (pee|urinate)\b/]
];
const NAME = {}; LEX.forEach(l => NAME[l[0]] = l[1]);

/* things people mention that Meridian's checker doesn't cover — acknowledged, never scored */
const OTHER = [["back pain",/\bback ?(pain|ache|hurts)\b/],["ear pain",/\bear ?(ache|pain|hurts)\b/],["toothache",/\btooth ?ache\b/],["blurred vision",/\bblurr?(y|ed) vision\b/],["palpitations",/\bpalpitations\b|\bheart (racing|pounding|fluttering)\b/],["constipation",/\bconstipat\w*/],["heartburn",/\bheartburn\b|\bacid reflux\b/],["bloating",/\bbloat\w*/],["wheezing",/\bwheez\w*/],["numbness or tingling",/\bnumbness\b|\btingling\b|\bpins and needles\b/],["weight loss",/\bweight loss\b|\blost weight\b/]];

/* red flags — ids match the manual checklist (+ confusion, fainting, sudden_headache) */
const RF = [
["cardiac",/\bchest (pain|pressure|tightness|discomfort)\b|\bpressure (in|on) (my )?chest\b|\btight(ness)? (in|across) (my )?chest\b|\bchest (feels )?(tight|heavy|crushing)\b|\bheart attack\b/],
["stroke",/\b(face|facial) (is )?(droop\w*|numb)\b|\bdrooping (face|smile)\b|\bslurred speech\b|\bslurring\b|\b(arm|leg) (is |feels )?(suddenly )?(weak|numb)\b|\bweak(ness)? (on|in) (one|my (left|right)) (side|arm|leg)\b|\btrouble speaking\b/],
["breathing",/\b(severe|extreme|serious|terrible|acute)\b[^.,;]{0,25}\b(breath\w*|short of breath)\b|\b(breath\w*|short of breath)\b[^.,;]{0,15}\b(severe|extreme)\b|\bcan'?t (catch my )?breath\w*|\bgasping\b|\bstruggling to breathe\b|\b(blue|bluish|purple) (lips|face)\b|\blips (are |turning )?blue\b|\bstopped breathing\b|\bunable to breathe\b/],
["bleeding",/\b(cough\w*|vomit\w*|throw\w* up|spit\w*)\b[^.;]{0,15}\bblood\b|\bblood in (my )?(vomit|sputum|phlegm)\b|\b(heavy|severe|uncontrolled)\b[^.;]{0,15}bleeding|\bbleeding (heavily|a lot|that won'?t stop)|\bwon'?t stop bleeding\b/],
["meningitis",/\bnon-?blanching\b|\brash\b[^.;]{0,30}(doesn'?t|does not|won'?t) (fade|go away)\b/],
["abdo",/\b(severe|extreme|unbearable|excruciating|terrible|worst)\b[^.;]{0,25}\b(stomach|abdominal|abdomen|belly|tummy)\b[^.;]{0,10}\b(pain|ache|cramps?)\b|\b(stomach|abdominal|belly)\s+(pain|ache)\b[^.;]{0,20}\b(severe|unbearable|excruciating)\b|\brigid (belly|abdomen|stomach)\b|\bbelly (is )?(hard|rigid)\b/],
["confusion",/\b(feel(ing)?|am|i'?m|been|getting) (very |really |suddenly )?(confused|disoriented)\b(?!\s+(about|by|why|what))|\bnew confusion\b|\bconfusion\b|\bhard to (stay awake|wake)\b/],
["fainting",/\b(fainted|passed out|blacked out|lost consciousness|collapsed|unconscious)\b/],
["sudden_headache",/\b(sudden|suddenly|thunderclap|worst)\b[^.;]{0,25}\bhead ?ache\b|\bworst (headache|pain)\b|\bhead ?ache\b[^.;]{0,25}\b(sudden|out of nowhere|worst)\b/]
];
const RF_OPTIONS = [
  {label:"Chest pain or pressure",value:"cardiac"},
  {label:"Face drooping, arm weakness, or slurred speech",value:"stroke"},
  {label:"Severe difficulty breathing",value:"breathing"},
  {label:"Heavy bleeding, or coughing/vomiting blood",value:"bleeding"},
  {label:"Stiff neck with fever, or confusion",value:"meningitis"},
  {label:"Sudden, severe abdominal pain",value:"abdo"}
];

const NEG = /\b(no|not|without|never|denies|free of|isn'?t|haven'?t|hasn'?t|don'?t have|do not have|doesn'?t have|didn'?t have)\b/;
const HEDGE = /\b(maybe|perhaps|i think|i guess|might|possibly|not sure|not certain|could be|seems like|kind of|sort of)\b/;
const YES = /^\s*(yes|yeah|yep|yup|y|sure|correct|i do|it does|definitely)\b/i;
const NO = /^\s*(no|nope|nah|n|none|not really|never|i don'?t|it doesn'?t|neither)\b/i;

const norm = t => " " + String(t).toLowerCase().replace(/[\u2018\u2019]/g, "'") + " ";
function before(t, i) {
  const w = t.slice(Math.max(0, i - 45), i);
  const c = Math.max(...[",", ".", ";", "!", "?", " but ", " however ", " although "].map(x => w.lastIndexOf(x)));
  return (c >= 0 ? w.slice(c + 1) : w).replace(/\bnot (sure|certain)\b/g, "maybe").replace(/\bno idea\b|\bdon'?t know\b/g, " ");
}
function each(t, rx, fn) {
  const g = new RegExp(rx.source, "g"); let m;
  while ((m = g.exec(t))) { if (fn(m, before(t, m.index)) === false) return; }
}
function scan(text) {
  let t = norm(text); const o = { yes: [], maybe: [], no: [] }, pos = {};
  for (const [k, , re, tre] of LEX) for (const [rx, tent] of [[re, 0], [tre, 1]]) {
    if (!rx) continue;
    each(t, rx, (m, w) => {
      const b = NEG.test(w) ? "no" : (tent || HEDGE.test(w)) ? "maybe" : "yes";
      if (!o[b].includes(k)) o[b].push(k);
      pos[k] = Math.min(pos[k] === undefined ? 1e9 : pos[k], m.index);
      t = t.slice(0, m.index) + " ".repeat(m[0].length) + t.slice(m.index + m[0].length);
    });
  }
  o.yes.sort((a, b) => pos[a] - pos[b]);
  return o;
}
function scanRF(text) {
  const t = norm(text), out = [];
  for (const [id, re] of RF) each(t, re, (m, w) => { if (!NEG.test(w)) { out.push(id); return false; } });
  return out;
}
function scanOther(text) {
  const t = norm(text), out = [];
  for (const [n, re] of OTHER) each(t, re, (m, w) => { if (!NEG.test(w)) { out.push(n); return false; } });
  return out;
}

/* ---------- value parsers ---------- */
const NUMW = { a:1, an:1, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, "couple of":2, few:3 };
const DUR = { today:"today", days:"a few days", week:"about a week", weeks:"more than two weeks" };
function parseDuration(text) {
  const t = String(text).toLowerCase(); let m;
  if ((m = t.match(/\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple of|few)\s+(hour|day|week|month)s?\b/))) {
    const n = NUMW[m[1]] || parseInt(m[1], 10), u = m[2];
    const k = u === "hour" ? "today" : u === "day" ? (n < 7 ? "days" : n < 14 ? "week" : "weeks") : u === "week" ? (n < 2 ? "week" : "weeks") : "weeks";
    return [k, m[0]];
  }
  if ((m = t.match(/\b(today|tonight|this (morning|afternoon|evening)|just (started|now)|hours? ago)\b/))) return ["today", m[0]];
  if ((m = t.match(/\b(yesterday|last night|couple of days|few days)\b/))) return ["days", m[0]];
  if ((m = t.match(/\b(last week|a week|week or so)\b/))) return ["week", m[0]];
  if ((m = t.match(/\b(weeks|months|long time|ages)\b/))) return ["weeks", m[0]];
  return null;
}
function parseTemp(text, force) {
  const t = String(text).toLowerCase();
  const m = t.match(/(\d{2,3}(?:\.\d)?)\s*(°|degrees?)?\s*(f\b|c\b|fahrenheit|celsius|centigrade)?/);
  if (!m || (!force && !/temp|fever|degree|°|\d\s*[fc]\b/.test(t))) return null;
  const v = parseFloat(m[1]), u = m[3] ? m[3][0] : (v > 45 ? "f" : "c");
  const c = u === "f" ? (v - 32) * 5 / 9 : v;
  return c < 34 || c > 43 ? null : { c: Math.round(c * 10) / 10, text: m[1] + (u === "f" ? "°F" : "°C") };
}
function parseSev(text, force) {
  const t = String(text).toLowerCase(); let m;
  if (/\b(severe|terrible|unbearable|excruciating|intense|awful|very bad|really bad)\b/.test(t)) return ["severe", 8];
  if (/\b(moderate|medium|in between)\b/.test(t)) return ["moderate", 5];
  if (/\b(mild|slight|minor)\b(?!\s+(fever|temperature|cough|cold))/.test(t)) return ["mild", 3];
  if ((m = t.match(/\b(\d{1,2})\s*(?:\/|out of)\s*10\b/)) || (force && (m = t.match(/^\D*(\d{1,2})\D*$/)))) {
    const n = +m[1]; if (n >= 1 && n <= 10) return [n >= 8 ? "severe" : n >= 4 ? "moderate" : "mild", n];
  }
  return null;
}
function parseAge(text, force) {
  const t = String(text).toLowerCase();
  const m = t.match(/\b(?:i'?m|i am|aged?)\s*(\d{1,3})\b|\b(\d{1,3})[- ]?(?:years?|yrs?)[- ]?old\b/) || (force && t.match(/^\D*(\d{1,3})\D*$/));
  const n = m && parseInt(m[1] || m[2], 10);
  return n >= 1 && n <= 120 ? n : null;
}

/* ---------- state ---------- */
function newState() {
  return { yes: new Set(), maybe: new Set(), no: new Set(), order: [], other: [], notes: [], duration: null, durText: "",
    severity: null, sevWord: null, sevFor: null, temp: null, age: null, asked: new Set(), pending: null,
    breathQ: false, empty: 0, turns: 0, stopped: false, rf: [] };
}
function setS(s, k, st, added) {
  s.yes.delete(k); s.no.delete(k); s.maybe.delete(k);
  s[st].add(k);
  if (st === "yes") { if (!s.order.includes(k)) s.order.push(k); if (added && !added.includes(k)) added.push(k); }
}
const primary = s => s.order.find(k => s.yes.has(k));
const cap = x => x.charAt(0).toUpperCase() + x.slice(1);
const YN = [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }];

const ASSOC = {
  headache: ["nausea", "light_sensitivity", "visual_aura", "neck_stiffness", "fever", "dizziness"],
  fever: ["chills", "muscle_aches", "cough", "sore_throat", "headache", "fatigue"],
  cough: ["fever", "sore_throat", "runny_nose", "congestion", "thick_mucus", "__breath"],
  stomach_cramps: ["nausea", "vomiting", "diarrhea", "fever", "loss_of_appetite"],
  lower_abdo_pain: ["burning_urination", "frequent_urination", "fever", "nausea"],
  fatigue: ["trouble_sleeping", "fever", "loss_of_appetite", "dizziness", "muscle_aches"],
  sore_throat: ["fever", "swollen_glands", "cough", "difficulty_swallowing"],
  nausea: ["vomiting", "diarrhea", "stomach_cramps", "fever"]
};
ASSOC.mild_fever = ASSOC.fever; ASSOC.runny_nose = ASSOC.cough; ASSOC.congestion = ASSOC.cough;
ASSOC.vomiting = ASSOC.nausea; ASSOC.diarrhea = ASSOC.nausea;

function ask(s, q) { s.asked.add(q.id); s.pending = q; return q; }
function next(s) {
  const mk = [...s.maybe][0];
  if (mk) return ask(s, { id: "confirm:" + mk, text: `Just so I don't assume — would you say you have ${NAME[mk]}?`, options: YN });
  if (s.breathQ && !s.asked.has("breath")) return ask(s, { id: "breath", text: "You mentioned trouble breathing. Is it happening even while you're resting, or so bad that you can't speak a full sentence?", options: YN });
  const p = primary(s);
  if (!p) {
    s.empty++;
    return ask(s, s.empty > 1
      ? { id: "nosym" + s.empty, text: "I'm having trouble picking out symptoms I can work with. You can describe it another way, or choose from a list instead.", options: [{ label: "Choose symptoms instead", value: "__manual" }] }
      : { id: "nosym" + s.empty, text: "Can you tell me a bit more about what you're feeling — for example, where it hurts or what bothers you most?" });
  }
  if (!s.asked.has("duration") && !s.duration) return ask(s, { id: "duration", text: "When did this start?",
    options: [{ label: "Today", value: "today" }, { label: "1–3 days", value: "days" }, { label: "About a week", value: "week" }, { label: "More than 2 weeks", value: "weeks" }] });
  if ((s.yes.has("fever") || s.yes.has("mild_fever")) && !s.temp && !s.asked.has("temp"))
    return ask(s, { id: "temp", text: "What's your temperature, if you've measured it?", options: [{ label: "I haven't measured", value: "__none" }] });
  if (!s.severity && !s.asked.has("severity")) { s.sevFor = p; return ask(s, { id: "severity", text: `How would you describe your ${NAME[p]}?`,
    options: [{ label: "Mild", value: "mild" }, { label: "Moderate", value: "moderate" }, { label: "Severe", value: "severe" }] }); }
  if (s.yes.has("headache") && s.sevWord === "severe" && !s.asked.has("sudden")) return ask(s, { id: "sudden", text: "Did the headache come on suddenly, reaching its worst within a minute or so?", options: YN });
  if (s.yes.has("stomach_cramps") && !s.yes.has("lower_abdo_pain") && !s.asked.has("where")) return ask(s, { id: "where", text: "Where do you feel the pain most?",
    options: [{ label: "Upper or around the belly button", value: "upper" }, { label: "Lower belly", value: "lower" }, { label: "All over", value: "all" }] });
  if (!s.asked.has("assoc")) {
    const src = s.order.find(k => s.yes.has(k) && ASSOC[k]);
    const opts = src ? ASSOC[src].filter(k => k === "__breath" || (!s.yes.has(k) && !s.no.has(k))).slice(0, 6) : [];
    if (opts.length) return ask(s, { id: "assoc", multi: true, none: "None of these", text: "Are you having any of these too? Choose all that apply.",
      options: opts.map(k => ({ label: k === "__breath" ? "Shortness of breath" : cap(NAME[k]), value: k })) });
    s.asked.add("assoc");
  }
  if (!s.asked.has("safety")) return ask(s, { id: "safety", multi: true, none: "None of these apply", text: "One safety check before I finish. Do any of these apply to you right now?", options: RF_OPTIONS });
  if (!s.age && !s.asked.has("age")) return ask(s, { id: "age", text: "Last one: how old are you?", input: "number" });
  return { id: "done", done: true, text: "Thanks — that's what I need. Ready to see what this may point to?" };
}

/* ---------- one conversational turn ---------- */
function step(s, inp) {
  const text = String(inp.text || "").trim(), v = inp.value, p = s.pending, first = s.turns === 0;
  s.pending = null; s.turns++;
  const added = [], got = [], rf = text ? scanRF(text) : [];
  const yn = YES.test(text) || v === "yes" ? 1 : NO.test(text) || v === "no" ? 0 : -1;

  if (p) {
    const id = p.id;
    if (id.startsWith("confirm:")) { const k = id.slice(8); if (yn === 1) setS(s, k, "yes", added); else if (yn === 0) setS(s, k, "no"); else s.maybe.delete(k); }
    else if (id === "duration") { const d = DUR[v] ? [v, DUR[v]] : parseDuration(text); if (d) { s.duration = d[0]; s.durText = d[1]; } }
    else if (id === "temp") { const t = parseTemp(text, true); if (t) s.temp = t; }
    else if (id === "severity") { const r = parseSev(text, true); if (r) { s.sevWord = r[0]; s.severity = r[1]; } }
    else if (id === "sudden") { if (yn === 1) rf.push("sudden_headache"); }
    else if (id === "breath") { if (yn === 1) rf.push("breathing"); else if (yn === 0) s.other.push("some breathlessness"); }
    else if (id === "where") { if (v === "lower") { setS(s, "stomach_cramps", "no"); setS(s, "lower_abdo_pain", "yes", added); } }
    else if (id === "assoc") { (Array.isArray(v) ? v : []).forEach(k => k === "__breath" ? (s.breathQ = true) : setS(s, k, "yes", added));
      p.options.forEach(o => { if (!(v || []).includes(o.value) && o.value !== "__breath" && !s.yes.has(o.value)) s.no.add(o.value); }); }
    else if (id === "safety") { (Array.isArray(v) ? v : []).forEach(x => rf.push(x)); }
    else if (id === "age") { const a = parseAge(text, true); if (a) s.age = a; }
  }

  /* anything volunteered in typed text — used even when a question was pending */
  const sc = scan(text);
  sc.yes.forEach(k => setS(s, k, "yes", added));
  sc.no.forEach(k => { if (!added.includes(k)) setS(s, k, "no"); });
  sc.maybe.forEach(k => { if (!s.yes.has(k)) { s.no.delete(k); s.maybe.add(k); } });
  const d = parseDuration(text); if (d && (!p || p.id !== "duration")) { s.duration = d[0]; s.durText = d[1]; }
  const tp = parseTemp(text, false); if (tp) s.temp = tp;
  const sv = (!p || p.id !== "severity") ? parseSev(text, false) : null; if (sv && !s.severity) { s.sevWord = sv[0]; s.severity = sv[1]; s.sevFor = primary(s); }
  const ag = parseAge(text, false); if (ag) s.age = ag;
  if (/\bafter (eating|meals?|food)\b/i.test(text) && !s.notes.includes("it happens after eating")) s.notes.push("it happens after eating");
  scanOther(text).forEach(n => { if (!s.other.includes(n)) { s.other.push(n); got.push({ other: n }); } });
  if (!rf.includes("breathing") && /\b(short(ness)? of breath|trouble breathing|difficulty breathing|hard to breathe|breathless\w*)\b/i.test(text) && !/\b(no|not|without)\b[^.]{0,20}breath/i.test(text)) s.breathQ = true;

  /* temperature decides fever vs low-grade fever */
  if (s.temp) {
    if (s.temp.c >= 38) { setS(s, "fever", "yes", s.yes.has("fever") ? null : added); s.yes.delete("mild_fever"); s.order = s.order.filter(k => k !== "mild_fever"); }
    else if (s.temp.c >= 37.3) { if (s.yes.has("fever")) { s.yes.delete("fever"); s.order = s.order.filter(k => k !== "fever"); } setS(s, "mild_fever", "yes", s.yes.has("mild_fever") ? null : added); }
    else { ["fever", "mild_fever"].forEach(k => { s.yes.delete(k); s.maybe.delete(k); s.order = s.order.filter(x => x !== k); }); if (!s.notes.includes("your temperature reading was in the usual range")) s.notes.push("your temperature reading was in the usual range"); }
  }
  /* combinations that need urgent attention */
  if (s.yes.has("fever") && s.yes.has("neck_stiffness")) rf.push("meningitis");
  if (s.sevWord === "severe" && ["stomach_cramps", "lower_abdo_pain"].includes(s.sevFor)) rf.push("abdo");

  if (rf.length) { s.stopped = true; s.rf = [...new Set(rf)]; return { rf: s.rf }; }

  const say = [], bits = added.filter(k => s.yes.has(k)).map(k => NAME[k]);
  if (s.durText && (first || (p && p.id === "duration"))) bits.push(durPhrase(s.durText));
  if (s.temp && (tp || (p && p.id === "temp"))) bits.push("temperature " + s.temp.text);
  if (s.sevWord && p && p.id === "severity") bits.push(s.sevWord + " " + NAME[s.sevFor || primary(s)]);
  if (s.age && p && p.id === "age") bits.push("age " + s.age);
  if (bits.length) say.push((first ? "Thanks. Here's what I've noted: " : "Got it — ") + bits.join(", ") + ".");
  else if (p && !first) say.push("Thanks.");
  const oth = got.map(g => g.other);
  if (oth.length) say.push(`I noted ${oth.join(" and ")}, but Meridian's checker doesn't cover that yet, so I can't include it in the possibilities. It's still worth mentioning to a clinician.`);
  const q = next(s);
  return { say, q, done: !!q.done };
}

function durPhrase(d) {
  if (/^(yesterday|last night|last week)/.test(d)) return "since " + d;
  if (/^(today|tonight|this |just )/.test(d)) return "started " + d;
  if (/ago$/.test(d)) return d;
  return "for " + d;
}
function assessment(s) {
  if (!s) return { redFlags: [], keys: [], labels: [], duration: null, severity: null, age: null, temp: null, denied: [], other: [], notes: [] };
  const keys = s.order.filter(k => s.yes.has(k));
  return {
    redFlags: s.rf ? s.rf.slice() : [],
    keys,
    labels: keys.map(k => cap(NAME[k])),
    duration: s.duration,
    severity: s.severity,
    age: s.age,
    temp: s.temp || null,
    denied: s.no ? [...s.no] : [],
    other: s.other ? s.other.slice() : [],
    notes: s.notes ? s.notes.slice() : []
  };
}

root.MeridianChat = { newState, step, assessment, NAME, scan, scanRF, parseDuration, parseTemp };
if (typeof module !== "undefined") module.exports = root.MeridianChat;
})(typeof window !== "undefined" ? window : globalThis);
