import type {
  CinderGraphNode,
  CinderGraphNodeType,
  CinderGraphQueryCandidate,
  CinderGraphSnapshot,
  CinderNormalizedInput,
  CinderResolvedIntent,
  CinderRuntimeContext,
} from "../../../types.js";
import type {
  CinderGraphQueryEngine,
  CinderGraphQueryOptions,
} from "../../cge/index.js";

export interface CinderPlannerContext {
  snapshot: CinderGraphSnapshot;
  normalizedInput: CinderNormalizedInput;
  runtimeContext?: CinderRuntimeContext;
  cge: CinderGraphQueryEngine;
}

export interface CandidateOutcome {
  node?: CinderGraphNode;
  candidates?: CinderGraphQueryCandidate[];
}

export function getMergedContext(
  runtimeContext?: CinderRuntimeContext,
  context?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const merged = {
    ...(runtimeContext ?? {}),
    ...(context ?? {}),
  };

  return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * Converts a raw cge match score (roughly 0-100: 100 key-exact, 90 alias-exact, 60
 * key-includes, 50 alias-includes - see scoreNodeMatch in core/cge/queryEngine.ts) into the
 * confidence a CinderResolvedIntent reports.
 *
 * Before this, every planner reported a flat hardcoded confidence (0.92, 0.9, 0.88, 0.95)
 * regardless of whether the underlying match was an exact key hit or a weak substring
 * fuzzy match - so `confidence` told a caller nothing real about how sure the engine
 * actually was. This was a real, user-visible problem, not a cosmetic one: a weak
 * "alias-includes" substring match (e.g. the term "price" matching a route's derived alias
 * "save-price" purely because "price" is a substring of it) was reported at the same
 * hardcoded high confidence as a true exact-key match, with no way for a caller - or the
 * resolved_exact/resolved_fuzzy outcome classifier - to tell the two apart.
 *
 * Clamped to [0.3, 0.98]: even a perfect key-exact match isn't asserted as absolute
 * certainty (0.98, not 1.0), and even the weakest fuzzy match found by the engine is worth
 * more than zero (0.3, not lower) since it did clear the engine's own candidate threshold.
 */
export function scoreToConfidence(score: number): number {
  const normalized = Math.max(0, Math.min(100, score)) / 100;
  return Math.round(Math.max(0.3, Math.min(0.98, normalized)) * 100) / 100;
}

export function getRuntimeContextString(
  runtimeContext: CinderRuntimeContext | undefined,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = runtimeContext?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

export function createUnknownIntent(
  normalizedInput: CinderNormalizedInput,
  reason: string,
  runtimeContext?: CinderRuntimeContext,
): CinderResolvedIntent {
  return {
    intent: "unknown",
    confidence: 0,
    source: "local",
    normalizedInput,
    reason,
    context: getMergedContext(runtimeContext),
  };
}

export function createIntent(
  normalizedInput: CinderNormalizedInput,
  intent: string,
  options: Omit<CinderResolvedIntent, "intent" | "source" | "normalizedInput">,
  runtimeContext?: CinderRuntimeContext,
): CinderResolvedIntent {
  return {
    intent,
    source: "local",
    normalizedInput,
    ...options,
    context: getMergedContext(runtimeContext, options.context),
  };
}

function areCandidatesStructurallyDistinct(
  left: CinderGraphQueryCandidate,
  right: CinderGraphQueryCandidate,
): boolean {
  return (
    left.node.contextId !== right.node.contextId ||
    left.node.routeId !== right.node.routeId ||
    left.node.parentId !== right.node.parentId
  );
}

function isAmbiguous(candidates: CinderGraphQueryCandidate[]): boolean {
  if (candidates.length < 2) {
    return false;
  }

  const [first, second] = candidates;
  if (!first || !second) {
    return false;
  }

  if (first.score - second.score > 8) {
    return false;
  }

  // Two DIFFERENT real keys tying closely in score is unambiguous grounds for "don't know
  // which was meant," regardless of where they sit structurally - this is the failure mode
  // the typo-tolerant fuzzy matching tier (queryEngine.ts) introduces: two unrelated real
  // words (e.g. "pine" and "wine") can now both be an equally plausible correction of the
  // same typo, in the SAME scope, which areCandidatesStructurallyDistinct alone doesn't
  // catch (it was built for a different case: the SAME key duplicated across different
  // scopes - two "save" buttons in two different page regions). Found via a real adversarial
  // test: a typo equidistant between two different action keys in one context was
  // confidently resolved instead of flagged ambiguous.
  if (first.node.key !== second.node.key) {
    return true;
  }

  return areCandidatesStructurallyDistinct(first, second);
}

export function buildAmbiguityReason(
  label: string,
  candidates: CinderGraphQueryCandidate[],
): string {
  const topCandidates = candidates
    .slice(0, 3)
    .map((candidate) => candidate.node.key)
    .join(", ");

  return `Multiple ${label} candidates matched: ${topCandidates}.`;
}

export function getNodeContextId(node: CinderGraphNode | undefined): string | undefined {
  if (!node) {
    return undefined;
  }

  return node.type === "context" ? node.id : node.contextId;
}

export function getNodeRouteId(node: CinderGraphNode | undefined): string | undefined {
  if (!node) {
    return undefined;
  }

  return node.type === "route" ? node.id : node.routeId;
}

export function isHotGraphNode(node: CinderGraphNode | undefined): boolean {
  return node?.metadata?.graphTemperature !== "cold";
}

export function createGraphQueryOptionsFromNode(
  node: CinderGraphNode | undefined,
  graphPreference: CinderGraphQueryOptions["graphPreference"] = "hot-first",
): CinderGraphQueryOptions | undefined {
  const contextId = getNodeContextId(node);
  const routeId = getNodeRouteId(node);

  if (!node && !contextId && !routeId) {
    return undefined;
  }

  return {
    preferredContextIds: contextId ? [contextId] : undefined,
    preferredRouteIds: routeId ? [routeId] : undefined,
    anchorNodeIds: node ? [node.id] : undefined,
    graphPreference,
  };
}

export function createHotGraphQueryOptionsFromNode(
  node: CinderGraphNode | undefined,
): CinderGraphQueryOptions | undefined {
  return createGraphQueryOptionsFromNode(node, "hot-only");
}

export function findBestCandidateOutcome(
  cge: CinderGraphQueryEngine,
  snapshot: CinderGraphSnapshot,
  term: string,
  types: CinderGraphNodeType[],
  options?: CinderGraphQueryOptions,
): CandidateOutcome {
  const candidates = options
    ? cge.findCandidatesWithOptions(snapshot, term, types, options)
    : cge.findCandidates(snapshot, term, types);

  if (candidates.length === 0) {
    return {};
  }

  if (isAmbiguous(candidates)) {
    return { candidates };
  }

  return {
    node: candidates[0]?.node,
    candidates,
  };
}

export function findBestCandidateOutcomeWithFallback(
  cge: CinderGraphQueryEngine,
  snapshot: CinderGraphSnapshot,
  term: string,
  types: CinderGraphNodeType[],
  primaryOptions?: CinderGraphQueryOptions,
  fallbackOptions?: CinderGraphQueryOptions,
): CandidateOutcome {
  const primaryOutcome = findBestCandidateOutcome(cge, snapshot, term, types, primaryOptions);

  if (primaryOutcome.node || primaryOutcome.candidates) {
    return primaryOutcome;
  }

  return findBestCandidateOutcome(cge, snapshot, term, types, fallbackOptions);
}

export function findNodeInActiveContext(
  snapshot: CinderGraphSnapshot,
  type: CinderGraphNode["type"],
  key: string,
  options?: { hotOnly?: boolean },
): CinderGraphNode | undefined {
  return snapshot.nodes.find((node) => {
    return (
      node.type === type &&
      node.key === key &&
      node.contextId === snapshot.runtime.activeContextId &&
      (!options?.hotOnly || isHotGraphNode(node))
    );
  });
}
