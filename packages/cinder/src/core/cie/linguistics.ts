// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
/**
 * A small, purpose-built, zero-dependency grammar module for distinguishing a real command
 * ("search", "please search now") from a sentence that merely mentions a word
 * ("I don't want to search", "the search already finished", "why would I search").
 *
 * Why this exists: matchActionPlanner (planners/action.ts) is the one planner that fuzzy-
 * matches a node key against the WHOLE input string rather than anchoring on a leading verb
 * (navigate/output/set-value all require their verb to be the first word, which already makes
 * them immune to this - "don't open settings" doesn't start with "open", so their regex never
 * matches at all). Actions have no single fixed leading verb to anchor on ("search", "save",
 * "click save", "run the search" are all valid), so the planner fell back to an unanchored
 * substring check - which also matches sentences that mention the action's name without
 * commanding it.
 *
 * This is NOT a real NLP parser. It does not know parts of speech. What it does is cheap,
 * systematic, and honestly scoped:
 *   1. Negation detection, derived from the actual tokenization pattern (normalizeInput
 *      splits "don't" into ["don","t"] - see core/cie/normalizer.ts - so detecting "a token
 *      ending in 'n' immediately followed by a bare 't'" catches EVERY English n't
 *      contraction systematically, not a hand-typed list of "don't/won't/isn't/...").
 *   2. Sentence-mood classification by leading-token category (subject pronoun, question
 *      word/auxiliary, article) - the same structural signal that already makes the other
 *      three planners immune, generalized to the cases where there's no fixed verb to anchor on.
 *
 * Known, documented limitation (not silently papered over): a sentence where the action's own
 * key is used as a NOUN and happens to lead the sentence - e.g. "search results are shown
 * below", where "search" is the first word but modifies "results" rather than being the verb -
 * is NOT distinguishable from a real command by word position alone. That needs real part-of-
 * speech tagging to solve properly, which is out of scope for a zero-dependency module (see
 * the plan's three-tier/local-engine docs for the explicit library-vs-build-it-ourselves
 * tradeoff this was scoped against). It's covered as a known-failing case in the adversarial
 * tests, not hidden.
 */

const SUBJECT_PRONOUNS = new Set(["i", "you", "he", "she", "it", "we", "they"]);
const QUESTION_WORDS = new Set(["why", "what", "when", "where", "how", "which", "who"]);
// "do/does/did" genuinely doubles as an imperative verb ("do the search" = perform the
// search), so it only reads as a question when followed by a subject pronoun ("do you want
// to search"), not an article ("do the search" stays imperative-eligible).
const DO_FAMILY_AUXILIARIES = new Set(["do", "does", "did"]);
// These essentially never start a one-sentence imperative command on their own - "is the
// search done", "would the search help", "could the file be saved" are questions whether
// followed by a pronoun OR an article/noun-starter.
const STATE_AUXILIARIES = new Set(["would", "could", "should", "can", "will", "is", "are", "was", "were"]);
const ARTICLES = new Set(["the", "a", "an"]);
const LEADING_FILLERS = new Set(["please", "just", "kindly"]);
const BARE_NEGATION_WORDS = new Set(["not", "never", "no"]);

export type SentenceMood = "imperative" | "declarative" | "interrogative";

/**
 * True when tokens[index] and tokens[index + 1] together form a negative contraction
 * ("don't" -> ["don","t"], "doesn't" -> ["doesn","t"], "isn't" -> ["isn","t"], etc.) - any
 * token ending in "n" directly followed by a bare "t", which is exactly and only how
 * normalizeInput's punctuation stripping renders every English n't contraction.
 */
function isNegativeContractionAt(tokens: string[], index: number): boolean {
  const token = tokens[index];
  const next = tokens[index + 1];
  return Boolean(token && token.length > 1 && token.endsWith("n") && next === "t");
}

/**
 * Scans the tokens before `beforeIndex` for a negation marker - a bare negation word, or a
 * split n't contraction. Scoped to "anywhere earlier in the sentence" rather than a fixed
 * window: once a negation appears before the matched verb in a short command-length
 * sentence, that's a strong enough signal to refuse the match outright, and a false match
 * executed is worse than a false "not resolved" here.
 */
export function hasNegationBefore(tokens: string[], beforeIndex: number): boolean {
  for (let index = 0; index < beforeIndex; index += 1) {
    if (BARE_NEGATION_WORDS.has(tokens[index]!)) {
      return true;
    }

    if (isNegativeContractionAt(tokens, index)) {
      return true;
    }
  }

  return false;
}

/**
 * Classifies the sentence's mood from its leading tokens after stripping pure politeness
 * filler ("please", "just", "kindly") - command, description, or question. Returns
 * "imperative" whenever the leading token doesn't match a known non-command category; that's
 * a deliberate default-allow, since the goal is to reject the categories we can reliably
 * detect, not to require positive proof of a command (that would need real parsing).
 */
export function classifySentenceMood(tokens: string[]): SentenceMood {
  let start = 0;

  while (start < tokens.length && LEADING_FILLERS.has(tokens[start]!)) {
    start += 1;
  }

  const first = tokens[start];

  if (!first) {
    return "declarative";
  }

  if (QUESTION_WORDS.has(first)) {
    return "interrogative";
  }

  if (SUBJECT_PRONOUNS.has(first)) {
    return "declarative";
  }

  if (ARTICLES.has(first)) {
    // "the search already finished" / "a search was run" - describing something, not
    // commanding it. (This also means a command that genuinely starts with an article, e.g.
    // "the search button, please" would be misclassified - that phrasing is rare enough in
    // practice to accept the tradeoff; it's not silently assumed away, it's this comment.)
    return "declarative";
  }

  const next = tokens[start + 1] ?? "";

  if (DO_FAMILY_AUXILIARIES.has(first) && SUBJECT_PRONOUNS.has(next)) {
    // "do you want to search" - a real question. "do the search" (next = article, not a
    // pronoun) is left as imperative-eligible, since "do" there is the imperative verb
    // "do" (perform), not a question auxiliary.
    return "interrogative";
  }

  if (STATE_AUXILIARIES.has(first) && (SUBJECT_PRONOUNS.has(next) || ARTICLES.has(next))) {
    // "would you search" / "is the search done" - both real questions; these auxiliaries
    // don't double as imperative verbs the way "do" does, so an article following is still
    // a question ("is the search..."), not a command.
    return "interrogative";
  }

  return "imperative";
}

/**
 * The combined check matchActionPlanner uses: is this input, structurally, something that
 * should be allowed to trigger an action match at all? Returns false for detected negation or
 * a non-imperative mood; true otherwise (including the known-unsolved noun-leading case -
 * see the module doc comment).
 */
export function isPlausibleCommand(tokens: string[], matchedKeywordIndex: number): boolean {
  if (hasNegationBefore(tokens, matchedKeywordIndex)) {
    return false;
  }

  return classifySentenceMood(tokens) === "imperative";
}
