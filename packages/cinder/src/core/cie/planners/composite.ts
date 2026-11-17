// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import type { CinderNormalizedInput, CinderResolutionStep, CinderResolvedIntent } from "../../../types.js";

/**
 * Splits "do X and Y" / "do X then Y" / "do X, do Y" into separate clauses, generically -
 * not tied to any domain vocabulary (unlike the agriculture-specific searchFlow planner).
 * Each clause is resolved independently by the caller's single-clause resolver and the
 * results are combined into one composite_flow intent.
 *
 * This MUST split on the RAW input, not the normalized one: normalizeInput's punctuation
 * stripping (core/cie/normalizer.ts) turns "," into a space before anything downstream ever
 * sees it, so by the time a normalized string reaches this function a comma-separated
 * composite is already indistinguishable from "a b" with no boundary at all. Splitting the
 * raw text preserves that signal; each resulting clause is normalized independently by the
 * caller's resolver.
 */
const COMPOSITE_SPLIT_PATTERN = /\s*,\s*(?:and\s+)?|\s+(?:and then|then|and)\s+/i;

export function splitCompositeInput(raw: string): string[] | undefined {
  if (!COMPOSITE_SPLIT_PATTERN.test(raw)) {
    return undefined;
  }

  const clauses = raw
    .split(COMPOSITE_SPLIT_PATTERN)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);

  return clauses.length >= 2 ? clauses : undefined;
}

export type ClauseResolver = (clauseInput: string) => CinderResolvedIntent | undefined;

export function matchCompositePlanner(
  raw: string,
  normalizedInput: CinderNormalizedInput,
  resolveClause: ClauseResolver,
): CinderResolvedIntent | undefined {
  const clauses = splitCompositeInput(raw);

  if (!clauses) {
    return undefined;
  }

  const resolvedClauses: CinderResolvedIntent[] = [];

  for (const clause of clauses) {
    let resolved: CinderResolvedIntent | undefined;

    try {
      resolved = resolveClause(clause);
    } catch {
      // A throwing clause resolver (e.g. a registered custom intent matcher with a bug)
      // must not crash the whole composite resolution - treat it the same as "this clause
      // didn't resolve" and fall through to the whole-string single match / unknown intent,
      // consistent with how registered matchers/adapters are guarded everywhere else.
      resolved = undefined;
    }

    // Honest-failure rule (see CinderRunOutcome): a composite command is only reported as
    // resolved if every clause resolved. Guessing at a partially-understood composite
    // command is worse than reporting not_resolved and letting the caller escalate.
    if (!resolved || resolved.intent === "unknown") {
      return undefined;
    }

    resolvedClauses.push(resolved);
  }

  const steps: CinderResolutionStep[] = resolvedClauses.flatMap(
    (clause) => clause.steps ?? [{ type: clause.intent as CinderResolutionStep["type"], target: clause.target, value: clause.value }],
  );

  const matchedNodeIds = resolvedClauses.flatMap((clause) => clause.matchedNodeIds ?? []);
  const context = resolvedClauses.reduce<Record<string, unknown>>(
    (merged, clause) => ({ ...merged, ...(clause.context ?? {}) }),
    {},
  );
  const confidence = Math.min(...resolvedClauses.map((clause) => clause.confidence));

  return {
    intent: "composite_flow",
    confidence,
    source: "local",
    normalizedInput,
    steps,
    matchedNodeIds,
    context: Object.keys(context).length > 0 ? context : undefined,
  };
}
