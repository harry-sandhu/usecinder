import type {
  CinderGraphLayerSource,
  CinderGraphNode,
  CinderGraphNodeType,
  CinderGraphQueryCandidate,
  CinderGraphSnapshot,
} from "../../types.js";
import { normalizeSemanticKey } from "../semantic/normalize.js";

const ROOT_INDEX_KEY = "__root__";

interface SnapshotQueryCache {
  nodeById: Map<string, CinderGraphNode>;
  nodesByType: Map<CinderGraphNodeType, CinderGraphNode[]>;
  childrenByParentId: Map<string, CinderGraphNode[]>;
  normalizedKeyIndex: Map<string, CinderGraphNode[]>;
  normalizedAliasIndex: Map<string, CinderGraphNode[]>;
  ancestorIdsByNodeId: Map<string, Set<string>>;
  exactCandidateCache: Map<string, CinderGraphQueryCandidate[]>;
  globalFuzzyCandidateCache: Map<string, CinderGraphQueryCandidate[]>;
}

export interface CinderGraphQueryOptions {
  preferredContextIds?: string[];
  preferredRouteIds?: string[];
  anchorNodeIds?: string[];
  graphPreference?: "hot-first" | "hot-only" | "cold-first" | "cold-only";
  requiredGraphSources?: CinderGraphLayerSource[];
}

export interface CinderGraphQueryDiagnostics {
  snapshotCacheBuilds: number;
  exactCacheHits: number;
  globalFuzzyCacheHits: number;
  globalFuzzyScans: number;
  activePoolQueries: number;
  lastQuery?: {
    term: string;
    types: CinderGraphNodeType[];
    mode: "exact" | "active" | "global" | "empty";
    candidatePoolSize: number;
    totalTypeNodeCount: number;
  };
  snapshot?: {
    nodeCount: number;
    indexedKeyCount: number;
    indexedAliasCount: number;
    exactCacheEntryCount: number;
    globalFuzzyCacheEntryCount: number;
  };
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(value);
  }

  return result;
}

function uniqueNodes(nodes: Array<CinderGraphNode | undefined>): CinderGraphNode[] {
  const seen = new Set<string>();
  const result: CinderGraphNode[] = [];

  for (const node of nodes) {
    if (!node || seen.has(node.id)) {
      continue;
    }

    seen.add(node.id);
    result.push(node);
  }

  return result;
}

function normalizeTerm(term: string): string {
  return normalizeSemanticKey(term);
}

/**
 * Splits an already-normalized (dash-separated) term/key into its words. Both a query term
 * ("open search" -> normalized to "open-search") and a real compound action key
 * ("open-docs-search") end up dash-separated by normalizeSemanticKey, so this works
 * identically on either side of a match.
 */
function tokenizeNormalized(value: string): string[] {
  return value.split("-").filter((token) => token.length > 0);
}

/**
 * True when every word in `term` appears somewhere among `key`'s words - e.g. query
 * "open search" (tokens: open, search) against key "open-docs-search" (tokens: open, docs,
 * search): both query words are present, so this matches even though neither is a substring
 * of the other (found via real-site testing: compound action keys like "open-docs-search" or
 * "toggle-theme-desktop" don't substring-match natural phrasings like "open search" or
 * "toggle theme" at all under plain containment checks).
 *
 * Deliberately requires FULL coverage of the query's words, not partial: "open menu" against
 * "open-docs-search" only has 1 of 2 query words present, so it correctly does NOT match -
 * partial overlap is exactly the kind of looseness that caused the original "price"-matches-
 * "reports" bug this session already fixed once (see tagRecord.ts's textContent exclusion).
 * A query that's just one common word ("search") will match multiple keys containing that
 * word, which is intentional - that's a genuine ambiguity, and isAmbiguous() (shared.ts)
 * already handles reporting it as unknown rather than guessing.
 */
function hasFullTokenOverlap(term: string, key: string): boolean {
  const termTokens = tokenizeNormalized(term);

  if (termTokens.length === 0) {
    return false;
  }

  const keyTokens = new Set(tokenizeNormalized(key));
  return termTokens.every((token) => keyTokens.has(token));
}

/**
 * True Damerau-Levenshtein edit distance (insert, delete, substitute, AND adjacent-
 * transposition each cost 1) - the transposition case matters specifically because a
 * one-letter-swap typo ("sacn" for "scan") is the most common realistic typo shape, and
 * plain Levenshtein distance would score that as 2 edits (delete + insert) instead of the 1
 * it actually is, pushing it out of a tight tolerance budget for no good reason.
 *
 * Researched and chosen over SymSpell (a precomputed delete-dictionary technique for very
 * fast lookup against large dictionaries - tens of thousands of words; Cinder matches
 * against a handful to a few hundred tagged node keys/aliases per page, so that lookup-speed
 * problem doesn't exist here) and over Jaro-Winkler (not a true metric, and its sign
 * convention/prefix-bonus tuning is an easy thing to get subtly wrong hand-rolled, for no
 * clear accuracy win over Damerau-Levenshtein at these short command-word lengths).
 */
function damerauLevenshteinDistance(a: string, b: string): number {
  const aLength = a.length;
  const bLength = b.length;

  if (aLength === 0) {
    return bLength;
  }

  if (bLength === 0) {
    return aLength;
  }

  const distances: number[][] = Array.from({ length: aLength + 1 }, () => new Array<number>(bLength + 1).fill(0));

  for (let i = 0; i <= aLength; i += 1) {
    distances[i]![0] = i;
  }

  for (let j = 0; j <= bLength; j += 1) {
    distances[0]![j] = j;
  }

  for (let i = 1; i <= aLength; i += 1) {
    for (let j = 1; j <= bLength; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;

      let best = Math.min(
        distances[i - 1]![j]! + 1,
        distances[i]![j - 1]! + 1,
        distances[i - 1]![j - 1]! + substitutionCost,
      );

      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, distances[i - 2]![j - 2]! + 1);
      }

      distances[i]![j] = best;
    }
  }

  return distances[aLength]![bLength]!;
}

/**
 * How many edits a word is allowed to be off by before it's treated as a typo of a
 * different word, scaled by the word's own length. Researched tiering (Optimizely's fuzzy
 * search: 0 edits <=2 chars, 1 edit 3-5 chars, 2 edits 6+ chars; Elastic explicitly warns
 * "allowing two edits on a string of length 3 is overkill" since two edits on "hat" can
 * produce "mad"). A flat tolerance regardless of length is exactly the kind of looseness
 * that caused this project's earlier bugs (a short, accidentally-substring-matching term
 * standing in for something unrelated) - short words get zero tolerance so they can only
 * match themselves exactly, not collide with a different short real word.
 */
function maxAllowedEditDistance(tokenLength: number): number {
  if (tokenLength <= 3) {
    return 0;
  }

  if (tokenLength <= 6) {
    return 1;
  }

  return 2;
}

/**
 * The typo-tolerant counterpart to hasFullTokenOverlap: every word in the query must have
 * SOME word in the key/alias within that word's own length-scaled edit-distance budget.
 * Still requires FULL coverage of the query's words (same reasoning as hasFullTokenOverlap -
 * partial overlap is exactly the kind of looseness this project keeps finding and fixing
 * bugs from), just tolerating a bounded number of typo'd letters per word instead of
 * requiring an exact match.
 */
function hasFullTokenFuzzyOverlap(term: string, key: string): boolean {
  const termTokens = tokenizeNormalized(term);

  if (termTokens.length === 0) {
    return false;
  }

  const keyTokens = tokenizeNormalized(key);

  if (keyTokens.length === 0) {
    return false;
  }

  return termTokens.every((termToken) => {
    const maxDistance = maxAllowedEditDistance(termToken.length);
    return keyTokens.some((keyToken) => damerauLevenshteinDistance(termToken, keyToken) <= maxDistance);
  });
}

function normalizeTypes(types: CinderGraphNodeType[]): CinderGraphNodeType[] {
  return [...new Set(types)].sort();
}

function makeQueryKey(term: string, types: CinderGraphNodeType[]): string {
  return `${normalizeTerm(term)}|${normalizeTypes(types).join(",")}`;
}

function scoreNodeMatch(node: CinderGraphNode, term: string): CinderGraphQueryCandidate | undefined {
  const normalizedTerm = normalizeTerm(term);

  if (!normalizedTerm) {
    return undefined;
  }

  const nodeKey = normalizeTerm(node.key);
  const aliases = (node.aliases ?? []).map((alias) => normalizeTerm(alias));

  if (nodeKey === normalizedTerm) {
    return { node, score: 100, matchType: "key-exact" };
  }

  if (aliases.includes(normalizedTerm)) {
    return { node, score: 90, matchType: "alias-exact" };
  }

  if (normalizedTerm.includes(nodeKey) || nodeKey.includes(normalizedTerm)) {
    return { node, score: 60, matchType: "key-includes" };
  }

  if (aliases.some((alias) => normalizedTerm.includes(alias) || alias.includes(normalizedTerm))) {
    return { node, score: 50, matchType: "alias-includes" };
  }

  if (hasFullTokenOverlap(normalizedTerm, nodeKey)) {
    return { node, score: 65, matchType: "key-token-overlap" };
  }

  const aliasTokenOverlap = aliases.find((alias) => hasFullTokenOverlap(normalizedTerm, alias));

  if (aliasTokenOverlap) {
    return { node, score: 55, matchType: "alias-token-overlap" };
  }

  // Deliberately last and lowest-scored: only reached once every exact/substring/token-
  // overlap check above has failed, and scored low enough (via scoreToConfidence) that a
  // typo match can never classify as resolved_exact - only resolved_fuzzy, and never
  // outranks a real match if one also exists for a different node (isAmbiguous in
  // shared.ts's ambiguity gap-check still applies on top of this, same as every other tier).
  if (hasFullTokenFuzzyOverlap(normalizedTerm, nodeKey)) {
    return { node, score: 42, matchType: "key-fuzzy-overlap" };
  }

  const aliasFuzzyOverlap = aliases.find((alias) => hasFullTokenFuzzyOverlap(normalizedTerm, alias));

  if (aliasFuzzyOverlap) {
    return { node, score: 35, matchType: "alias-fuzzy-overlap" };
  }

  return undefined;
}

function getNodeContextId(node: CinderGraphNode): string | undefined {
  return node.type === "context" ? node.id : node.contextId;
}

function getNodeRouteId(node: CinderGraphNode): string | undefined {
  return node.type === "route" ? node.id : node.routeId;
}

function getNodeGraphTemperature(node: CinderGraphNode): "hot" | "cold" {
  return node.metadata?.graphTemperature === "cold" ? "cold" : "hot";
}

function getNodeGraphSources(node: CinderGraphNode): CinderGraphLayerSource[] {
  const value = node.metadata?.graphSources;

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (source): source is CinderGraphLayerSource =>
      source === "scan" || source === "route_registry" || source === "cold_catalog",
  );
}

function matchesGraphPreference(node: CinderGraphNode, options?: CinderGraphQueryOptions): boolean {
  const temperature = getNodeGraphTemperature(node);
  const preference = options?.graphPreference ?? "hot-first";

  if (preference === "hot-only") {
    return temperature === "hot";
  }

  if (preference === "cold-only") {
    return temperature === "cold";
  }

  return true;
}

function matchesRequiredGraphSources(node: CinderGraphNode, options?: CinderGraphQueryOptions): boolean {
  if (!options?.requiredGraphSources?.length) {
    return true;
  }

  const sources = getNodeGraphSources(node);
  return options.requiredGraphSources.every((source) => sources.includes(source));
}

function upsertCandidate(
  map: Map<string, CinderGraphQueryCandidate>,
  candidate: CinderGraphQueryCandidate | undefined,
): void {
  if (!candidate) {
    return;
  }

  const existing = map.get(candidate.node.id);
  if (!existing || candidate.score > existing.score) {
    map.set(candidate.node.id, candidate);
  }
}

function filterNodesByTypes(
  nodes: CinderGraphNode[],
  types: CinderGraphNodeType[],
): CinderGraphNode[] {
  const typeSet = new Set(types);
  return nodes.filter((node) => typeSet.has(node.type));
}

function createSnapshotQueryCache(snapshot: CinderGraphSnapshot): SnapshotQueryCache {
  const nodeById = new Map<string, CinderGraphNode>();
  const childrenByParentId = new Map<string, CinderGraphNode[]>();
  const normalizedKeyIndex = new Map<string, CinderGraphNode[]>();
  const normalizedAliasIndex = new Map<string, CinderGraphNode[]>();

  for (const node of snapshot.nodes) {
    nodeById.set(node.id, node);

    if (node.parentId) {
      const children = childrenByParentId.get(node.parentId) ?? [];
      children.push(node);
      childrenByParentId.set(node.parentId, children);
    }

    const normalizedKey = normalizeTerm(node.key);
    const existingKeyEntries = normalizedKeyIndex.get(normalizedKey) ?? [];
    existingKeyEntries.push(node);
    normalizedKeyIndex.set(normalizedKey, existingKeyEntries);

    for (const alias of node.aliases ?? []) {
      const normalizedAlias = normalizeTerm(alias);
      if (!normalizedAlias) {
        continue;
      }

      const existingAliasEntries = normalizedAliasIndex.get(normalizedAlias) ?? [];
      existingAliasEntries.push(node);
      normalizedAliasIndex.set(normalizedAlias, existingAliasEntries);
    }
  }

  const nodesByType = new Map<CinderGraphNodeType, CinderGraphNode[]>();
  for (const type of Object.keys(snapshot.indexes.byType) as CinderGraphNodeType[]) {
    const ids = snapshot.indexes.byType[type] ?? [];
    nodesByType.set(type, uniqueNodes(ids.map((id) => nodeById.get(id))));
  }

  return {
    nodeById,
    nodesByType,
    childrenByParentId,
    normalizedKeyIndex,
    normalizedAliasIndex,
    ancestorIdsByNodeId: new Map<string, Set<string>>(),
    exactCandidateCache: new Map<string, CinderGraphQueryCandidate[]>(),
    globalFuzzyCandidateCache: new Map<string, CinderGraphQueryCandidate[]>(),
  };
}

function getNodesForTypes(
  cache: SnapshotQueryCache,
  types: CinderGraphNodeType[],
): CinderGraphNode[] {
  return uniqueNodes(
    normalizeTypes(types).flatMap((type) => cache.nodesByType.get(type) ?? []),
  );
}

function getNodesFromIndex(
  snapshot: CinderGraphSnapshot,
  cache: SnapshotQueryCache,
  index: "byContext" | "byRoute",
  id: string,
): CinderGraphNode[] {
  const ids = snapshot.indexes[index][id] ?? [];
  return uniqueNodes(ids.map((nodeId) => cache.nodeById.get(nodeId)));
}

function getAncestorIds(
  cache: SnapshotQueryCache,
  node: CinderGraphNode,
): Set<string> {
  const cached = cache.ancestorIdsByNodeId.get(node.id);
  if (cached) {
    return cached;
  }

  const ancestorIds = new Set<string>();
  let currentParentId = node.parentId;

  while (currentParentId) {
    ancestorIds.add(currentParentId);
    currentParentId = cache.nodeById.get(currentParentId)?.parentId;
  }

  cache.ancestorIdsByNodeId.set(node.id, ancestorIds);
  return ancestorIds;
}

function applyContextAndRoutePreference(
  snapshot: CinderGraphSnapshot,
  candidate: CinderGraphQueryCandidate,
): CinderGraphQueryCandidate {
  let score = candidate.score;
  const nodeContextId = getNodeContextId(candidate.node);
  const nodeRouteId = getNodeRouteId(candidate.node);

  if (snapshot.runtime.activeContextId && nodeContextId === snapshot.runtime.activeContextId) {
    score += 20;
  }

  if (snapshot.runtime.activeRouteId && nodeRouteId === snapshot.runtime.activeRouteId) {
    score += 10;
  }

  return {
    ...candidate,
    score,
  };
}

function applyGraphPreferences(
  snapshot: CinderGraphSnapshot,
  cache: SnapshotQueryCache,
  candidate: CinderGraphQueryCandidate,
  options?: CinderGraphQueryOptions,
): CinderGraphQueryCandidate {
  if (!options) {
    return candidate;
  }

  let score = candidate.score;
  const nodeContextId = getNodeContextId(candidate.node);
  const nodeRouteId = getNodeRouteId(candidate.node);

  if (nodeContextId && options.preferredContextIds?.includes(nodeContextId)) {
    score += 35;
  }

  if (nodeRouteId && options.preferredRouteIds?.includes(nodeRouteId)) {
    score += 18;
  }

  const anchorNodes = uniqueNodes((options.anchorNodeIds ?? []).map((id) => cache.nodeById.get(id)));

  for (const anchorNode of anchorNodes) {
    if (anchorNode.id === candidate.node.id) {
      score += 120;
      continue;
    }

    const anchorContextId = getNodeContextId(anchorNode);
    const anchorRouteId = getNodeRouteId(anchorNode);

    if (anchorContextId && nodeContextId && anchorContextId === nodeContextId) {
      score += 32;
    }

    if (anchorRouteId && nodeRouteId && anchorRouteId === nodeRouteId) {
      score += 12;
    }

    if (candidate.node.parentId && candidate.node.parentId === anchorNode.id) {
      score += 24;
    }

    if (anchorNode.parentId && anchorNode.parentId === candidate.node.id) {
      score += 24;
    }

    if (candidate.node.parentId && anchorNode.parentId && candidate.node.parentId === anchorNode.parentId) {
      score += 10;
    }

    const candidateAncestors = getAncestorIds(cache, candidate.node);
    const anchorAncestors = getAncestorIds(cache, anchorNode);

    if (candidateAncestors.has(anchorNode.id) || anchorAncestors.has(candidate.node.id)) {
      score += 8;
    }
  }

  return {
    ...candidate,
    score,
  };
}

function applyGraphLayerPreference(
  candidate: CinderGraphQueryCandidate,
  options?: CinderGraphQueryOptions,
): CinderGraphQueryCandidate {
  let score = candidate.score;
  const temperature = getNodeGraphTemperature(candidate.node);
  const sources = getNodeGraphSources(candidate.node);
  const preference = options?.graphPreference ?? "hot-first";

  if (preference === "hot-first" && temperature === "hot") {
    score += 14;
  }

  if (preference === "cold-first" && temperature === "cold") {
    score += 14;
  }

  if (options?.requiredGraphSources?.length) {
    for (const source of options.requiredGraphSources) {
      if (sources.includes(source)) {
        score += 4;
      }
    }
  }

  return {
    ...candidate,
    score,
  };
}

function filterCandidatesByOptions(
  candidates: CinderGraphQueryCandidate[],
  options?: CinderGraphQueryOptions,
): CinderGraphQueryCandidate[] {
  return candidates.filter((candidate) => {
    return matchesGraphPreference(candidate.node, options) && matchesRequiredGraphSources(candidate.node, options);
  });
}

function rankCandidates(
  snapshot: CinderGraphSnapshot,
  cache: SnapshotQueryCache,
  candidates: CinderGraphQueryCandidate[],
  options?: CinderGraphQueryOptions,
): CinderGraphQueryCandidate[] {
  return filterCandidatesByOptions(candidates, options)
    .map((candidate) => applyContextAndRoutePreference(snapshot, candidate))
    .map((candidate) => applyGraphPreferences(snapshot, cache, candidate, options))
    .map((candidate) => applyGraphLayerPreference(candidate, options))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (getNodeGraphTemperature(left.node) !== getNodeGraphTemperature(right.node)) {
        return getNodeGraphTemperature(left.node) === "hot" ? -1 : 1;
      }

      return left.node.id.localeCompare(right.node.id);
    });
}

function getExactCandidates(
  cache: SnapshotQueryCache,
  term: string,
  types: CinderGraphNodeType[],
): CinderGraphQueryCandidate[] {
  const queryKey = makeQueryKey(term, types);
  const cached = cache.exactCandidateCache.get(queryKey);
  if (cached) {
    return cached;
  }

  const typeSet = new Set(types);
  const normalized = normalizeTerm(term);
  const candidates = new Map<string, CinderGraphQueryCandidate>();

  for (const node of cache.normalizedKeyIndex.get(normalized) ?? []) {
    if (!typeSet.has(node.type)) {
      continue;
    }

    upsertCandidate(candidates, {
      node,
      score: 100,
      matchType: "key-exact",
    });
  }

  for (const node of cache.normalizedAliasIndex.get(normalized) ?? []) {
    if (!typeSet.has(node.type)) {
      continue;
    }

    upsertCandidate(candidates, {
      node,
      score: 90,
      matchType: "alias-exact",
    });
  }

  const result = [...candidates.values()];
  cache.exactCandidateCache.set(queryKey, result);
  return result;
}

function getGlobalFuzzyCandidates(
  cache: SnapshotQueryCache,
  term: string,
  types: CinderGraphNodeType[],
): CinderGraphQueryCandidate[] {
  const queryKey = makeQueryKey(term, types);
  const cached = cache.globalFuzzyCandidateCache.get(queryKey);
  if (cached) {
    return cached;
  }

  const candidates = getNodesForTypes(cache, types)
    .map((node) => scoreNodeMatch(node, term))
    .filter((candidate): candidate is CinderGraphQueryCandidate => Boolean(candidate));

  cache.globalFuzzyCandidateCache.set(queryKey, candidates);
  return candidates;
}

function collectNeighborhoodNodes(
  snapshot: CinderGraphSnapshot,
  cache: SnapshotQueryCache,
  node: CinderGraphNode | undefined,
): CinderGraphNode[] {
  if (!node) {
    return [];
  }

  const related = new Map<string, CinderGraphNode>();
  const addNode = (candidate: CinderGraphNode | undefined): void => {
    if (candidate) {
      related.set(candidate.id, candidate);
    }
  };

  addNode(node);
  addNode(node.parentId ? cache.nodeById.get(node.parentId) : undefined);

  for (const child of cache.childrenByParentId.get(node.id) ?? []) {
    addNode(child);
  }

  for (const sibling of node.parentId ? cache.childrenByParentId.get(node.parentId) ?? [] : []) {
    addNode(sibling);
  }

  const contextId = getNodeContextId(node);
  for (const candidate of contextId ? getNodesFromIndex(snapshot, cache, "byContext", contextId) : []) {
    addNode(candidate);
  }

  const routeId = getNodeRouteId(node);
  for (const candidate of routeId ? getNodesFromIndex(snapshot, cache, "byRoute", routeId) : []) {
    addNode(candidate);
  }

  for (const ancestorId of getAncestorIds(cache, node)) {
    addNode(cache.nodeById.get(ancestorId));
  }

  return [...related.values()];
}

function getActiveCandidatePool(
  snapshot: CinderGraphSnapshot,
  cache: SnapshotQueryCache,
  types: CinderGraphNodeType[],
  options?: CinderGraphQueryOptions,
): CinderGraphNode[] {
  const anchors = uniqueStrings([
    ...(options?.anchorNodeIds ?? []),
    snapshot.runtime.focusedNodeId,
  ]);

  const pool = new Map<string, CinderGraphNode>();
  const addNodes = (nodes: CinderGraphNode[]): void => {
    for (const node of nodes) {
      pool.set(node.id, node);
    }
  };

  if (snapshot.runtime.activeContextId) {
    addNodes(getNodesFromIndex(snapshot, cache, "byContext", snapshot.runtime.activeContextId));
  }

  if (snapshot.runtime.activeRouteId) {
    addNodes(getNodesFromIndex(snapshot, cache, "byRoute", snapshot.runtime.activeRouteId));
  }

  addNodes(getNodesFromIndex(snapshot, cache, "byContext", ROOT_INDEX_KEY));
  addNodes(getNodesFromIndex(snapshot, cache, "byRoute", ROOT_INDEX_KEY));

  for (const anchorId of anchors) {
    addNodes(collectNeighborhoodNodes(snapshot, cache, cache.nodeById.get(anchorId)));
  }

  return filterNodesByTypes([...pool.values()], types);
}

function getContextPreferredIds(snapshot: CinderGraphSnapshot): string[] {
  return [snapshot.runtime.activeContextId, ROOT_INDEX_KEY].filter(
    (value): value is string => Boolean(value),
  );
}

function getRoutePreferredIds(snapshot: CinderGraphSnapshot): string[] {
  return [snapshot.runtime.activeRouteId, ROOT_INDEX_KEY].filter(
    (value): value is string => Boolean(value),
  );
}

export interface CinderGraphQueryEngine {
  kind: "CGE";
  getNodeById(snapshot: CinderGraphSnapshot, id: string): CinderGraphNode | undefined;
  getNodesByType(snapshot: CinderGraphSnapshot, type: CinderGraphNodeType): CinderGraphNode[];
  getNodesInContext(snapshot: CinderGraphSnapshot, contextId?: string): CinderGraphNode[];
  getNodesInRoute(snapshot: CinderGraphSnapshot, routeId?: string): CinderGraphNode[];
  findBestCandidate(
    snapshot: CinderGraphSnapshot,
    term: string,
    types: CinderGraphNodeType[],
  ): CinderGraphQueryCandidate | undefined;
  findCandidates(
    snapshot: CinderGraphSnapshot,
    term: string,
    types: CinderGraphNodeType[],
  ): CinderGraphQueryCandidate[];
  findCandidatesWithOptions(
    snapshot: CinderGraphSnapshot,
    term: string,
    types: CinderGraphNodeType[],
    options?: CinderGraphQueryOptions,
  ): CinderGraphQueryCandidate[];
  getDiagnostics(snapshot?: CinderGraphSnapshot): CinderGraphQueryDiagnostics;
}

export function createGraphQueryEngine(): CinderGraphQueryEngine {
  const cacheBySnapshot = new WeakMap<CinderGraphSnapshot, SnapshotQueryCache>();
  const diagnostics = {
    snapshotCacheBuilds: 0,
    exactCacheHits: 0,
    globalFuzzyCacheHits: 0,
    globalFuzzyScans: 0,
    activePoolQueries: 0,
    lastQuery: undefined as CinderGraphQueryDiagnostics["lastQuery"],
  };

  const getCache = (snapshot: CinderGraphSnapshot): SnapshotQueryCache => {
    const cached = cacheBySnapshot.get(snapshot);
    if (cached) {
      return cached;
    }

    const nextCache = createSnapshotQueryCache(snapshot);
    cacheBySnapshot.set(snapshot, nextCache);
    diagnostics.snapshotCacheBuilds += 1;
    return nextCache;
  };

  return {
    kind: "CGE",

    getNodeById(snapshot, id) {
      return getCache(snapshot).nodeById.get(id);
    },

    getNodesByType(snapshot, type) {
      return getCache(snapshot).nodesByType.get(type) ?? [];
    },

    getNodesInContext(snapshot, contextId) {
      return getNodesFromIndex(snapshot, getCache(snapshot), "byContext", contextId ?? ROOT_INDEX_KEY);
    },

    getNodesInRoute(snapshot, routeId) {
      return getNodesFromIndex(snapshot, getCache(snapshot), "byRoute", routeId ?? ROOT_INDEX_KEY);
    },

    findCandidatesWithOptions(snapshot, term, types, options) {
      const normalized = normalizeTerm(term);
      const normalizedTypes = normalizeTypes(types);
      const cache = getCache(snapshot);
      const effectiveOptions: CinderGraphQueryOptions = {
        ...options,
        anchorNodeIds: uniqueStrings([
          ...(options?.anchorNodeIds ?? []),
          snapshot.runtime.focusedNodeId,
        ]),
      };
      const totalTypeNodeCount = getNodesForTypes(cache, normalizedTypes).length;

      if (!normalized || normalizedTypes.length === 0) {
        diagnostics.lastQuery = {
          term: normalized,
          types: normalizedTypes,
          mode: "empty",
          candidatePoolSize: 0,
          totalTypeNodeCount,
        };
        return [];
      }

      const exactQueryKey = makeQueryKey(normalized, normalizedTypes);
      if (cache.exactCandidateCache.has(exactQueryKey)) {
        diagnostics.exactCacheHits += 1;
      }
      const exactCandidates = getExactCandidates(cache, normalized, normalizedTypes);
      const rankedExactCandidates = rankCandidates(snapshot, cache, exactCandidates, effectiveOptions);
      if (rankedExactCandidates.length > 0) {
        diagnostics.lastQuery = {
          term: normalized,
          types: normalizedTypes,
          mode: "exact",
          candidatePoolSize: rankedExactCandidates.length,
          totalTypeNodeCount,
        };
        return rankedExactCandidates;
      }

      const activePool = getActiveCandidatePool(snapshot, cache, normalizedTypes, effectiveOptions);
      diagnostics.activePoolQueries += 1;
      const activeCandidates = activePool
        .map((node) => scoreNodeMatch(node, normalized))
        .filter((candidate): candidate is CinderGraphQueryCandidate => Boolean(candidate));
      const rankedActiveCandidates = rankCandidates(snapshot, cache, activeCandidates, effectiveOptions);

      if (rankedActiveCandidates.length > 0) {
        diagnostics.lastQuery = {
          term: normalized,
          types: normalizedTypes,
          mode: "active",
          candidatePoolSize: rankedActiveCandidates.length,
          totalTypeNodeCount,
        };
        return rankedActiveCandidates;
      }

      const globalQueryKey = makeQueryKey(normalized, normalizedTypes);
      if (cache.globalFuzzyCandidateCache.has(globalQueryKey)) {
        diagnostics.globalFuzzyCacheHits += 1;
      } else {
        diagnostics.globalFuzzyScans += 1;
      }
      const globalCandidates = getGlobalFuzzyCandidates(cache, normalized, normalizedTypes);
      const rankedGlobalCandidates = rankCandidates(snapshot, cache, globalCandidates, effectiveOptions);
      diagnostics.lastQuery = {
        term: normalized,
        types: normalizedTypes,
        mode: "global",
        candidatePoolSize: rankedGlobalCandidates.length,
        totalTypeNodeCount,
      };
      return rankedGlobalCandidates;
    },

    findCandidates(snapshot, term, types) {
      return this.findCandidatesWithOptions(snapshot, term, types);
    },

    findBestCandidate(snapshot, term, types) {
      return this.findCandidates(snapshot, term, types)[0];
    },

    getDiagnostics(snapshot) {
      const base: CinderGraphQueryDiagnostics = {
        snapshotCacheBuilds: diagnostics.snapshotCacheBuilds,
        exactCacheHits: diagnostics.exactCacheHits,
        globalFuzzyCacheHits: diagnostics.globalFuzzyCacheHits,
        globalFuzzyScans: diagnostics.globalFuzzyScans,
        activePoolQueries: diagnostics.activePoolQueries,
        lastQuery: diagnostics.lastQuery,
      };

      if (!snapshot) {
        return base;
      }

      const cache = getCache(snapshot);
      return {
        ...base,
        snapshot: {
          nodeCount: snapshot.nodes.length,
          indexedKeyCount: cache.normalizedKeyIndex.size,
          indexedAliasCount: cache.normalizedAliasIndex.size,
          exactCacheEntryCount: cache.exactCandidateCache.size,
          globalFuzzyCacheEntryCount: cache.globalFuzzyCandidateCache.size,
        },
      };
    },
  };
}

export function getActiveContextNodes(
  engine: CinderGraphQueryEngine,
  snapshot: CinderGraphSnapshot,
): CinderGraphNode[] {
  const preferred = getContextPreferredIds(snapshot);

  return uniqueNodes(
    preferred.flatMap((contextId) => engine.getNodesInContext(snapshot, contextId)),
  );
}

export function getActiveRouteNodes(
  engine: CinderGraphQueryEngine,
  snapshot: CinderGraphSnapshot,
): CinderGraphNode[] {
  const preferred = getRoutePreferredIds(snapshot);

  return uniqueNodes(
    preferred.flatMap((routeId) => engine.getNodesInRoute(snapshot, routeId)),
  );
}
