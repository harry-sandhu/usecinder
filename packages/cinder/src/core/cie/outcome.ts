import type { CinderDispatchResult, CinderResolvedIntent, CinderRunResult } from "../../types.js";

/**
 * Honest, structured classification of a resolved+dispatched command.
 *
 * - resolved_exact: the local graph/rule engine matched with high confidence.
 * - resolved_fuzzy: the local engine matched, but with low enough confidence that
 *   the match should be treated as a guess, not a certainty.
 * - resolved_but_dispatch_failed: the local engine correctly identified what to do,
 *   but executing it against the real DOM/graph failed (e.g. target no longer exists).
 * - not_resolved: the local engine could not match the input to anything at all
 *   (CIE returned the "unknown" intent).
 *
 * This exists so that a future AI fallback (or this project's own benchmark harness)
 * has one clean signal to key off of instead of re-deriving it from `intent`/`confidence`/
 * `dispatch.ok` ad hoc at every call site.
 */
export type CinderRunOutcome =
  | "resolved_exact"
  | "resolved_fuzzy"
  | "resolved_but_dispatch_failed"
  | "not_resolved";

export interface CinderRunOutcomeOptions {
  /** Confidence at or above this value counts as an exact/certain local match. Default 0.85. */
  exactConfidenceThreshold?: number;
}

const DEFAULT_EXACT_CONFIDENCE_THRESHOLD = 0.85;

export function isUnresolvedIntent(intent: CinderResolvedIntent): boolean {
  return intent.intent === "unknown" || intent.confidence <= 0;
}

export function classifyRunOutcome(
  intent: CinderResolvedIntent,
  dispatch: CinderDispatchResult | undefined,
  options: CinderRunOutcomeOptions = {},
): CinderRunOutcome {
  if (isUnresolvedIntent(intent)) {
    return "not_resolved";
  }

  if (dispatch && (!dispatch.ok || !dispatch.handled)) {
    return "resolved_but_dispatch_failed";
  }

  const threshold = options.exactConfidenceThreshold ?? DEFAULT_EXACT_CONFIDENCE_THRESHOLD;
  return intent.confidence >= threshold ? "resolved_exact" : "resolved_fuzzy";
}

export function classifyRunResult(
  result: CinderRunResult,
  options?: CinderRunOutcomeOptions,
): CinderRunOutcome {
  return classifyRunOutcome(result.intent, result.dispatch, options);
}
