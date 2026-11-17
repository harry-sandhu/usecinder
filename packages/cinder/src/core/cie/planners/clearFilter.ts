import type { CinderGraphNode, CinderResolvedIntent } from "../../../types.js";
import {
  buildAmbiguityReason,
  createIntent,
  createUnknownIntent,
  findBestCandidateOutcome,
  scoreToConfidence,
  type CinderPlannerContext,
} from "./shared.js";

/**
 * Negation's one genuinely common, genuinely free-to-special-case shape in tier 1: undoing a
 * filter someone already set ("clear the status filter", "remove the overdue filter", "reset
 * filters"). This isn't general negation ("show things that are NOT overdue") - that needs an
 * exclude-value semantic the dispatch layer doesn't have (DOM dispatch only ever assigns a
 * literal value, see known-limitations.md #6), so it stays out of tier 1's scope rather than
 * guessing at behavior Cinder can't actually deliver.
 */
const CLEAR_ONE_PATTERN = /^(?:clear|remove|reset)\s+(?:the\s+)?(.+?)\s+filter$/;
const CLEAR_ALL_PATTERN = /^(?:clear|reset)\s+(?:all\s+)?filters$/;

/**
 * Prefer a real "All"/"Any" option already offered by the filter itself over an arbitrary
 * empty string. Returns undefined - "don't know how to honestly clear this" - for a
 * select-backed filter with no such option, rather than falling back to "".
 *
 * Found necessary by real testing against the rupeey CRM: a real `<select>` with options
 * Day/Week/Half month/Month/Quarter/Custom (no "All"/blank option at all) silently ended up
 * showing "Day" after "clearing" it. That's standard HTMLSelectElement behavior, not a dispatch
 * bug - assigning a value matching no real `<option>` makes a non-multiple select fall back to
 * selecting its first option, not nothing - but it means `cleared: true` would have been a
 * lie: the filter wasn't cleared, it was silently reset to an arbitrary option that happened
 * to be first. A filter not backed by a real `<select>` (metadata.options undefined - a text
 * input, say) keeps the old "" behavior, since clearing a text field to empty is genuinely
 * correct there.
 */
function findClearedValue(node: CinderGraphNode): string | undefined {
  const options = node.metadata?.options;

  if (!Array.isArray(options)) {
    return "";
  }

  const stringOptions = options.filter((option): option is string => typeof option === "string");
  return stringOptions.find((option) => /^(all|any)$/i.test(option.trim()));
}

export function matchClearFilterPlanner({ cge, snapshot, normalizedInput, runtimeContext }: CinderPlannerContext): CinderResolvedIntent | undefined {
  const { normalized } = normalizedInput;

  if (CLEAR_ALL_PATTERN.test(normalized)) {
    const filterNodes = snapshot.nodes.filter(
      (node) => node.type === "filter" && node.metadata?.graphTemperature !== "cold",
    );

    // Only the filters that can be HONESTLY cleared - a select-backed filter with no "All"/
    // "Any" option is left untouched rather than silently reset to an arbitrary option (see
    // findClearedValue's doc comment). "Clear filters" clearing some but not all real filters
    // is still useful and still honest; claiming all of them cleared when some weren't would
    // not be.
    const clearableNodes = filterNodes
      .map((node) => ({ node, value: findClearedValue(node) }))
      .filter((entry): entry is { node: CinderGraphNode; value: string } => entry.value !== undefined);

    if (clearableNodes.length === 0) {
      return undefined;
    }

    return createIntent(normalizedInput, "composite_flow", {
      target: "filters",
      confidence: 0.9,
      matchedNodeIds: clearableNodes.map((entry) => entry.node.id),
      context: { clearedFilters: clearableNodes.map((entry) => entry.node.key) },
      steps: clearableNodes.map((entry) => ({
        type: "set_filter" as const,
        target: entry.node.key,
        value: entry.value,
      })),
    }, runtimeContext);
  }

  const match = normalized.match(CLEAR_ONE_PATTERN);

  if (!match) {
    return undefined;
  }

  const targetTerm = match[1]?.trim();

  if (!targetTerm) {
    return undefined;
  }

  const outcome = findBestCandidateOutcome(cge, snapshot, targetTerm, ["filter"], {
    graphPreference: "hot-only",
  });

  if (outcome.candidates && !outcome.node) {
    return createUnknownIntent(
      normalizedInput,
      buildAmbiguityReason("filter", outcome.candidates),
      runtimeContext,
    );
  }

  const filter = outcome.node;

  if (!filter) {
    return undefined;
  }

  const value = findClearedValue(filter);

  if (value === undefined) {
    return createUnknownIntent(
      normalizedInput,
      `"${filter.key}" has no "All"/"Any" option to clear to - clearing it would silently reset it to an arbitrary option instead.`,
      runtimeContext,
    );
  }

  return createIntent(normalizedInput, "set_filter", {
    target: filter.key,
    value,
    confidence: scoreToConfidence(outcome.candidates?.[0]?.score ?? 0),
    matchedNodeIds: [filter.id],
    context: {
      filter: filter.key,
      contextId: filter.contextId,
      cleared: true,
    },
    steps: [{ type: "set_filter", target: filter.key, value }],
  }, runtimeContext);
}
