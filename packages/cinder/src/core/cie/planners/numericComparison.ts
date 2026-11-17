import type { CinderGraphQueryCandidate, CinderResolvedIntent } from "../../../types.js";
import { parseNumberWords } from "../numberWords.js";
import {
  createIntent,
  createUnknownIntent,
  scoreToConfidence,
  type CinderPlannerContext,
} from "./shared.js";

/**
 * "show amount over 100" / "balance under 50" - a genuinely common way to state a numeric
 * threshold without the "set X to Y" phrasing matchSetValuePlanner requires. Deliberately
 * bounded, not a general comparison-operator feature: the DOM dispatch layer only ever
 * assigns a literal value (known-limitations.md #6), so the value actually set is just the
 * number itself - this planner's whole job is recognizing the comparison PHRASING and
 * routing it to the right field/filter, not inventing range-filter semantics Cinder's
 * dispatch can't deliver. The operator is still recorded in `context.comparison` so a caller
 * (or a UI that wants to show it) can see what the user actually said.
 */
const COMPARISON_PATTERN =
  /^(?:show|filter|find|get)?\s*(.+?)\s+(?:is\s+)?(over|above|more than|greater than|at least|under|below|less than|at most)\s+(.+)$/;

const GTE_PHRASES = new Set(["over", "above", "more than", "greater than", "at least"]);

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

export function matchNumericComparisonPlanner({ cge, snapshot, normalizedInput, runtimeContext }: CinderPlannerContext): CinderResolvedIntent | undefined {
  const match = normalizedInput.normalized.match(COMPARISON_PATTERN);

  if (!match) {
    return undefined;
  }

  const targetTerm = match[1]?.trim();
  const comparisonPhrase = match[2]?.trim();
  const rawValue = match[3]?.trim();

  if (!targetTerm || !comparisonPhrase || !rawValue) {
    return undefined;
  }

  // Only a genuinely numeric threshold counts - "run faster than yesterday" has the same
  // shape but isn't a number, and parseNumberWords rejects it cleanly.
  const numericValue = /^\d+(\.\d+)?$/.test(rawValue) ? Number(rawValue) : parseNumberWords(rawValue);

  if (numericValue === undefined) {
    return undefined;
  }

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

  // Require real numeric metadata (type="number" on the tagged element) before claiming
  // this - a candidate that merely MATCHED by name but is a plain text field shouldn't be
  // silently handed a bare number as if the comparison meant something there.
  if (winner.node.metadata?.inputType !== "number") {
    return undefined;
  }

  const intentType = winner.node.type === "field" ? "set_field" : "set_filter";
  const comparison = GTE_PHRASES.has(comparisonPhrase) ? "gte" : "lte";

  return createIntent(normalizedInput, intentType, {
    target: winner.node.key,
    value: numericValue,
    confidence: scoreToConfidence(winner.score),
    matchedNodeIds: [winner.node.id],
    context: {
      [winner.node.type]: winner.node.key,
      contextId: winner.node.contextId,
      comparison,
      comparisonPhrase,
    },
    steps: [{ type: intentType, target: winner.node.key, value: numericValue }],
  }, runtimeContext);
}
