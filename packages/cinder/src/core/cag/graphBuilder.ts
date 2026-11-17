import type {
  CinderGraphEdge,
  CinderGraphNode,
  CinderGraphNodeType,
  CinderGraphSnapshot,
  CinderSemanticNodeSource,
  CinderSemanticScanEntry,
  CinderSemanticScanResult,
} from "../../types.js";

const APP_ROOT_ID = "app:root";
const APP_ROOT_KEY = "app";
const ROOT_INDEX_KEY = "__root__";
const SCOPE_SEPARATOR = "/";

interface ResolvedNodeIds {
  parentId: string;
  routeId?: string;
  contextId?: string;
  nodeScopeKey: string;
  routeScopeKey?: string;
  contextScopeKey?: string;
}

function createEmptyIndexes(): CinderGraphSnapshot["indexes"] {
  return {
    byType: {
      app: [],
      route: [],
      context: [],
      entity: [],
      field: [],
      filter: [],
      action: [],
      output: [],
      data: [],
    },
    byKey: {},
    byContext: {},
    byRoute: {},
  };
}

export function createEmptyGraphSnapshot(): CinderGraphSnapshot {
  return {
    version: "v1",
    nodes: [],
    edges: [],
    indexes: createEmptyIndexes(),
    runtime: {},
    meta: {},
  };
}

function makeScopeKey(...parts: Array<string | undefined>): string {
  const normalizedParts = parts
    .flatMap((part) => part?.split(SCOPE_SEPARATOR) ?? [])
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return normalizedParts.length > 0 ? normalizedParts.join(SCOPE_SEPARATOR) : ROOT_INDEX_KEY;
}

function makeNodeId(
  type: CinderGraphNodeType,
  key: string,
  scopeKey = ROOT_INDEX_KEY,
): string {
  return `${type}:${scopeKey}:${key}`;
}

function makeEdgeId(type: CinderGraphEdge["type"], from: string, to: string): string {
  return `${type}:${from}->${to}`;
}

function pushIndex(map: Record<string, string[]>, key: string, id: string): void {
  if (!map[key]) {
    map[key] = [];
  }

  map[key]!.push(id);
}

function indexNode(snapshot: CinderGraphSnapshot, node: CinderGraphNode): void {
  snapshot.indexes.byType[node.type].push(node.id);
  pushIndex(snapshot.indexes.byKey, node.key, node.id);
  pushIndex(snapshot.indexes.byContext, node.contextId ?? ROOT_INDEX_KEY, node.id);
  pushIndex(snapshot.indexes.byRoute, node.routeId ?? ROOT_INDEX_KEY, node.id);
}

function makeSourceKey(source: CinderSemanticNodeSource): string {
  return [source.tagName, source.elementId ?? "", source.selectorHint ?? ""].join("::");
}

function mergeSemanticSources(
  ...values: Array<CinderSemanticNodeSource | CinderSemanticNodeSource[] | undefined>
): CinderSemanticNodeSource[] {
  const seen = new Set<string>();
  const result: CinderSemanticNodeSource[] = [];

  for (const value of values) {
    for (const source of Array.isArray(value) ? value : value ? [value] : []) {
      const key = makeSourceKey(source);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      result.push(source);
    }
  }

  return result;
}

function mergeDefinedMetadata(
  existing?: Record<string, unknown>,
  candidate?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const merged = { ...(existing ?? {}) };

  for (const [key, value] of Object.entries(candidate ?? {})) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value) && Array.isArray(merged[key])) {
      merged[key] = [...new Set([...(merged[key] as unknown[]), ...value])];
      continue;
    }

    if (merged[key] === undefined) {
      merged[key] = value;
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function mergeAliases(...values: Array<string[] | undefined>): string[] | undefined {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    for (const alias of value ?? []) {
      const normalized = alias.trim().toLowerCase();
      if (!normalized || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      result.push(alias);
    }
  }

  return result.length > 0 ? result : undefined;
}

function mergeRouteNode(existing: CinderGraphNode, candidate: CinderGraphNode): CinderGraphNode {
  const mergedSources = mergeSemanticSources(
    existing.source,
    existing.sources,
    candidate.source,
    candidate.sources,
  );

  existing.label = existing.label ?? candidate.label;
  existing.aliases = mergeAliases([existing.key], existing.aliases, candidate.aliases);
  existing.source = mergedSources[0] ?? existing.source ?? candidate.source;
  existing.sources = mergedSources.length > 1 ? mergedSources : undefined;
  existing.metadata = mergeDefinedMetadata(existing.metadata, candidate.metadata);

  if (existing.metadata) {
    existing.metadata.routeReferenceCount = mergedSources.length;
  }

  return existing;
}

function addNode(snapshot: CinderGraphSnapshot, node: CinderGraphNode): { node: CinderGraphNode; added: boolean } {
  const existing = snapshot.nodes.find((candidate) => candidate.id === node.id);

  if (existing) {
    if (existing.type === "route" && node.type === "route") {
      const merged = mergeRouteNode(existing, node);
      indexNode(snapshot, merged);
      return { node: merged, added: false };
    }

    throw new Error(`Duplicate graph node id detected: ${node.id}`);
  }

  snapshot.nodes.push(node);
  indexNode(snapshot, node);
  return { node, added: true };
}

function addEdge(snapshot: CinderGraphSnapshot, edge: CinderGraphEdge): void {
  if (snapshot.edges.some((existing) => existing.id === edge.id)) {
    return;
  }

  snapshot.edges.push(edge);
}

/**
 * Resolves `data-cinder-affects` metadata (captured by tagScanner as
 * metadata.affects) into real "filters" edges from a field/filter/action node to
 * the output node(s) it influences. Must run after every node has been added,
 * since a field/filter is processed before the output it points at (see
 * buildEntriesInOrder's type priority).
 *
 * This is deliberately author-declared rather than inferred from proximity:
 * guessing "the nearest output in the same context is probably affected" would
 * silently produce wrong edges on any page where that heuristic doesn't hold.
 * An explicit attribute is a small authoring cost for a graph relationship
 * that's actually trustworthy.
 */
function resolveDeclaredEdgeTargets(
  snapshot: CinderGraphSnapshot,
  fromNode: CinderGraphNode,
  targetKeys: unknown,
  targetTypeFilter?: CinderGraphNode["type"],
): CinderGraphNode[] {
  if (!Array.isArray(targetKeys) || targetKeys.length === 0) {
    return [];
  }

  const resolved: CinderGraphNode[] = [];

  for (const targetKey of targetKeys) {
    if (typeof targetKey !== "string" || !targetKey) {
      continue;
    }

    const candidateIds = snapshot.indexes.byKey[targetKey] ?? [];
    const targetNode = candidateIds
      .map((id) => snapshot.nodes.find((candidate) => candidate.id === id))
      .find(
        (candidate): candidate is CinderGraphNode =>
          Boolean(candidate) &&
          candidate!.id !== fromNode.id &&
          (!targetTypeFilter || candidate!.type === targetTypeFilter) &&
          (!fromNode.contextId || candidate!.contextId === fromNode.contextId),
      );

    if (targetNode) {
      resolved.push(targetNode);
    }
  }

  return resolved;
}

/**
 * Resolves `data-cinder-affects` metadata (captured by tagScanner as
 * metadata.affects) into real "filters" edges from a field/filter/action node to
 * the output node(s) it influences. Must run after every node has been added,
 * since a field/filter is processed before the output it points at (see
 * buildEntriesInOrder's type priority).
 *
 * This is deliberately author-declared rather than inferred from proximity:
 * guessing "the nearest output in the same context is probably affected" would
 * silently produce wrong edges on any page where that heuristic doesn't hold.
 * An explicit attribute is a small authoring cost for a graph relationship
 * that's actually trustworthy.
 */
function addAffectsEdges(snapshot: CinderGraphSnapshot): void {
  for (const node of snapshot.nodes) {
    const targets = resolveDeclaredEdgeTargets(snapshot, node, node.metadata?.affects, "output");

    for (const targetNode of targets) {
      addEdge(snapshot, {
        id: makeEdgeId("filters", node.id, targetNode.id),
        type: "filters",
        from: node.id,
        to: targetNode.id,
      });
    }
  }
}

/**
 * Resolves `data-cinder-depends-on` metadata (captured by tagScanner as
 * metadata.dependsOn) into real "depends_on" edges from a node (typically an
 * action) to the field/filter node(s) it requires to be set first. Same
 * author-declared-only design as addAffectsEdges, for the same reason: an
 * ordering dependency inferred from DOM position or type would be guesswork,
 * and a wrong guess here is worse than no edge at all.
 *
 * Used by the dispatcher (see checkDependencyOrder) to WARN - not block - when
 * a composite command executes steps out of declared order.
 */
function addDependsOnEdges(snapshot: CinderGraphSnapshot): void {
  for (const node of snapshot.nodes) {
    const targets = resolveDeclaredEdgeTargets(snapshot, node, node.metadata?.dependsOn);

    for (const targetNode of targets) {
      addEdge(snapshot, {
        id: makeEdgeId("depends_on", node.id, targetNode.id),
        type: "depends_on",
        from: node.id,
        to: targetNode.id,
      });
    }
  }
}

/**
 * Resolves `data-cinder-navigates-to` metadata (captured by tagScanner as
 * metadata.navigatesTo) into a real "navigates_to" edge from an action node to
 * the route it leads to - e.g. a "View details" action that opens a detail
 * page. Deliberately its own resolver rather than reusing
 * resolveDeclaredEdgeTargets: that helper requires the target to share the
 * FROM node's contextId, which is right for affects/dependsOn (same-context
 * effects) but wrong here - navigating by definition leaves the current
 * context, and a route node typically has no contextId of its own at all, so
 * the same-context check would never match. Singular (one target), unlike
 * affects/dependsOn's lists, since one action leads to one place.
 *
 * Same author-declared-only design as addAffectsEdges/addDependsOnEdges: a
 * guess at "this action probably navigates somewhere" from DOM position or
 * naming would be exactly the kind of untrustworthy inference this codebase
 * has already decided against (docs/known-limitations.md #2).
 */
function resolveDeclaredRouteTarget(
  snapshot: CinderGraphSnapshot,
  routeKey: unknown,
): CinderGraphNode | undefined {
  if (typeof routeKey !== "string" || !routeKey) {
    return undefined;
  }

  const candidateIds = snapshot.indexes.byKey[routeKey] ?? [];

  return candidateIds
    .map((id) => snapshot.nodes.find((candidate) => candidate.id === id))
    .find((candidate): candidate is CinderGraphNode => Boolean(candidate) && candidate!.type === "route");
}

function addNavigatesToEdges(snapshot: CinderGraphSnapshot): void {
  for (const node of snapshot.nodes) {
    if (node.type !== "action") {
      continue;
    }

    const targetNode = resolveDeclaredRouteTarget(snapshot, node.metadata?.navigatesTo);

    if (targetNode) {
      addEdge(snapshot, {
        id: makeEdgeId("navigates_to", node.id, targetNode.id),
        type: "navigates_to",
        from: node.id,
        to: targetNode.id,
      });
    }
  }
}

/**
 * All output nodes a given field/filter/action node declares (via
 * data-cinder-affects) that it influences, resolved from real graph edges -
 * not a re-derivation of the metadata, so it reflects what actually resolved.
 */
export function getOutputsAffectedBy(
  snapshot: CinderGraphSnapshot,
  nodeId: string,
): CinderGraphNode[] {
  return snapshot.edges
    .filter((edge) => edge.type === "filters" && edge.from === nodeId)
    .map((edge) => snapshot.nodes.find((node) => node.id === edge.to))
    .filter((node): node is CinderGraphNode => Boolean(node));
}

/**
 * All field/filter/action nodes that declare (via data-cinder-affects) that
 * they influence the given output node.
 */
export function getNodesAffecting(
  snapshot: CinderGraphSnapshot,
  outputNodeId: string,
): CinderGraphNode[] {
  return snapshot.edges
    .filter((edge) => edge.type === "filters" && edge.to === outputNodeId)
    .map((edge) => snapshot.nodes.find((node) => node.id === edge.from))
    .filter((node): node is CinderGraphNode => Boolean(node));
}

/**
 * All nodes a given node declares (via data-cinder-depends-on) that it
 * requires to be set/triggered first.
 */
export function getDependenciesOf(
  snapshot: CinderGraphSnapshot,
  nodeId: string,
): CinderGraphNode[] {
  return snapshot.edges
    .filter((edge) => edge.type === "depends_on" && edge.from === nodeId)
    .map((edge) => snapshot.nodes.find((node) => node.id === edge.to))
    .filter((node): node is CinderGraphNode => Boolean(node));
}

/**
 * All nodes that declare a dependency (via data-cinder-depends-on) on the
 * given node.
 */
export function getDependents(
  snapshot: CinderGraphSnapshot,
  nodeId: string,
): CinderGraphNode[] {
  return snapshot.edges
    .filter((edge) => edge.type === "depends_on" && edge.to === nodeId)
    .map((edge) => snapshot.nodes.find((node) => node.id === edge.from))
    .filter((node): node is CinderGraphNode => Boolean(node));
}

/**
 * The route a given action node navigates to (via data-cinder-navigates-to), if declared -
 * undefined for every action that doesn't lead anywhere, which is most of them (a "Save"
 * action has no navigation target at all, and that's the normal case, not a gap).
 */
export function getNavigationTargetOf(
  snapshot: CinderGraphSnapshot,
  actionNodeId: string,
): CinderGraphNode | undefined {
  const edge = snapshot.edges.find((candidate) => candidate.type === "navigates_to" && candidate.from === actionNodeId);
  return edge ? snapshot.nodes.find((node) => node.id === edge.to) : undefined;
}

function createAppRootNode(): CinderGraphNode {
  return {
    id: APP_ROOT_ID,
    type: "app",
    key: APP_ROOT_KEY,
    label: "Application Root",
    aliases: [APP_ROOT_KEY],
    metadata: {
      system: true,
    },
  };
}

function getMetadataStringArray(entry: CinderSemanticScanEntry, key: string): string[] {
  const value = entry.record.metadata?.[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function getRouteScopeKey(entry: CinderSemanticScanEntry): string | undefined {
  if (entry.record.type === "route") {
    return makeScopeKey(entry.record.key);
  }

  if (entry.record.routeKey) {
    return makeScopeKey(entry.record.routeKey);
  }

  return undefined;
}

function getParentContextPath(entry: CinderSemanticScanEntry): string[] {
  return getMetadataStringArray(entry, "contextPath");
}

function getParentContextScopeKey(entry: CinderSemanticScanEntry): string | undefined {
  const contextPath = getParentContextPath(entry);

  if (contextPath.length === 0) {
    return undefined;
  }

  return makeScopeKey(entry.record.routeKey, ...contextPath);
}

function getContextScopeKey(entry: CinderSemanticScanEntry): string | undefined {
  if (entry.record.type !== "context") {
    return undefined;
  }

  return makeScopeKey(entry.record.routeKey, ...getParentContextPath(entry), entry.record.key);
}

function createNodeFromEntry(
  entry: CinderSemanticScanEntry,
  resolved: ResolvedNodeIds,
): CinderGraphNode {
  return {
    id: makeNodeId(entry.record.type, entry.record.key, resolved.nodeScopeKey),
    type: entry.record.type,
    key: entry.record.key,
    label: entry.record.label,
    aliases: entry.record.aliases,
    parentId: resolved.parentId,
    routeId: resolved.routeId,
    contextId: resolved.contextId,
    source: entry.source,
    metadata: entry.record.type === "route"
      ? {
          ...(entry.record.metadata ?? {}),
          routeReferenceCount: 1,
        }
      : entry.record.metadata,
  };
}

function ensureParentExists(snapshot: CinderGraphSnapshot, parentId?: string): string {
  if (!parentId) {
    return APP_ROOT_ID;
  }

  const exists = snapshot.nodes.some((node) => node.id === parentId);
  return exists ? parentId : APP_ROOT_ID;
}

function resolveParentId(
  snapshot: CinderGraphSnapshot,
  entry: CinderSemanticScanEntry,
  contextIdByScopeKey: Map<string, string>,
  routeIdByScopeKey: Map<string, string>,
): ResolvedNodeIds {
  const routeScopeKey = getRouteScopeKey(entry);
  const routeId = routeScopeKey
    ? routeIdByScopeKey.get(routeScopeKey)
    : undefined;
  const parentContextScopeKey = getParentContextScopeKey(entry);
  const parentContextId = parentContextScopeKey
    ? contextIdByScopeKey.get(parentContextScopeKey)
    : undefined;

  if (entry.record.type === "route") {
    return {
      parentId: APP_ROOT_ID,
      nodeScopeKey: ROOT_INDEX_KEY,
      routeScopeKey,
    };
  }

  if (entry.record.type === "context") {
    const contextScopeKey = getContextScopeKey(entry);

    if (parentContextId) {
      return {
        parentId: ensureParentExists(snapshot, parentContextId),
        routeId,
        contextId: parentContextId,
        nodeScopeKey: parentContextScopeKey ?? routeScopeKey ?? ROOT_INDEX_KEY,
        routeScopeKey,
        contextScopeKey,
      };
    }

    if (routeId) {
      return {
        parentId: ensureParentExists(snapshot, routeId),
        routeId,
        nodeScopeKey: routeScopeKey ?? ROOT_INDEX_KEY,
        routeScopeKey,
        contextScopeKey,
      };
    }

    return {
      parentId: APP_ROOT_ID,
      nodeScopeKey: ROOT_INDEX_KEY,
      contextScopeKey,
    };
  }

  if (parentContextId) {
    return {
      parentId: ensureParentExists(snapshot, parentContextId),
      routeId,
      contextId: parentContextId,
      nodeScopeKey: parentContextScopeKey ?? routeScopeKey ?? ROOT_INDEX_KEY,
      routeScopeKey,
      contextScopeKey: parentContextScopeKey,
    };
  }

  if (routeId) {
    return {
      parentId: ensureParentExists(snapshot, routeId),
      routeId,
      nodeScopeKey: routeScopeKey ?? ROOT_INDEX_KEY,
      routeScopeKey,
    };
  }

  return {
    parentId: APP_ROOT_ID,
    nodeScopeKey: ROOT_INDEX_KEY,
  };
}

function buildEntriesInOrder(entries: CinderSemanticScanEntry[]): CinderSemanticScanEntry[] {
  const priority: Record<CinderGraphNodeType, number> = {
    app: 0,
    route: 1,
    context: 2,
    entity: 3,
    field: 4,
    filter: 5,
    action: 6,
    output: 7,
    data: 8,
  };

  return [...entries].sort((left, right) => {
    return priority[left.record.type] - priority[right.record.type];
  });
}

export function buildGraphFromScanResult(
  scanResult: CinderSemanticScanResult,
): CinderGraphSnapshot {
  const snapshot = createEmptyGraphSnapshot();
  const routeIdByScopeKey = new Map<string, string>();
  const contextIdByScopeKey = new Map<string, string>();

  const appRoot = createAppRootNode();
  addNode(snapshot, appRoot);

  const orderedEntries = buildEntriesInOrder(scanResult.entries);

  for (const entry of orderedEntries) {
    const resolved = resolveParentId(snapshot, entry, contextIdByScopeKey, routeIdByScopeKey);

    const node = createNodeFromEntry(entry, resolved);
    const upserted = addNode(snapshot, node);

    addEdge(snapshot, {
      id: makeEdgeId("contains", resolved.parentId, upserted.node.id),
      type: "contains",
      from: resolved.parentId,
      to: upserted.node.id,
    });

    if (resolved.contextId && upserted.node.type !== "context") {
      addEdge(snapshot, {
        id: makeEdgeId("scoped_to", upserted.node.id, resolved.contextId),
        type: "scoped_to",
        from: upserted.node.id,
        to: resolved.contextId,
      });
    }

    if (upserted.node.type === "route" && resolved.routeScopeKey) {
      routeIdByScopeKey.set(resolved.routeScopeKey, upserted.node.id);
    }

    if (upserted.node.type === "context" && resolved.contextScopeKey) {
      contextIdByScopeKey.set(resolved.contextScopeKey, upserted.node.id);
    }
  }

  addAffectsEdges(snapshot);
  addDependsOnEdges(snapshot);
  addNavigatesToEdges(snapshot);

  snapshot.meta.scannedAt = scanResult.scannedAt;
  snapshot.meta.entryCount = scanResult.entries.length;
  snapshot.meta.warningCount = scanResult.warnings.length;

  return snapshot;
}

export function formatGraphDebugSummary(snapshot: CinderGraphSnapshot): string {
  return [
    `CAG ${snapshot.version}`,
    `nodes=${snapshot.nodes.length}`,
    `edges=${snapshot.edges.length}`,
    `routes=${snapshot.indexes.byType.route.length}`,
    `contexts=${snapshot.indexes.byType.context.length}`,
    `mode=${snapshot.meta.hybrid?.mode ?? "hot"}`,
    `hotNodes=${snapshot.meta.hotNodeCount ?? "n/a"}`,
    `coldNodes=${snapshot.meta.coldNodeCount ?? "n/a"}`,
    `activeRoute=${snapshot.runtime.activeRouteId ?? "none"}`,
    `activeContext=${snapshot.runtime.activeContextId ?? "none"}`,
  ].join(" | ");
}
