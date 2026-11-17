import type { CinderGraphSnapshot, CinderNormalizedInput, CinderResolvedIntent } from "../../types.js";

/**
 * Narrow, zero-dependency reference carryover - NOT general anaphora resolution.
 *
 * Confirmed via tier-1 research (docs/local-engine-fully-fledged-plan.md §11): every
 * credible source on resolving "that"/"it" shows rule-based approaches reliably losing to
 * trained neural models - this is a genuinely hard, unsolved-at-this-scale problem in
 * general. What IS buildable zero-dependency, and is what this module does: remember the
 * single last successfully-resolved command, and recognize a small, fixed set of reference
 * phrases that refer back to it. One step back only. No multi-turn history, no general
 * pronoun resolution, no tracking "what were we just talking about" across a conversation.
 *
 * Two supported patterns:
 * 1. A standalone "repeat" phrase ("again", "do that again", "repeat it", ...) re-runs the
 *    exact last resolved command, unchanged.
 * 2. A trailing reference word ("that", "it", "this", "the same") at the END of a
 *    single-object command ("show that", "open it") is substituted with the last resolved
 *    node's own key, then resolved through the normal pipeline - so it inherits every
 *    existing safety net (ambiguity checks, confidence scoring) for free, and fails cleanly
 *    (not_resolved) if the substitution doesn't make sense for the new verb.
 *
 * Deliberately NOT supported, to avoid a second, different kind of ambiguity: a reference
 * word in the VALUE position of a set_field/set_filter command ("set state to that") could
 * mean either "the same node" or "the same value as before" - two different, incompatible
 * meanings - so that shape is left alone rather than guessing which one was meant.
 */

const REPEAT_PHRASES = new Set([
  "again",
  "once more",
  "do that again",
  "do it again",
  "do the same",
  "do the same again",
  "repeat that",
  "repeat it",
  "same again",
]);

const TRAILING_REFERENCE_WORDS = new Set(["that", "it", "this"]);
const TRAILING_REFERENCE_PHRASE = "the same";

/**
 * Caps how many words may precede the trailing reference word/phrase. The doc comment above
 * scopes this feature to a "single-object command" - "show that", "open it" - which the
 * existing coverage (scripts/validate-reference-carryover.mjs) only ever exercises at 1 word
 * of verb before the reference word. Without a cap, ANY sentence of any length that happens
 * to end in "it"/"that"/"this" gets the substitution, which is a much bigger surface than
 * "single-object command" implies.
 *
 * Found via a real stress test (rupeey91repl-cinder, a lending-ops tool, not Cinder's own
 * site): after any successful command, a totally unrelated follow-up question like "what time
 * is it" or "... something funny like that" got rewritten to "what time is export-csv" /
 * "... funny like export-csv" - and because the engine's own kebab-case key then appears as a
 * literal token in the rewritten text, the action/route planner matched it with full "exact"
 * confidence. The pipeline's own safety nets (isPlausibleCommand, confidence scoring) don't
 * catch this, because a literal key-as-token match doesn't look any different from a real one
 * once the substitution has already happened - the fix has to stop the bad substitution from
 * being attempted in the first place, not try to catch it after the fact.
 */
const MAX_PRECEDING_WORDS = 2;

/**
 * Matches the same "set X to Y" shape matchSetValuePlanner recognizes. A trailing reference
 * word in THIS shape sits in the VALUE position ("set crop to that"), which is a genuinely
 * different, ambiguous meaning - "the same node as before" and "the same value as before"
 * are both plausible readings, and guessing either one risks silently setting the wrong
 * thing. Rather than pick one, substitution is skipped entirely for this shape - confirmed
 * via a real test case ("set crop to that" was wrongly substituting the last node's KEY into
 * the value position, e.g. producing "set crop to state" instead of leaving it alone).
 */
const SET_VALUE_SHAPE_PATTERN = /^(set|fill|choose|pick|select|change|update)\s+.+\s+to\s+.+$/i;

export interface CinderReferenceState {
  lastIntent?: CinderResolvedIntent;
  lastNodeKey?: string;
}

export function createReferenceState(): CinderReferenceState {
  return {};
}

/**
 * Called once per resolve() call, on whatever the rest of the pipeline ultimately decided -
 * including a repeated or reference-substituted result, so "again" after "again" keeps
 * repeating the same original command, and "that" can chain ("show price" -> "open that"
 * fails cleanly since price isn't a route -> but "show that" after "show price" works).
 */
export function rememberResolved(
  state: CinderReferenceState,
  intent: CinderResolvedIntent,
  snapshot: CinderGraphSnapshot,
): void {
  if (intent.intent === "unknown") {
    return;
  }

  state.lastIntent = intent;

  const lastMatchedId = intent.matchedNodeIds?.[intent.matchedNodeIds.length - 1];
  const node = lastMatchedId ? snapshot.nodes.find((candidate) => candidate.id === lastMatchedId) : undefined;
  state.lastNodeKey = node?.key;
}

export function tryResolveRepeat(
  state: CinderReferenceState,
  normalizedInput: CinderNormalizedInput,
): CinderResolvedIntent | undefined {
  if (!state.lastIntent || !REPEAT_PHRASES.has(normalizedInput.normalized)) {
    return undefined;
  }

  return {
    ...state.lastIntent,
    normalizedInput,
    reason: "Repeated the previously resolved command.",
  };
}

/**
 * Returns a rewritten raw input string with a trailing reference word swapped for the last
 * resolved node's key, or undefined if there's nothing to substitute (no prior command yet,
 * or the input doesn't end in a recognized reference word/phrase).
 */
export function substituteTrailingReference(state: CinderReferenceState, rawInput: string): string | undefined {
  if (!state.lastNodeKey) {
    return undefined;
  }

  const trimmedInput = rawInput.trim();

  if (SET_VALUE_SHAPE_PATTERN.test(trimmedInput)) {
    return undefined;
  }

  const words = trimmedInput.split(/\s+/);

  if (words.length < 2) {
    return undefined;
  }

  const lastTwoWords = words
    .slice(-2)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .trim();

  if (lastTwoWords === TRAILING_REFERENCE_PHRASE) {
    const precedingWords = words.slice(0, -2);

    if (precedingWords.length === 0 || precedingWords.length > MAX_PRECEDING_WORDS) {
      return undefined;
    }

    return [...precedingWords, state.lastNodeKey].join(" ");
  }

  const lastWord = words[words.length - 1]!.toLowerCase().replace(/[^a-z]/g, "");

  if (TRAILING_REFERENCE_WORDS.has(lastWord)) {
    const precedingWords = words.slice(0, -1);

    if (precedingWords.length === 0 || precedingWords.length > MAX_PRECEDING_WORDS) {
      return undefined;
    }

    return [...precedingWords, state.lastNodeKey].join(" ");
  }

  return undefined;
}
