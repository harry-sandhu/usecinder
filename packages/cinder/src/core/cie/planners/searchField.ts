// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import type { CinderGraphNode, CinderResolvedIntent } from "../../../types.js";
import { createIntent, createUnknownIntent, type CinderPlannerContext } from "./shared.js";

/**
 * Recognizes "search for X" / "look up X" / "find X" - phrasing that doesn't fit
 * matchSetValuePlanner's "set X to Y" shape at all (no target name, no "to"), but is
 * probably the single most natural way a real visitor would try to use a site's actual
 * search box. Found missing via a real-site stress test (apps/web, usecinder.dev): 100/120
 * "search for <topic>" phrasings failed outright.
 *
 * Deliberately generic, not hardcoded to any one field's name: it looks for whichever
 * field on the page structurally indicates it's a search field (its own key or an alias
 * contains "search" or "query" as a whole word), the same way a developer would name it on
 * any site, rather than being tied to this one site's "docs-search-query" key.
 */
const SEARCH_FIELD_INDICATOR_WORDS = new Set(["search", "query"]);

function tokenize(value: string): string[] {
  return value.split("-").filter((token) => token.length > 0);
}

function isSearchLikeField(node: CinderGraphNode): boolean {
  if (tokenize(node.key).some((token) => SEARCH_FIELD_INDICATOR_WORDS.has(token))) {
    return true;
  }

  return (node.aliases ?? []).some((alias) =>
    tokenize(alias).some((token) => SEARCH_FIELD_INDICATOR_WORDS.has(token)),
  );
}

function isStructurallyDistinct(left: CinderGraphNode, right: CinderGraphNode): boolean {
  return (
    left.contextId !== right.contextId ||
    left.routeId !== right.routeId ||
    left.parentId !== right.parentId
  );
}

export function matchSearchFieldPlanner({ snapshot, normalizedInput, runtimeContext }: CinderPlannerContext): CinderResolvedIntent | undefined {
  const match = normalizedInput.normalized.match(/^(search for|look up|lookup|find)\s+(.+)$/);

  if (!match) {
    return undefined;
  }

  const value = match[2]?.trim();

  if (!value) {
    return undefined;
  }

  const candidates = snapshot.nodes.filter((node) => node.type === "field" && isSearchLikeField(node));

  if (candidates.length === 0) {
    return undefined;
  }

  const [first, second] = candidates;

  if (first && second && isStructurallyDistinct(first, second)) {
    return createUnknownIntent(
      normalizedInput,
      `Multiple search-like field candidates matched: ${candidates.map((node) => node.key).join(", ")}.`,
      runtimeContext,
    );
  }

  const target = first!;

  // Fixed, not score-derived like the other planners: this isn't scoring how well the
  // user's TERM matched a node's identity (there's no term here beyond "search for"/"find"
  // itself) - it's a structural "is this the page's search field" check, which is a looser
  // kind of confidence than a direct key/alias match. Deliberately below the 0.85
  // resolved_exact threshold so it classifies as resolved_fuzzy, not exact.
  return createIntent(normalizedInput, "set_field", {
    target: target.key,
    value,
    confidence: 0.7,
    matchedNodeIds: [target.id],
    context: {
      field: target.key,
      contextId: target.contextId,
    },
    steps: [{ type: "set_field", target: target.key, value }],
  }, runtimeContext);
}
