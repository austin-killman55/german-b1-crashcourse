import { enrichWord } from "./enrich.js";

const DAY = 86400000;
const MAX_IVL = 365;
const NEW_PER_DAY = 20;
const STORE_KEY = "vokabeltrainer.cards.v1";
const API_KEY = "vokabeltrainer.apikey";

/* ---------- utils ---------- */
function todayStr(d) {
  const t = d || new Date();
  return new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function addDays(days) { return todayStr(new Date(Date.now() + days * DAY)); }
function fmtIvl(days) {
  if (days <= 0) return "jetzt";
  if (days === 1) return "1 Tag";
  if (days < 31) return days + " Tage";
  if (days < 365) return Math.round(days / 30) + " Mon.";
  return (Math.round(days / 36.5) / 10) + " J.";
}
const DE_DATE = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
function fmtDay(iso) {
  const p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!p) return iso || "ohne Datum";
  return DE_DATE.format(new Date(Number(p[1]), Number(p[2]) - 1, Number(p[3])));
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
// Older cards store example/note as HTML with <em>/<b>; keep only those tags.
function safeHtml(s) {
  return esc(s).replace(/&lt;(\/?)(em|b|i|strong)&gt;/g, "<$1$2>");
}
function slug(w) {
  return w.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
    .replace(/ß/g, "ss").trim().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "");
}
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }

/* ---------- speech ---------- */
const SPEECH = "speechSynthesis" in window;
let deVoice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices() || [];
  deVoice = vs.find(v => v.lang === "de-DE" && /google|siri|premium|enhanced/i.test(v.name))
         || vs.find(v => v.lang === "de-DE")
         || vs.find(v => (v.lang || "").toLowerCase().startsWith("de")) || null;
}
if (SPEECH) { pickVoice(); speechSynthesis.addEventListener("voiceschanged", pickVoice); }
const scrub = document.createElement("div");
function speak(text, btn) {
  if (!SPEECH) return;
  scrub.innerHTML = text;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(scrub.textContent.trim());
  u.lang = "de-DE"; if (deVoice) u.voice = deVoice; u.rate = 0.88;
  if (btn) {
    btn.classList.add("speaking");
    const off = () => btn.classList.remove("speaking");
    u.addEventListener("end", off); u.addEventListener("error", off);
  }
  speechSynthesis.speak(u);
}
const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
function sayButton(label, textFn) {
  const b = document.createElement("button");
  b.className = "say";
  b.innerHTML = ICON + "<span>hören</span>";
  b.setAttribute("aria-label", "Aussprache anhören: " + label);
  b.addEventListener("click", (e) => { e.stopPropagation(); speak(textFn(), b); });
  if (!SPEECH) b.hidden = true;
  return b;
}

/* ---------- scheduling (SM-2 flavoured) ---------- */
function schedule(card, g) {
  let ease = typeof card.ease === "number" ? card.ease : 2.5;
  let ivl = card.ivl || 0, state = card.state || "new", lapses = card.lapses || 0;
  if (g === 1) {
    ease = Math.max(1.3, ease - 0.2);
    if (state === "review") lapses += 1;
    ivl = 0; state = "learning";
  } else if (ivl === 0) {
    if (g === 2) { ease = Math.max(1.3, ease - 0.15); ivl = 1; }
    else if (g === 3) { ivl = state === "learning" ? 2 : 1; }
    else { ease = ease + 0.1; ivl = 4; }
    state = "review";
  } else {
    if (g === 2) { ease = Math.max(1.3, ease - 0.15); ivl = Math.max(1, Math.round(ivl * 1.2)); }
    else if (g === 3) { ivl = Math.max(1, Math.round(ivl * ease)); }
    else { ease = ease + 0.1; ivl = Math.max(1, Math.round(ivl * ease * 1.3)); }
    state = "review";
  }
  ivl = Math.min(MAX_IVL, ivl);
  return { ease: Math.round(ease * 100) / 100, ivl, state, lapses,
           reps: (card.reps || 0) + 1, due: ivl === 0 ? todayStr() : addDays(ivl) };
}

/* ---------- state ---------- */
let cards = [];
let queue = [];
let pos = 0;
let revealed = false;
let done = 0;
let last = null;
let dayOrder = {};
let pending = null; // card produced by Claude, not yet saved

const $ = (id) => document.getElementById(id);
const GENDER = { der: "var(--der)", die: "var(--die)", das: "var(--das)" };
const isReversed = (c) => c.dir === "en";

function persist() {
  if (!lsSet(STORE_KEY, JSON.stringify(cards))) console.warn("Speichern im Browser nicht möglich.");
}

/* ---------- card rendering ---------- */
const CASE_NAME = { nom: "Nominativ", akk: "Akkusativ", dat: "Dativ", gen: "Genitiv" };

function exampleHtml(c) {
  if (Array.isArray(c.ex) && c.ex.length) {
    return c.ex.map(s => {
      let t = esc(s.text);
      if (s.target) t = "<strong>" + t + "</strong>";
      return CASE_NAME[s.case]
        ? '<span class="c c-' + s.case + '" title="' + CASE_NAME[s.case] + '">' + t + "</span>"
        : t;
    }).join("");
  }
  return c.de ? safeHtml(c.de) : "";
}
function exampleText(c) {
  if (Array.isArray(c.ex) && c.ex.length) return c.ex.map(s => s.text).join("");
  return c.de || "";
}
function legendHtml(c) {
  if (!Array.isArray(c.ex)) return "";
  const used = ["nom", "akk", "dat", "gen"].filter(k => c.ex.some(s => s.case === k));
  if (!used.length) return "";
  return '<div class="legend">' + used.map(k =>
    '<span class="l-' + k + '"><i></i>' + CASE_NAME[k] + "</span>").join("") + "</div>";
}
function caseClass(k) {
  return { "Akk": "k-akk", "Dat": "k-dat", "Gen": "k-gen" }[k] || "k-mix";
}

// Präsens / Präteritum / Perfekt — from Claude's verb object, or parsed from
// older cards' "freut sich · freute sich · hat sich gefreut" forms line.
function tenses(c) {
  if (c.verb && c.verb.present) return [c.verb.present, c.verb.praeteritum, c.verb.perfekt];
  if (c.pos === "Verb" && c.forms) {
    const p = c.forms.split("·").map(s => s.trim());
    if (p.length === 3) return p;
  }
  return null;
}

function grammarHtml(c) {
  const parts = [];
  const t = tenses(c);
  if (t) {
    parts.push('<div class="tenses">' +
      ["Präsens", "Präteritum", "Perfekt"].map((label, i) =>
        "<div><span>" + label + "</span><b>" + esc(t[i]) + "</b></div>").join("") + "</div>");
  }
  const chips = [];
  if (c.verb) {
    const oc = c.verb.object_case;
    if (oc && oc !== "keins") chips.push('<span class="chip ' + caseClass(oc.split(" ")[0]) + '">+ ' + esc(oc) + "</span>");
    if (oc === "keins") chips.push('<span class="chip">ohne Objekt</span>');
    if (c.verb.reflexive && c.verb.reflexive !== "nein") {
      chips.push('<span class="chip ' + (c.verb.reflexive.includes("Dat") ? "k-dat" : "k-akk") +
        '">reflexiv: ' + esc(c.verb.reflexive) + "</span>");
    }
    if (c.verb.separable) chips.push('<span class="chip">trennbar</span>');
  }
  if (chips.length) parts.push('<div class="chips">' + chips.join("") + "</div>");
  if (Array.isArray(c.preps) && c.preps.length) {
    parts.push('<ul class="preps">' + c.preps.map(p =>
      "<li><b>" + esc(p.preposition) + '</b> <span class="chip ' + caseClass(p.case) + '">+ ' +
      esc(p.case) + "</span> — " + esc(p.meaning) +
      (p.example ? '<span class="ex">' + esc(p.example) + "</span>" : "") + "</li>").join("") + "</ul>");
  }
  return parts.length ? '<div class="gram">' + parts.join("") + "</div>" : "";
}

function headHtml(c) {
  return (GENDER[c.g] ? '<div class="article">' + esc(c.g) + "</div>" : "") +
    '<h2 class="word">' + esc(c.w) + "</h2>" +
    (c.say ? '<div class="respell">' + esc(c.say) + "</div>" : "");
}

function detailHtml(c, opts = {}) {
  const ex = exampleHtml(c);
  return (opts.meaning === false ? "" : '<div class="meaning">' + esc(c.m) + "</div>") +
    (ex ? '<div class="sentence">' + ex + "</div>" : "") +
    legendHtml(c) +
    (c.en ? '<div class="gloss">' + esc(c.en) + "</div>" : "") +
    (opts.forms === false || tenses(c) ? "" : '<div class="forms">' + esc(c.forms || "") + "</div>") +
    grammarHtml(c) +
    (c.note ? '<div class="note">' + safeHtml(c.note) + "</div>" : "");
}

function setGender(el, c) {
  if (GENDER[c.g]) el.style.setProperty("--gender", GENDER[c.g]);
  else el.style.removeProperty("--gender");
}

/* ---------- review ---------- */
function message(title, text) {
  $("msg-title").textContent = title;
  $("msg-text").textContent = text;
  $("msg").hidden = false;
  $("card").hidden = true;
  $("prog").hidden = true;
}

function stats() {
  const t = todayStr();
  $("s-due").textContent = cards.filter(c => c.state !== "new" && (c.due || t) <= t).length;
  $("s-new").textContent = cards.filter(c => c.state === "new").length;
  $("s-rev").textContent = cards.filter(isReversed).length;
  $("s-total").textContent = cards.length;
}

function buildQueue() {
  const t = todayStr();
  const due = cards.filter(c => c.state !== "new" && (c.due || t) <= t)
                   .sort((a, b) => (a.due || "").localeCompare(b.due || ""));
  const fresh = cards.filter(c => c.state === "new")
                     .sort((a, b) => (a.added || "").localeCompare(b.added || ""))
                     .slice(0, NEW_PER_DAY);
  queue = due.concat(fresh);
  pos = 0; done = 0; last = null;
}

function nextDueDate() {
  const t = todayStr();
  return cards.filter(c => c.due && c.due > t).map(c => c.due).sort()[0] || null;
}

function render() {
  if (pos >= queue.length) {
    const nd = nextDueDate();
    message(done ? "Fertig für heute" : (cards.length ? "Nichts fällig" : "Noch keine Karten"),
      (done ? done + " Karten wiederholt. " : "") +
      (nd ? "Die nächste Karte ist am " + nd + " dran." : "Füge unter „+ Wort“ neue Wörter hinzu."));
    $("undo").disabled = !last;
    return;
  }
  const c = queue[pos];
  $("msg").hidden = true;
  $("card").hidden = false;
  $("prog").hidden = false;
  $("prog-text").textContent = (pos + 1) + " von " + queue.length;
  $("prog-fill").style.width = (pos / queue.length * 100) + "%";
  setGender($("card"), c);

  const front = $("c-front"), back = $("c-answer");
  if (isReversed(c)) {
    front.innerHTML =
      '<span class="dirtag">Englisch → Deutsch</span>' +
      '<p class="prompt-en">' + esc(c.m) + "</p>" +
      (c.en ? '<div class="gloss">' + esc(c.en) + "</div>" : "") +
      '<div class="forms">' + esc(c.pos || "") + "</div>";
    back.innerHTML = headHtml(c) + detailHtml(c, { meaning: false });
    back.append(sayButton(c.w, () => c.w + ". " + exampleText(c)));
  } else {
    front.innerHTML = headHtml(c);
    front.append(sayButton(c.w, () => c.w));
    back.innerHTML = detailHtml(c);
    back.append(sayButton(c.w, () => exampleText(c) || c.w));
  }

  revealed = false;
  back.hidden = true;
  $("grades").hidden = true;
  $("reveal").hidden = false;
  $("undo").disabled = !last;
  for (let g = 1; g <= 4; g++) {
    $("i" + g).textContent = g === 1 ? "gleich nochmal" : fmtIvl(schedule(c, g).ivl);
  }
}

function reveal() {
  if (revealed || pos >= queue.length) return;
  revealed = true;
  $("c-answer").hidden = false;
  $("reveal").hidden = true;
  $("grades").hidden = false;
}

function grade(g) {
  if (!revealed || pos >= queue.length) return;
  const c = queue[pos];
  const before = { due: c.due, ivl: c.ivl, ease: c.ease, reps: c.reps,
                   lapses: c.lapses, state: c.state, dir: c.dir };
  Object.assign(c, schedule(c, g));
  if (g === 4) c.dir = "en";
  last = { card: c, before, pos, again: g === 1 };
  done += 1;
  if (g === 1) queue.push(c);
  pos += 1;
  persist(); stats(); render();
}

function undo() {
  if (!last) return;
  Object.assign(last.card, last.before);
  if (last.card.dir === undefined) delete last.card.dir;
  if (last.again) { const i = queue.lastIndexOf(last.card); if (i > last.pos) queue.splice(i, 1); }
  pos = last.pos; done = Math.max(0, done - 1);
  last = null;
  persist(); stats(); render(); reveal();
}

function shuffleQueue() {
  if (pos >= queue.length) return;
  queue = queue.slice(0, pos).concat(shuffle(queue.slice(pos)));
  last = null;
  render();
}

/* ---------- add word ---------- */
function cardFromClaude(r) {
  const isVerb = r.pos === "Verb";
  return {
    id: slug(r.lemma),
    w: r.lemma,
    g: r.article === "none" ? "–" : r.article,
    pos: r.pos,
    m: r.meaning,
    say: r.pronunciation,
    forms: r.forms,
    ex: r.example,
    en: r.example_en,
    verb: isVerb ? r.verb : null,
    preps: r.prepositions || [],
    note: r.note
  };
}

function setStatus(id, text, err) {
  const el = $(id);
  el.innerHTML = text;
  el.classList.toggle("err", !!err);
}

async function lookUp(word, hint) {
  const key = lsGet(API_KEY);
  if (!key) {
    setStatus("add-status", "Bitte zuerst unter <b>Einstellungen</b> einen Claude API-Schlüssel hinterlegen.", true);
    return null;
  }
  return cardFromClaude(await enrichWord(word, hint, key));
}

async function onAdd(e) {
  e.preventDefault();
  const word = $("add-word").value.trim();
  if (!word) return;
  const hint = $("add-hint").value.trim();
  $("add-go").disabled = true;
  $("add-preview").innerHTML = "";
  pending = null;
  setStatus("add-status", '<span class="spin"></span>Claude schlägt „' + esc(word) + "“ nach …");
  try {
    const c = await lookUp(word, hint);
    if (!c) return;
    pending = c;
    const existing = cards.find(x => x.id === c.id);
    setStatus("add-status", existing
      ? "„" + esc(c.w) + "“ ist schon in deiner Sammlung. Ersetzen behält den Lernstand."
      : "Vorschau — passt alles?");
    renderPreview(c, !!existing);
  } catch (err) {
    console.error(err);
    setStatus("add-status", "Fehler: " + esc(err && err.message ? err.message : err), true);
  } finally {
    $("add-go").disabled = false;
  }
}

function renderPreview(c, exists) {
  const box = document.createElement("div");
  box.className = "preview";
  setGender(box, c);
  const body = document.createElement("div");
  body.className = "body";
  body.innerHTML = '<div class="face">' + headHtml(c) +
    '<div class="forms">' + esc(c.pos) + (tenses(c) ? "" : " · " + esc(c.forms || "")) + "</div></div>" +
    '<div class="answer">' + detailHtml(c, { forms: false }) + "</div>";
  body.querySelector(".answer").append(sayButton(c.w, () => c.w + ". " + exampleText(c)));
  const actions = document.createElement("div");
  actions.className = "preview-actions";
  const discard = document.createElement("button");
  discard.textContent = "Verwerfen";
  discard.addEventListener("click", () => {
    pending = null; $("add-preview").innerHTML = ""; setStatus("add-status", "");
  });
  const save = document.createElement("button");
  save.className = "primary";
  save.textContent = exists ? "Ersetzen" : "Zur Sammlung hinzufügen";
  save.addEventListener("click", savePending);
  actions.append(discard, save);
  box.append(body, actions);
  $("add-preview").innerHTML = "";
  $("add-preview").append(box);
}

function mergeContent(target, c) {
  delete target.de;
  Object.assign(target, {
    w: c.w, g: c.g, pos: c.pos, m: c.m, say: c.say, forms: c.forms,
    ex: c.ex, en: c.en, verb: c.verb, preps: c.preps, note: c.note
  });
}

function savePending() {
  if (!pending) return;
  const existing = cards.find(x => x.id === pending.id);
  if (existing) {
    mergeContent(existing, pending);
  } else {
    cards.push(Object.assign(pending, {
      added: todayStr(), state: "new", ease: 2.5, ivl: 0, reps: 0, lapses: 0, dir: "de"
    }));
    // New cards join today's session right away.
    if (queue.filter(x => x.state === "new").length < NEW_PER_DAY) queue.push(pending);
  }
  const w = pending.w;
  pending = null;
  persist(); stats(); buildDays();
  if (!$("msg").hidden) render();
  $("add-preview").innerHTML = "";
  $("add-word").value = ""; $("add-hint").value = "";
  setStatus("add-status", "„" + esc(w) + "“ gespeichert. Nächstes Wort?");
  $("add-word").focus();
}

/* ---------- Tageswortschatz ---------- */
function buildDays() {
  const seen = {};
  cards.forEach(c => { const d = c.added || "ohne Datum"; (seen[d] = seen[d] || []).push(c); });
  dayOrder = seen;
  const sel = $("day-select");
  const keep = sel.value;
  sel.innerHTML = Object.keys(seen).sort().reverse().map(d =>
    '<option value="' + esc(d) + '">' + esc(fmtDay(d)) + "</option>").join("");
  if (keep && seen[keep]) sel.value = keep;
  syncDayNav();
}

function statusPill(c) {
  const t = todayStr();
  let cls = "neu", label = "neu";
  if (c.state === "learning") { cls = "lernen"; label = "lernen"; }
  else if (c.state === "review") {
    if ((c.due || t) <= t) { cls = "faellig"; label = "fällig"; }
    else { cls = "wdh"; label = "Wdh."; }
  }
  return '<span class="pill ' + cls + '">' + label + "</span>";
}

let dayFlipped = false;
function renderDay() {
  const list = dayOrder[$("day-select").value] || [];
  $("day-count").textContent = list.length + (list.length === 1 ? " Wort" : " Wörter");
  const grid = $("day-grid");
  grid.innerHTML = "";
  dayFlipped = false;
  $("flip-all").textContent = "Alle umdrehen";

  list.forEach(c => {
    const card = document.createElement("article");
    card.className = "dcard";
    setGender(card, c);

    const flip = document.createElement("button");
    flip.className = "flip";
    flip.setAttribute("aria-expanded", "false");
    flip.setAttribute("aria-label", "Karte umdrehen: " + c.w);

    const f = document.createElement("div");
    f.className = "dface";
    f.innerHTML = headHtml(c) + '<div class="forms">' + esc(c.forms || "") + "</div>" +
      '<div class="hint">umdrehen</div>';
    const b = document.createElement("div");
    b.className = "dface";
    b.hidden = true;
    b.innerHTML = detailHtml(c, { forms: false });

    flip.append(f, b);
    flip.addEventListener("click", () => setFace(flip, !f.hidden));

    const foot = document.createElement("div");
    foot.className = "dfoot";
    foot.innerHTML = '<span class="pos">' + esc(c.pos || "") + '</span><span class="gap"></span>' + statusPill(c);
    foot.append(sayButton(c.w, () => (f.hidden ? exampleText(c) || c.w : c.w)));

    card.append(flip, foot);
    grid.append(card);
  });
}

function setFace(flip, showBack) {
  flip.children[0].hidden = showBack;
  flip.children[1].hidden = !showBack;
  flip.setAttribute("aria-expanded", showBack ? "true" : "false");
}

function stepDay(delta) {
  const sel = $("day-select");
  const i = sel.selectedIndex + delta;
  if (i < 0 || i >= sel.options.length) return;
  sel.selectedIndex = i;
  renderDay();
  syncDayNav();
}
function syncDayNav() {
  const sel = $("day-select");
  $("day-prev").disabled = sel.selectedIndex >= sel.options.length - 1;
  $("day-next").disabled = sel.selectedIndex <= 0;
}

/* ---------- browse ---------- */
function renderBrowse() {
  const q = $("search").value.trim().toLowerCase();
  const list = cards
    .filter(c => !q || (c.w + " " + (c.m || "")).toLowerCase().includes(q))
    .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || a.w.localeCompare(b.w));
  $("browse-count").textContent = list.length + " von " + cards.length;
  $("rows").innerHTML = list.map(c => {
    const g = GENDER[c.g] ? '<span style="color:' + GENDER[c.g] + '">' + esc(c.g) + "</span> " : "";
    const id = esc(c.id);
    const dir = isReversed(c)
      ? '<button class="dirbtn en" data-id="' + id + '">EN → DE</button>'
      : '<button class="dirbtn" data-id="' + id + '">DE → EN</button>';
    const enrich = c.ex ? "" : '<button class="enrich" data-id="' + id + '" title="Mit Claude anreichern: Fälle farbig, Zeitformen, Präpositionen">✨</button> ';
    return "<tr><td class='w'>" + g + esc(c.w) + "</td><td>" + esc(c.m || "") +
      "</td><td class='num'>" + esc(c.added || "–") + "</td><td>" + statusPill(c) +
      "</td><td>" + dir + "</td><td class='num'>" +
      (c.state === "new" ? "–" : esc(c.due || "–")) + "</td><td class='num'>" +
      (c.ivl ? fmtIvl(c.ivl) : "–") + "</td><td class='num'>" + (c.reps || 0) + "</td><td>" +
      enrich + '<button class="del" data-id="' + id + '" title="Karte löschen">✕</button></td></tr>';
  }).join("") || "<tr><td colspan='9' style='color:var(--ink-3)'>Keine Karten gefunden.</td></tr>";
}

function toggleDir(id) {
  const c = cards.find(x => x.id === id);
  if (!c) return;
  c.dir = isReversed(c) ? "de" : "en";
  persist(); stats(); renderBrowse();
  if (queue[pos] === c) render();
}

async function enrichExisting(id, btn) {
  const c = cards.find(x => x.id === id);
  if (!c) return;
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>';
  try {
    const r = await lookUp(c.w, c.m);
    if (!r) { showTab("add"); return; }
    mergeContent(c, r);
    persist();
    if (queue[pos] === c) render();
  } catch (err) {
    console.error(err);
    alert("Anreichern fehlgeschlagen: " + (err && err.message ? err.message : err));
  }
  renderBrowse();
}

function deleteCard(id) {
  const c = cards.find(x => x.id === id);
  if (!c || !confirm("„" + c.w + "“ wirklich löschen?")) return;
  cards = cards.filter(x => x !== c);
  const qi = queue.indexOf(c);
  if (qi >= 0) { queue = queue.filter(x => x !== c); if (qi < pos) pos -= 1; }
  last = null;
  persist(); stats(); buildDays(); renderBrowse(); render();
}

/* ---------- settings ---------- */
function syncKeyField() {
  const k = lsGet(API_KEY);
  $("api-key").value = "";
  $("api-key").placeholder = k ? "gespeichert: …" + k.slice(-4) : "sk-ant-…";
}

function exportCards() {
  const blob = new Blob([JSON.stringify(cards, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "vokabeltrainer-" + todayStr() + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importCards(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data)) throw new Error("Keine Kartenliste.");
    let n = 0;
    data.forEach(d => {
      if (!d || !d.w) return;
      d.id = d.id || slug(d.w);
      const i = cards.findIndex(x => x.id === d.id);
      if (i >= 0) cards[i] = d; else cards.push(d);
      n += 1;
    });
    persist(); refreshAll();
    setStatus("data-status", n + " Karten importiert.");
  } catch (err) {
    setStatus("data-status", "Import fehlgeschlagen: " + esc(err.message), true);
  }
}

async function loadSeed() {
  const res = await fetch("cards.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("cards.json nicht gefunden");
  return res.json();
}

/* ---------- wiring ---------- */
function showTab(which) {
  ["review", "add", "days", "browse", "settings"].forEach(k => {
    $("tab-" + k).setAttribute("aria-selected", k === which ? "true" : "false");
    $("view-" + k).hidden = k !== which;
  });
  if (which === "browse") renderBrowse();
  if (which === "days") { renderDay(); syncDayNav(); }
  if (which === "add") $("add-word").focus();
  if (which === "settings") syncKeyField();
}

function refreshAll() {
  stats(); buildDays(); buildQueue(); render();
  if (!$("view-browse").hidden) renderBrowse();
  if (!$("view-days").hidden) renderDay();
}

$("reveal").addEventListener("click", reveal);
$("grades").addEventListener("click", (e) => {
  const b = e.target.closest(".grade");
  if (b) grade(Number(b.dataset.g));
});
$("undo").addEventListener("click", undo);
$("shuffle-queue").addEventListener("click", shuffleQueue);
$("add-form").addEventListener("submit", onAdd);
$("search").addEventListener("input", renderBrowse);
$("rows").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.classList.contains("dirbtn")) toggleDir(b.dataset.id);
  else if (b.classList.contains("enrich")) enrichExisting(b.dataset.id, b);
  else if (b.classList.contains("del")) deleteCard(b.dataset.id);
});
$("day-select").addEventListener("change", () => { renderDay(); syncDayNav(); });
$("day-prev").addEventListener("click", () => stepDay(1));
$("day-next").addEventListener("click", () => stepDay(-1));
$("shuffle-day").addEventListener("click", () => {
  const d = $("day-select").value;
  if (dayOrder[d]) { shuffle(dayOrder[d]); renderDay(); }
});
$("flip-all").addEventListener("click", (e) => {
  dayFlipped = !dayFlipped;
  document.querySelectorAll("#day-grid .flip").forEach(f => setFace(f, dayFlipped));
  e.currentTarget.textContent = dayFlipped ? "Alle zurückdrehen" : "Alle umdrehen";
});
["review", "add", "days", "browse", "settings"].forEach(k =>
  $("tab-" + k).addEventListener("click", () => showTab(k)));

$("key-save").addEventListener("click", () => {
  const v = $("api-key").value.trim();
  if (!v) { setStatus("key-status", "Bitte einen Schlüssel eingeben.", true); return; }
  setStatus("key-status", lsSet(API_KEY, v) ? "Gespeichert." : "Konnte nicht speichern (privates Fenster?).", !lsGet(API_KEY));
  syncKeyField();
});
$("key-clear").addEventListener("click", () => {
  lsDel(API_KEY); syncKeyField(); setStatus("key-status", "Schlüssel entfernt.");
});
$("export").addEventListener("click", exportCards);
$("import").addEventListener("change", (e) => {
  if (e.target.files[0]) importCards(e.target.files[0]);
  e.target.value = "";
});
$("reset").addEventListener("click", async () => {
  if (!confirm("Alle Karten und den Lernstand durch den Startsatz ersetzen?")) return;
  try {
    cards = await loadSeed();
    persist(); refreshAll();
    setStatus("data-status", "Zurückgesetzt: " + cards.length + " Karten.");
  } catch (err) {
    setStatus("data-status", "Fehler: " + esc(err.message), true);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea, select")) return;
  if ($("view-review").hidden) return;
  if (e.key === " " || e.key === "Enter") {
    if (!revealed && pos < queue.length) { e.preventDefault(); reveal(); }
  } else if (["1", "2", "3", "4"].includes(e.key)) {
    if (revealed) { e.preventDefault(); grade(Number(e.key)); }
  } else if (e.key.toLowerCase() === "u") {
    undo();
  } else if (e.key.toLowerCase() === "m") {
    shuffleQueue();
  }
});

/* ---------- boot ---------- */
(async function boot() {
  const saved = lsGet(STORE_KEY);
  if (saved) {
    try { cards = JSON.parse(saved); } catch (e) { cards = []; }
  } else {
    try { cards = await loadSeed(); persist(); }
    catch (e) { console.warn(e); cards = []; }
  }
  refreshAll();
})();
