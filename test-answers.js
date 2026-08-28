// Pulls the real <script> out of index.html and exercises the click path
// through a minimal DOM shim. Fails loudly if grading logic breaks.
const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync(require('path').join(__dirname, 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
assert(m, 'no <script> block found in index.html');

const handlers = {};
global.document = { addEventListener: (type, fn) => { handlers[type] = fn; } };
eval(m[1]);
assert(handlers.click, 'click handler never registered');

function grade(answerAttr, typed) {
  const input = { value: typed };
  const fb = { textContent: '' };
  const classes = new Set();
  const q = {
    dataset: { a: answerAttr },
    querySelector: sel => (sel.indexOf('input') !== -1 ? input : fb),
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
  };
  const btn = { closest: sel => (sel === '.q' ? q : btn) };
  handlers.click({ target: { closest: sel => (sel === '.chk' ? btn : null) } });
  return { ok: classes.has('ok'), no: classes.has('no'), fb: fb.textContent };
}

const cases = [
  ['exact match',            'dem Kind',            'dem Kind',      true],
  ['case-insensitive',       'Studenten',           'studenten',     true],
  ['trailing period',        'dem Kind',            'dem Kind.',     true],
  ['messy whitespace',       'dem Kind',            '  dem   Kind ', true],
  ['umlaut passthrough',     'hätte',               'hätte',         true],
  ['sharp s',                'des Manns',           'des manns',     true],
  ['alternative accepted',   'des Mannes|des Manns','des Manns',     true],
  ['first form accepted',    'des Mannes|des Manns','des Mannes',    true],
  ['wrong answer rejected',  'dem Kind',            'das Kind',      false],
  ['empty rejected',         'dem Kind',            '',              false],
  ['near-miss rejected',     'den',                 'dem',           false],
  ['ending drill',           'en',                  'EN',            true],
];

let failed = 0;
for (const [name, attr, typed, want] of cases) {
  const r = grade(attr, typed);
  const pass = r.ok === want && r.no === !want;
  if (!pass) { failed++; console.log(`FAIL  ${name}: got ok=${r.ok} no=${r.no}, want ok=${want}`); }
  else console.log(`ok    ${name}`);
}

// wrong answers must surface the canonical form, not the alternative
const wrong = grade('des Mannes|des Manns', 'der Mann');
assert(wrong.fb.includes('des Mannes'), `feedback should show canonical answer, got: ${wrong.fb}`);
console.log('ok    wrong answer reveals canonical form');

// every real answer in the file must grade itself as correct
const answers = [...html.matchAll(/<div class="q" data-a="([^"]*)"/g)].map(x => x[1]);
for (const a of answers) {
  for (const alt of a.split('|')) {
    const r = grade(a, alt);
    if (!r.ok) { failed++; console.log(`FAIL  self-grade: "${alt}" from "${a}"`); }
  }
}
console.log(`ok    all ${answers.length} shipped answers self-grade correct`);

if (failed) { console.log(`\n${failed} FAILURES`); process.exit(1); }
console.log('\nall green');
