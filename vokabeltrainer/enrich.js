// Looks up a German word with Claude and returns a structured card.
// The SDK is loaded lazily so the trainer still works offline for reviewing.

const MODEL = "claude-opus-5-5";
const CASE = ["nom", "akk", "dat", "gen", "none"];

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["lemma", "article", "pos", "meaning", "pronunciation", "forms",
             "example", "example_en", "verb", "prepositions", "note"],
  properties: {
    lemma: { type: "string" },
    article: { type: "string", enum: ["der", "die", "das", "none"] },
    pos: { type: "string", enum: ["Nomen", "Verb", "Adjektiv", "Adverb", "Präposition",
                                  "Konjunktion", "Ausdruck", "Andere"] },
    meaning: { type: "string" },
    pronunciation: { type: "string" },
    forms: { type: "string" },
    example: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "case", "target"],
        properties: {
          text: { type: "string" },
          case: { type: "string", enum: CASE },
          target: { type: "boolean" }
        }
      }
    },
    example_en: { type: "string" },
    verb: {
      type: "object",
      additionalProperties: false,
      required: ["present", "praeteritum", "perfekt", "object_case", "reflexive", "separable"],
      properties: {
        present: { type: "string" },
        praeteritum: { type: "string" },
        perfekt: { type: "string" },
        object_case: { type: "string", enum: ["Akk", "Dat", "Akk + Dat", "Gen", "keins"] },
        reflexive: { type: "string", enum: ["nein", "sich (Akk)", "sich (Dat)"] },
        separable: { type: "boolean" }
      }
    },
    prepositions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["preposition", "case", "meaning", "example"],
        properties: {
          preposition: { type: "string" },
          case: { type: "string", enum: ["Akk", "Dat", "Gen", "Akk/Dat"] },
          meaning: { type: "string" },
          example: { type: "string" }
        }
      }
    },
    note: { type: "string" }
  }
};

const SYSTEM = `You write flashcards for an English-speaking learner of German at level B1.
Given one German word (it may be misspelled, inflected, or English; work out the German dictionary form), fill every field:

- lemma: dictionary form. Nouns capitalised without article. Reflexive verbs start with "sich" (e.g. "sich freuen").
- article: der/die/das for nouns, otherwise "none".
- meaning: concise English meaning(s), separated by "; " when there are several common senses.
- pronunciation: English-style respelling. Stressed syllable in CAPS, syllables joined by "-". Use kh for the ch hiss, ew for ü, ur for ö, ts for z, v for w, f for v, z for s before vowels, ow for au, oy for eu/äu, ine for ein. Example: "FROY-en".
- forms: one short line. Nouns: "die Absage, -n" (article, word, plural ending; add genitive for masculine/neuter, e.g. "der Vertrag, -(e)s, -¨e"). Verbs: "freut sich · freute sich · hat sich gefreut". Adjectives: comparative and superlative if they exist, else "".
- example: one natural B1-level sentence (8-16 words) that uses the word, and its typical preposition if it has one. Return it split into consecutive segments whose texts concatenate exactly to the sentence, including spaces and punctuation. Give every noun phrase or pronoun its own segment (article + adjectives + noun together) tagged with its grammatical case: nom, akk, dat or gen. Everything else (verbs, adverbs, conjunctions, prepositions, punctuation) is "none". Set target=true only on the segment(s) containing the looked-up word itself (for separable verbs mark both parts).
- example_en: English translation of the example.
- verb: when pos is "Verb", give the er/sie/es form in Präsens ("freut sich"), Präteritum ("freute sich") and Perfekt with auxiliary ("hat sich gefreut"); object_case is the case of the verb's object(s) without a preposition ("keins" if it takes none); reflexive and separable as applicable. For any other part of speech fill the strings with "" and use "keins", "nein", false.
- prepositions: the fixed prepositions that the word commonly requires (verbs, adjectives and nouns alike: "warten auf + Akk", "stolz auf + Akk", "die Angst vor + Dat"), each with its case, the English meaning of the combination and a short German example. Empty array if none.
- note: one short German or English tip for B1 learners (common mistake, related word, opposite). "" if nothing useful.`;

let sdk = null;
async function loadSdk() {
  if (!sdk) sdk = (await import("https://esm.sh/@anthropic-ai/sdk@0.131.0")).default;
  return sdk;
}

export async function enrichWord(word, hint, apiKey) {
  const Anthropic = await loadSdk();
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const text = "Wort: " + word + (hint ? "\nHinweis zur gemeinten Bedeutung: " + hint : "");

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: text }]
  });

  if (response.stop_reason === "refusal") throw new Error("Claude hat die Anfrage abgelehnt.");
  if (response.stop_reason === "max_tokens") throw new Error("Antwort war zu lang – bitte erneut versuchen.");
  const block = response.content.find(b => b.type === "text");
  if (!block) throw new Error("Leere Antwort von Claude.");
  return JSON.parse(block.text);
}
