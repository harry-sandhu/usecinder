// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import nlp from "compromise";
import type { CinderGraphNode, CinderGraphSnapshot } from "usecinder";

/**
 * Tier-2 value extraction for set_field/set_filter commands, the cheap/primary half of a
 * two-stage fallback (see qaValueExtraction.ts for the ML half). Core's own
 * matchSetValuePlanner/matchFilterByValuePlanner require their verb to be the sentence's
 * LITERAL FIRST WORD ("set status to overdue" works, "could you please set status to
 * overdue" does not) - deliberate in tier 1, since tier 1 has no model to lean on for
 * telling a real command from a sentence that merely mentions the verb. Found via a real
 * stress test (rupeey91repl-cinder): politeness filler before the verb is the single most
 * common thing a real user does, and it took every set-value command down to a flat 0%.
 *
 * compromise.js finds the same "verb ... to ... " shape ANYWHERE in the sentence instead of
 * anchoring to position 0 - a GENERIC grammar library, trained on nothing (there is no
 * training step), so this works for any app's vocabulary without ever having seen it, the
 * same way the embedding model already in this package generalizes to unseen domains. It
 * only has to find the SHAPE (which span is the field reference, which span is the value) -
 * matching those spans against the page's real field/filter nodes is plain text matching
 * below, not a model's job.
 */
const SET_VALUE_VERBS = ["set", "fill", "choose", "pick", "select", "change", "update"] as const;
const SET_VALUE_SHAPE = new RegExp(`(?:${SET_VALUE_VERBS.join("|")})\\s+.+\\s+to\\s+.+`, "i");
const SET_VALUE_EXTRACT = new RegExp(`^(?:${SET_VALUE_VERBS.join("|")})\\s+(.+?)\\s+to\\s+(.+)$`, "i");

/**
 * The (reduced) passive / past-participle shape: "the city changed to pune", "have the
 * status updated to active" - the field comes BEFORE the verb here, not after. compromise.js
 * does tag true passives ("has been changed") reliably, but a real stress test found most
 * real phrasing of this kind is a reduced passive it tags as plain past tense instead ("I
 * need the city changed to pune") - too inconsistent to key off compromise's own Passive tag,
 * so this matches the past-participle forms directly instead. The captured field phrase is
 * noisier here (often keeps a few leading filler words - "please have the status") than the
 * verb-first shape's, but matchFieldPhrase's substring-containment tier still finds the real
 * field name inside it.
 */
const PAST_PARTICIPLE_SHAPE = /(.+?)\s+(?:set|filled|chosen|picked|selected|changed|updated)\s+to\s+(.+)$/i;
const TRAILING_CLAUSE_FILLER = /,\s*(?:could|would|can|please|thanks|right|will)\b.*$/i;

// Not anchored to the start of the string, unlike core's matchFilterByValuePlanner - the
// whole point of this module is tolerating whatever filler precedes the real command. The
// optional "(?:\s+\w+)?" after "it"/"this" tolerates a short noun in between ("filter this
// LIST by X", "narrow this DATA down by X") - found missing via a real live-browser test
// ("could you please filter this list by rejected leads" didn't match without it).
const FILTER_BY_EXTRACT = /(?:filter(?:\s+(?:it|this)(?:\s+\w+)?)? by|filter to|show only|only show|narrow(?:\s+(?:it|this)(?:\s+\w+)?)?(?:\s+down)? by)\s+(.+)$/i;

// Not anchored, same reasoning as above - matchSearchFieldPlanner (core, tier 1) requires
// "search for"/"find"/"look up" to be the sentence's first word(s), which a filler-prefixed
// real sentence ("could you search for X please") never satisfies.
const SEARCH_EXTRACT = /(?:search for|look up|lookup|find)\s+(.+)$/i;
const SEARCH_LIKE_INDICATOR_WORDS = new Set(["search", "query"]);

const LEADING_FIELD_FILLER = /^(the|a|my|your|this|that)\s+/i;
const TRAILING_FILLER_WORDS = /\s+(over|please|now|right now)$/i;
const TRAILING_VALUE_FILLER = /[,]?\s*(for me|please|right now|now|thanks|thank you)$/i;

function stripRepeatedly(value: string, pattern: RegExp): string {
  let current = value.trim();
  let previous: string;

  do {
    previous = current;
    current = current.replace(pattern, "").trim();
  } while (current !== previous);

  return current;
}

function cleanFieldPhrase(phrase: string): string {
  return stripRepeatedly(phrase.replace(LEADING_FIELD_FILLER, ""), TRAILING_FILLER_WORDS);
}

function cleanValuePhrase(phrase: string): string {
  return stripRepeatedly(phrase.replace(TRAILING_CLAUSE_FILLER, ""), TRAILING_VALUE_FILLER);
}

export interface ExtractedSetValueShape {
  kind: "named-field";
  fieldPhrase: string;
  value: string;
}

export interface ExtractedFilterByShape {
  kind: "value-only";
  value: string;
}

export interface ExtractedSearchShape {
  kind: "search";
  value: string;
}

export type ExtractedShape = ExtractedSetValueShape | ExtractedFilterByShape | ExtractedSearchShape;

/**
 * Finds a "<verb> <field> to <value>" or "filter by <value>" shape anywhere in the input,
 * tolerating any leading filler (compromise.js's match() isn't anchored to position 0). The
 * SET_VALUE_SHAPE check runs first and takes priority on a sentence that could technically
 * match both (e.g. a value phrase that happens to contain "by") - named-field phrasing is
 * less ambiguous than the value-only shape, so it wins when both are present.
 */
export function extractShape(input: string): ExtractedShape | undefined {
  const doc = nlp(input);
  const setValueMatch = doc.match(`(${SET_VALUE_VERBS.join("|")}) .+ to .+`);

  if (setValueMatch.found) {
    const span = setValueMatch.out("text");

    if (!SET_VALUE_SHAPE.test(span)) {
      return undefined;
    }

    const extracted = span.match(SET_VALUE_EXTRACT);

    if (!extracted) {
      return undefined;
    }

    const fieldPhrase = cleanFieldPhrase(extracted[1] ?? "");
    const value = cleanValuePhrase(extracted[2] ?? "");

    if (!fieldPhrase || !value) {
      return undefined;
    }

    return { kind: "named-field", fieldPhrase, value };
  }

  const pastParticipleExtracted = input.match(PAST_PARTICIPLE_SHAPE);

  if (pastParticipleExtracted) {
    const fieldPhrase = cleanFieldPhrase(pastParticipleExtracted[1] ?? "");
    const value = cleanValuePhrase(pastParticipleExtracted[2] ?? "");

    if (fieldPhrase && value) {
      return { kind: "named-field", fieldPhrase, value };
    }
  }

  const searchMatch = doc.match("(search|find|look|lookup) .+");

  if (searchMatch.found) {
    const extracted = input.match(SEARCH_EXTRACT);
    const value = extracted?.[1] ? cleanValuePhrase(extracted[1]) : undefined;

    if (value) {
      return { kind: "search", value };
    }
  }

  const filterByMatch = doc.match("(filter|show|narrow|only) .+");

  if (filterByMatch.found) {
    const extracted = input.match(FILTER_BY_EXTRACT);
    const value = extracted?.[1] ? cleanValuePhrase(extracted[1]) : undefined;

    if (!value) {
      return undefined;
    }

    return { kind: "value-only", value };
  }

  return undefined;
}

function tokenize(value: string): string[] {
  return value.split("-").filter((token) => token.length > 0);
}

export function isSearchLikeField(node: CinderGraphNode): boolean {
  if (tokenize(node.key).some((token) => SEARCH_LIKE_INDICATOR_WORDS.has(token))) {
    return true;
  }

  return (node.aliases ?? []).some((alias) =>
    tokenize(alias.replace(/\s+/g, "-")).some((token) => SEARCH_LIKE_INDICATOR_WORDS.has(token)),
  );
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface FieldMatchResult {
  node: CinderGraphNode;
  score: number;
}

/**
 * Plain text matching, deliberately not another ML call - the compromise.js path is meant
 * to stay cheap and fast; see qaValueExtraction.ts for the ML fallback used when this whole
 * module finds no shape at all, or finds a shape but can't confidently match the field
 * phrase to a real node.
 */
export function matchFieldPhrase(
  fieldPhrase: string,
  candidates: CinderGraphNode[],
): FieldMatchResult[] {
  const normalizedPhrase = normalizeText(fieldPhrase);

  if (!normalizedPhrase) {
    return [];
  }

  const scored: FieldMatchResult[] = [];

  for (const node of candidates) {
    const terms = [node.key.replace(/-/g, " "), node.label, ...(node.aliases ?? [])]
      .filter((term): term is string => Boolean(term))
      .map(normalizeText);

    let best = 0;

    for (const term of terms) {
      if (term === normalizedPhrase) {
        best = Math.max(best, 100);
      } else if (term.includes(normalizedPhrase) || normalizedPhrase.includes(term)) {
        best = Math.max(best, 60);
      }
    }

    if (best > 0) {
      scored.push({ node, score: best });
    }
  }

  return scored.sort((left, right) => right.score - left.score);
}

// A real value phrase very commonly carries a generic trailing noun the option label itself
// never does ("fresh LEADS" vs. the option "Fresh", "rejected LOANS" vs. "Rejected") - found
// missing via a real live-browser test. Deliberately a short, specific list rather than a
// general "does value contain option" substring check: several real option sets here share a
// prefix ("Self-serve and staff" / "Self-serve only"), where loose substring containment
// would make two different options both match the same loosely-worded value - an ambiguity
// this module should decline, not guess through.
const GENERIC_TRAILING_NOUNS = /\s+(leads?|loans?|accounts?|customers?|records?|items?|entries|results?|ones?)$/i;

export function findOfferedOption(node: CinderGraphNode, value: string): string | undefined {
  const options = (node.metadata as { options?: unknown })?.options;

  if (!Array.isArray(options)) {
    return undefined;
  }

  const stringOptions = options.filter((option): option is string => typeof option === "string");
  const normalizedValue = normalizeText(value);
  const normalizedValueWithoutGenericNoun = normalizeText(value.replace(GENERIC_TRAILING_NOUNS, ""));

  for (const option of stringOptions) {
    if (normalizeText(option) === normalizedValue) {
      return option;
    }
  }

  if (normalizedValueWithoutGenericNoun !== normalizedValue) {
    for (const option of stringOptions) {
      if (normalizeText(option) === normalizedValueWithoutGenericNoun) {
        return option;
      }
    }
  }

  return undefined;
}

export function getFieldAndFilterNodes(snapshot: CinderGraphSnapshot): CinderGraphNode[] {
  return snapshot.nodes.filter((node) => node.type === "field" || node.type === "filter");
}

// A cheap, lightweight pre-check before ever reaching the extractive-QA model (a real
// inference call per candidate) - found necessary via a real false positive: with no gate at
// all, "hey, what time is it" (no "to", no recognized verb, nothing resembling a command) was
// still sent to the QA model against every field/filter candidate, and it confidently (if
// wrongly) answered one of them. None of this module's own shape patterns matched that
// sentence either - there was never a reason to try an expensive, imperfectly-calibrated
// model call in the first place. This intentionally stays a broad, cheap net (a false NEGATIVE
// here just means a legitimate command gets the QA model's chance to still recover it; a false
// POSITIVE means a model call that was never going to find anything is attempted anyway) -
// the real safety net is still the QA stage's own score+gap requirement.
// Widened past the original narrow verb list after a real adversarial test found several
// legitimate, vague-but-real requests ("mark the ones that got delivered", "just show me
// everything in the leads module") had no keyword from the original list at all and were
// blocked before ever getting a chance. Safe to widen now that the QA stage itself validates
// its answer against the real options list (see the "hasEnumeratedOptions" check at each call
// site) - a false positive here just means a model call that finds nothing usable, not a
// fabricated value, which is what this gate originally existed to prevent.
const VALUE_COMMAND_SIGNAL = /\bto\b|\bfilter\b|\bshow\b|\bnarrow\b|\bsearch\b|\bfind\b|\blook\s?up\b|\bset\b|\bchange\b|\bupdate\b|\bmark\b|\bonly\b|\bjust\b|\beverything\b|\bwant\b|\bsee\b/i;

export function hasValueCommandSignal(input: string): boolean {
  return VALUE_COMMAND_SIGNAL.test(input);
}
