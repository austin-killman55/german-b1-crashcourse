# Vokabeltrainer

A German B1 vocabulary trainer that uses spaced repetition, in the style of Anki. It runs as a static site with no build step and no server. Cards and your progress are saved in your browser.

## Features

- **Üben**: SM-2-style review with four grades (Nochmal / Schwer / Gut / Leicht). After you grade a card **Leicht**, it switches to English → German. Keyboard shortcuts: Space, 1–4, U, M.
- **+ Wort**: type any word, then press **Nachschlagen**. Claude fills in the card:
  - article (the card is colour-coded by gender: der / die / das), pronunciation respelling and forms
  - an example sentence where each noun phrase and pronoun is **coloured by case**: Nominativ, Akkusativ, Dativ, Genitiv
  - for **verbs**: Präsens, Präteritum and Perfekt (with haben/sein), the case of the object (**+ Akk / + Dat / + Akk + Dat**), and whether it is reflexive or separable
  - **fixed prepositions** with their case, for verbs, adjectives and nouns (e.g. *warten auf + Akk*), each with an example
  - a short learner tip

  You see a preview before the card is added. If the word is already in your deck, saving replaces its content and keeps your progress.
- **Tageswortschatz**: flip cards grouped by the day they were added.
- **Alle Karten**: search the deck, switch the review direction, delete cards, or press ✨ to have Claude add case colours and grammar to older cards.
- **Einstellungen**: set your API key and export, import or reset your deck.

`cards.json` is the starter deck: 300 B1 words, with their progress as of the export date.

## Setup

1. Get an Anthropic API key from <https://console.anthropic.com/>.
2. Open the site, go to **Einstellungen** and paste the key. The key is stored only in your browser's `localStorage` and is sent only to `api.anthropic.com`.

Each lookup is one request to `claude-opus-5-5` at low effort, using structured JSON output.

## Run locally

The page loads `cards.json` with `fetch`, so you need to serve it over HTTP. Opening the file directly won't work:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy with GitHub Pages

Push these files to the root of a repository. Then go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, and select `main` / `(root)`.

## Files

| File | Purpose |
|---|---|
| `index.html` | Markup and tabs |
| `style.css` | Theme (light/dark), gender and case colours |
| `app.js` | Scheduling, rendering, storage, import/export |
| `enrich.js` | Claude lookup: prompt and JSON schema |
| `cards.json` | Starter deck |
