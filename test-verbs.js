// Drives the real verb-trainer script from kapitel-3.html through a minimal DOM
// shim: every verb must be accepted in every mode, in the forms a learner would
// plausibly type. Fails loudly if the verb table or the matcher drifts.
const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync(require('path').join(__dirname, 'kapitel-3.html'), 'utf8');
const m = html.match(/<script id="verb-trainer">([\s\S]*?)<\/script>/);
assert(m, 'no verb-trainer script found in kapitel-3.html');

function el(extra) {
  return Object.assign({
    textContent: '', innerHTML: '', className: '', value: '', dataset: {},
    _h: {},
    addEventListener(type, fn) { this._h[type] = fn; },
    fire(type, ev) { if (this._h[type]) this._h[type](ev || { preventDefault() {} }); },
    setAttribute() {}, focus() {}, querySelectorAll() { return []; },
  }, extra);
}

const modeButtons = ['en', 'de', 'prat', 'perf', 'pras', 'mix']
  .map(mm => el({ dataset: { m: mm } }));

const nodes = {
  vt: el({ querySelectorAll: sel => (sel === '.modes button' ? modeButtons : []) }),
  vtPrompt: el(), vtHint: el(), vtInput: el(), vtVerdict: el(),
  vtOk: el(), vtNo: el(), vtCheck: el(), vtSkip: el(),
};
global.document = { getElementById: id => nodes[id] || null };
eval(m[1]);

// pull the shipped verb table straight out of the script source, so the test
// asserts against what actually ships rather than a second copy
const VERBS = eval(m[1].match(/var VERBS = (\[[\s\S]*?\]);/)[1]);
assert.strictEqual(VERBS.length, 22, `expected 22 D2 verbs, found ${VERBS.length}`);

const byInf = Object.fromEntries(VERBS.map(v => [v.inf, v]));
const byEn = Object.fromEntries(VERBS.map(v => [v.en[0], v]));

function answer(text) {
  nodes.vtInput.value = text;
  nodes.vtCheck.fire('click');
  const right = nodes.vtVerdict.className.indexOf('ok') !== -1;
  nodes.vtCheck.fire('click'); // advance to the next card
  return right;
}
function selectMode(name) {
  modeButtons.find(b => b.dataset.m === name).fire('click');
}

// what a learner might reasonably type for each mode
const variants = {
  en:   v => [v.en[0], v.en[0].replace(/^to /, ''), v.en[v.en.length - 1]],
  de:   v => [v.inf, v.inf.replace(/^sich /, '')],
  pras: v => forms(v.pras),
  prat: v => forms(v.prat),
  perf: v => forms(v.perf),
};
function forms(s) {
  const bare = s.replace(/^(er|es|sie|man) /, '');
  const out = [s, bare, bare.replace(/ sich\b/, '')];
  if (/[äöüß]/.test(s)) {
    out.push(s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss'));
  }
  out.push(s.toUpperCase());
  return [...new Set(out)];
}

let failed = 0;

// Each answered card advances the deck, so we cannot probe one card twice.
// Instead: run the deck once per variant index, typing that variant on every card.
for (const mode of ['en', 'de', 'pras', 'prat', 'perf']) {
  const widest = Math.max(...VERBS.map(v => variants[mode](v).length));
  for (let pass = 0; pass < widest; pass++) {
    selectMode(mode);                       // reshuffles and deals a fresh full deck
    const seen = new Set();
    for (let i = 0; i < VERBS.length; i++) {
      const shown = nodes.vtPrompt.textContent;
      const v = mode === 'de' ? byEn[shown] : byInf[shown];
      assert(v, `[${mode}] prompt "${shown}" matches no verb`);
      seen.add(v.inf);
      const opts = variants[mode](v);
      const typed = opts[pass % opts.length];
      if (!answer(typed)) {
        failed++;
        console.log(`FAIL  [${mode}] "${typed}" rejected for ${v.inf}`);
      }
    }
    assert.strictEqual(seen.size, VERBS.length,
      `[${mode}] pass ${pass} dealt ${seen.size}/${VERBS.length} verbs`);
  }
  console.log(`ok    [${mode}] every verb accepted in ${widest} spellings, deck deals all ${VERBS.length}`);
}

// a wrong answer must be rejected and must reveal the full principal parts
selectMode('perf');
nodes.vtInput.value = 'er hat gemacht';
nodes.vtCheck.fire('click');
assert(nodes.vtVerdict.className.indexOf('no') !== -1, 'wrong answer should be marked wrong');
assert(/·/.test(nodes.vtVerdict.innerHTML), 'wrong answer should reveal the principal parts');
console.log('ok    wrong answer rejected and reveals principal parts');

// the four sein-verbs must carry ist, everything else hat
const seinVerbs = VERBS.filter(v => / ist /.test(v.perf)).map(v => v.inf).sort();
assert.deepStrictEqual(seinVerbs, ['entstehen', 'laufen', 'sinken', 'steigen'].sort(),
  `wrong sein-verbs: ${seinVerbs.join(', ')}`);
console.log('ok    exactly entstehen/laufen/sinken/steigen take sein');

// every verb carries all four principal parts and at least one gloss
for (const v of VERBS) {
  for (const k of ['inf', 'pras', 'prat', 'perf']) {
    assert(v[k] && v[k].trim(), `${v.inf}: missing ${k}`);
  }
  assert(v.en.length && v.en.every(e => e.trim()), `${v.inf}: missing English gloss`);
}
console.log(`ok    all ${VERBS.length} entries complete`);

if (failed) { console.log(`\n${failed} FAILURES`); process.exit(1); }
console.log('\nall green');
