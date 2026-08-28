// Pulls the real <script> out of index.html and exercises the click path
// through a minimal DOM shim. Fails loudly if grading logic breaks.
const fs = require('fs');
const assert = require('assert');

// Every page that ships the grader gets the same treatment.
const PAGES = ['index.html', 'kapitel-3.html'];

let handlers = {};

function loadGrader(page) {
  const html = fs.readFileSync(require('path').join(__dirname, page), 'utf8');
  // the grader is the bare <script> block; the trainer/storage blocks carry an id
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  assert(m, `no bare <script> block found in ${page}`);
  handlers = {};
  global.document = { addEventListener: (type, fn) => { handlers[type] = fn; } };
  eval(m[1]);
  assert(handlers.click, `click handler never registered in ${page}`);
  return html;
}

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

// kapitel-3.html folds ä/ö/ü/ß so a phone keyboard can answer; a missing
// umlaut is still wrong, because that is the thing being learned.
const foldCases = [
  ['ae for ä accepted',      'er wäscht',           'er waescht',    true],
  ['ue for ü accepted',      'Worüber',             'worueber',      true],
  ['ss for ß accepted',      'er gießt',            'er giesst',     true],
  ['bare vowel rejected',    'er wäscht',           'er wascht',     false],
];

let failed = 0;

function runCases(list, page) {
  for (const [name, attr, typed, want] of list) {
    const r = grade(attr, typed);
    const pass = r.ok === want && r.no === !want;
    if (!pass) { failed++; console.log(`FAIL  [${page}] ${name}: got ok=${r.ok} no=${r.no}, want ok=${want}`); }
    else console.log(`ok    [${page}] ${name}`);
  }
}

for (const page of PAGES) {
  const html = loadGrader(page);
  console.log(`\n--- ${page} ---`);
  runCases(cases, page);
  if (page === 'kapitel-3.html') runCases(foldCases, page);

  // wrong answers must surface the canonical form, not the alternative
  const wrong = grade('des Mannes|des Manns', 'der Mann');
  assert(wrong.fb.includes('des Mannes'), `[${page}] feedback should show canonical answer, got: ${wrong.fb}`);
  console.log(`ok    [${page}] wrong answer reveals canonical form`);

  // every real answer in the file must grade itself as correct
  const answers = [...html.matchAll(/<div class="q" data-a="([^"]*)"/g)].map(x => x[1]);
  assert(answers.length > 0, `[${page}] no graded questions found`);
  for (const a of answers) {
    for (const alt of a.split('|')) {
      const r = grade(a, alt);
      if (!r.ok) { failed++; console.log(`FAIL  [${page}] self-grade: "${alt}" from "${a}"`); }
    }
  }
  console.log(`ok    [${page}] all ${answers.length} shipped answers self-grade correct`);

  // an answer that is only whitespace or an empty data-a would silently accept ""
  for (const a of answers) {
    assert(a.trim().length > 0, `[${page}] empty data-a on a question`);
  }
  console.log(`ok    [${page}] no empty answer keys`);
}

if (failed) { console.log(`\n${failed} FAILURES`); process.exit(1); }
console.log('\nall green');
