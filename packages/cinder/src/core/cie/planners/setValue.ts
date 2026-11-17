// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import type { CinderGraphQueryCandidate, CinderResolvedIntent } from "../../../types.js";
import { parseNumberWords } from "../numberWords.js";
import {
  buildAmbiguityReason,
  createIntent,
  createUnknownIntent,
  scoreToConfidence,
  type CinderPlannerContext,
} from "./shared.js";

/**
 * "set quantity to five" should set the field to "5", not the literal text "five" - a real
 * gap found during tier-1 research (number-word parsing is a standard NLU primitive; Amazon
 * Lex ships AMAZON.Number as a built-in slot type for exactly this). Only converts when the
 * ENTIRE value is a well-formed number phrase (parseNumberWords is strict about this) - "five
 * apples" or a crop name that happens to be a number word in a non-numeric context stays as
 * typed, since parseNumberWords rejects anything that isn't a clean, complete number.
 */
function normalizeValue(value: string): string {
  const asNumber = parseNumberWords(value);
  return asNumber === undefined ? value : String(asNumber);
}

function isStructurallyDistinct(
  left: CinderGraphQueryCandidate,
  right: CinderGraphQueryCandidate,
): boolean {
  return (
    left.node.contextId !== right.node.contextId ||
    left.node.routeId !== right.node.routeId ||
    left.node.parentId !== right.node.parentId
  );
}

export function matchSetValuePlanner({ cge, snapshot, normalizedInput, runtimeContext }: CinderPlannerContext): CinderResolvedIntent | undefined {
  // "set X to Y" is the canonical phrasing; these are the synonyms a user says in practice
  // for the same intent (choose/pick/select a value, change/update an existing one).
  const match = normalizedInput.normalized.match(
    /^(set|fill|choose|pick|select|change|update)\s+(.+?)\s+to\s+(.+)$/,
  );

  if (!match) {
    return undefined;
  }

  const targetTerm = match[2]?.trim();
  const rawValue = match[3]?.trim();

  if (!targetTerm || !rawValue) {
    return undefined;
  }

  const value = normalizeValue(rawValue);

  const fieldCandidates = cge.findCandidatesWithOptions(snapshot, targetTerm, ["field"], {
    graphPreference: "hot-only",
  });
  const filterCandidates = cge.findCandidatesWithOptions(snapshot, targetTerm, ["filter"], {
    graphPreference: "hot-only",
  });
  const bestField = fieldCandidates[0];
  const bestFilter = filterCandidates[0];

  if (!bestField && !bestFilter) {
    return undefined;
  }

  if (bestField && bestFilter && Math.abs(bestField.score - bestFilter.score) <= 6) {
    if (isStructurallyDistinct(bestField, bestFilter)) {
      return createUnknownIntent(
        normalizedInput,
        `Multiple field/filter candidates matched: ${bestField.node.key}, ${bestFilter.node.key}.`,
        runtimeContext,
      );
    }
  }

  const winner = [bestField, bestFilter]
    .filter((candidate): candidate is CinderGraphQueryCandidate => Boolean(candidate))
    .sort((left, right) => right.score - left.score)[0];

  if (!winner) {
    return undefined;
  }

  if (winner.node.type === "field") {
    const ambiguousField = fieldCandidates[1] && bestField && bestField.score - (fieldCandidates[1]?.score ?? 0) <= 8 && isStructurallyDistinct(bestField, fieldCandidates[1]!);

    if (ambiguousField) {
      return createUnknownIntent(
        normalizedInput,
        buildAmbiguityReason("field", fieldCandidates),
        runtimeContext,
      );
    }

    return createIntent(normalizedInput, "set_field", {
      target: winner.node.key,
      value,
      confidence: scoreToConfidence(winner.score),
      matchedNodeIds: [winner.node.id],
      context: {
        field: winner.node.key,
        contextId: winner.node.contextId,
      },
      steps: [{ type: "set_field", target: winner.node.key, value }],
    }, runtimeContext);
  }

  const ambiguousFilter = filterCandidates[1] && bestFilter && bestFilter.score - (filterCandidates[1]?.score ?? 0) <= 8 && isStructurallyDistinct(bestFilter, filterCandidates[1]!);

  if (ambiguousFilter) {
    return createUnknownIntent(
      normalizedInput,
      buildAmbiguityReason("filter", filterCandidates),
      runtimeContext,
    );
  }

  return createIntent(normalizedInput, "set_filter", {
    target: winner.node.key,
    value,
    confidence: scoreToConfidence(winner.score),
    matchedNodeIds: [winner.node.id],
    context: {
      filter: winner.node.key,
      contextId: winner.node.contextId,
    },
    steps: [{ type: "set_filter", target: winner.node.key, value }],
  }, runtimeContext);
}
