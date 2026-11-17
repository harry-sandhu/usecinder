// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import type { CinderGraphNode, CinderResolvedIntent } from "../../../types.js";
import { createIntent, createUnknownIntent, isHotGraphNode, type CinderPlannerContext } from "./shared.js";

/**
 * Recognizes "filter by X" / "show only X" / "narrow (it/this) down by X" - phrasing that
 * doesn't fit matchSetValuePlanner's "set X to Y" shape at all (no field name, no "to"), but
 * is probably the single most natural way a real visitor asks to narrow a list down, the same
 * way matchSearchFieldPlanner was built for "search for X" instead of "set search to X".
 *
 * Found missing via a real stress test (rupeey91repl-cinder, a lending-ops CRM, not Cinder's
 * own site): a generic "filter by overdue" phrasing had no planner that could ever match it.
 *
 * Unlike the search-field planner, there's no structural keyword (like "search"/"query" in a
 * key) that says which filter a bare VALUE belongs to - "overdue" doesn't name a filter, it
 * names one of a filter's real OPTIONS. So this planner goes the other way: it looks at every
 * filter node's own captured `<select>` option labels (tagScanner.ts, metadata.options) and
 * finds which filter actually OFFERS the stated value. Exactly one match: confident pick.
 * Two different filters both offering the same option text (e.g. two "Active"/"Inactive"
 * selects on one page): honest ambiguity, same as every other planner - never guess.
 */
// The "(?:\s+(?:it|this)(?:\s+\w+)?)?" tolerates a short noun in between ("filter this LIST
// by X", "narrow this DATA down by X") - found missing via a real live-browser test ("filter
// this list by rejected leads" didn't match without it). Still anchored to position 0 like
// every other tier-1 planner - this widens what counts as the verb phrase, it doesn't lift
// the "verb must be first" requirement itself.
const FILTER_BY_PATTERN = /^(?:filter(?:\s+(?:it|this)(?:\s+\w+)?)? by|filter to|show only|only show|narrow(?:\s+(?:it|this)(?:\s+\w+)?)?(?:\s+down)? by)\s+(.+)$/;

// A real value phrase very commonly carries a generic trailing noun the option label itself
// never does ("fresh LEADS" vs. the option "Fresh") - found missing the same way. Deliberately
// a short, specific list rather than general substring containment: several real option sets
// here share a prefix ("Self-serve and staff" / "Self-serve only"), where loose containment
// would make two different options both match one loosely-worded value - an ambiguity this
// planner should decline, not guess through.
const GENERIC_TRAILING_NOUNS = /\s+(leads?|loans?|accounts?|customers?|records?|items?|entries|results?|ones?)$/i;

function normalizeValue(value: string): string {
  return value.trim().toLowerCase();
}

function findOfferedOption(node: CinderGraphNode, normalizedValue: string, rawValue: string): string | undefined {
  const options = node.metadata?.options;

  if (!Array.isArray(options)) {
    return undefined;
  }

  const stringOptions = options.filter((option): option is string => typeof option === "string");
  const normalizedValueWithoutGenericNoun = normalizeValue(rawValue.replace(GENERIC_TRAILING_NOUNS, ""));

  for (const option of stringOptions) {
    if (normalizeValue(option) === normalizedValue) {
      return option;
    }
  }

  if (normalizedValueWithoutGenericNoun !== normalizedValue) {
    for (const option of stringOptions) {
      if (normalizeValue(option) === normalizedValueWithoutGenericNoun) {
        return option;
      }
    }
  }

  return undefined;
}

export function matchFilterByValuePlanner({ snapshot, normalizedInput, runtimeContext }: CinderPlannerContext): CinderResolvedIntent | undefined {
  const match = normalizedInput.normalized.match(FILTER_BY_PATTERN);

  if (!match) {
    return undefined;
  }

  const rawValue = match[1]?.trim();

  if (!rawValue) {
    return undefined;
  }

  const normalizedValue = normalizeValue(rawValue);
  const matches: { node: CinderGraphNode; option: string }[] = [];

  for (const node of snapshot.nodes) {
    if (node.type !== "filter" || !isHotGraphNode(node)) {
      continue;
    }

    const option = findOfferedOption(node, normalizedValue, rawValue);

    if (option) {
      matches.push({ node, option });
    }
  }

  if (matches.length === 0) {
    return undefined;
  }

  const distinctKeys = new Set(matches.map((candidate) => candidate.node.key));

  if (distinctKeys.size > 1) {
    return createUnknownIntent(
      normalizedInput,
      `Multiple filters offer "${rawValue}" as a value: ${Array.from(distinctKeys).join(", ")}.`,
      runtimeContext,
    );
  }

  const winner = matches[0]!;

  // Fixed, not score-derived like matchSetValuePlanner: this isn't scoring how well a TERM
  // matched a node's key/alias (there's no field name in the sentence at all) - it's "exactly
  // one real filter offers this value," a structural match, deliberately below the 0.85
  // resolved_exact threshold so it classifies as resolved_fuzzy, same reasoning as the
  // search-field planner's fixed 0.7.
  return createIntent(normalizedInput, "set_filter", {
    target: winner.node.key,
    value: winner.option,
    confidence: 0.75,
    matchedNodeIds: [winner.node.id],
    context: {
      filter: winner.node.key,
      contextId: winner.node.contextId,
    },
    steps: [{ type: "set_filter", target: winner.node.key, value: winner.option }],
  }, runtimeContext);
}
