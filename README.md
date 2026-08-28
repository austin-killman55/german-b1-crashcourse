# German B1 crash course

Two self-contained study sheets. No build step, no dependencies — plain HTML that
works offline once loaded, on a phone as well as a laptop.

| Page | What it covers |
| --- | --- |
| [`index.html`](index.html) | German grammar A1 → B1.2: the four cases, adjective endings, prepositions, word order, relative clauses, Passiv, Konjunktiv II, n-Deklination, plus a cheat sheet and a page of Eselsbrücken |
| [`kapitel-3.html`](kapitel-3.html) | *Begegnungen B1+* Kapitel 3 · **Medien** — the five grammar points of the chapter explained in English, the full D2 verb list with English meanings, the chapter vocabulary, and 96 graded practice questions |

## Kapitel 3 at a glance

**Grammar**, in English, with worked examples:

1. Sinngerichtete Infinitivkonstruktionen — `um … zu`, `ohne … zu`, `(an)statt … zu`, `damit`
2. Passiv — Präsens, Präteritum, Perfekt
3. Passiv mit Modalverben, plus Vorgangs- vs Zustandspassiv
4. Passiversatzformen — `man`, `sich lassen`, `sein + zu`, `-bar`
5. Konjunktiv II Gegenwart
6. Konjunktiv II Vergangenheit — `hätte / wäre + Partizip II`
7. Reflexive Verben — Akkusativ vs Dativ, reciprocals, fixed prepositions

**D2 · Kleines Wörterbuch der Verben** — all 22 verbs (18 irregular, 4 regular) in
the book's four columns, with the English the book leaves out, vowel-pattern
families, and an interactive trainer that drills in five modes and re-queues
whatever you keep missing.

**Wortschatz** — Lesen und Buchdruck, Medien und Zubehör, Fernsehen, Grafiken
beschreiben, plus the Redemittel for talking about a century and for framing
hypotheses in the past.

## Using the sheets

- **Übungsmodus** — the toggle at the top of either page hides all the explanation
  and leaves only the exercises, so the same page doubles as a test.
- **Verb trainer** — Deutsch → English, English → Deutsch, Präsens, Präteritum,
  Perfekt, or all mixed. Umlauts can be typed as `ae / oe / ue / ss`.
- **D3 checklist** — the chapter's own "Ich kann …" self-assessment; ticks are
  remembered in the browser.

## Tests

```sh
node test-answers.js   # the answer grader on both pages, and every shipped answer
node test-verbs.js     # the verb trainer, driven through a DOM shim
```

`test-answers.js` checks that every `data-a` answer on both pages grades itself as
correct, so a typo in an answer key fails the build rather than confusing a
learner. `test-verbs.js` runs the real trainer script over all 22 verbs in all
five modes, in every spelling the matcher promises to accept.
