import type {
  CinderColdGraphCatalog,
  CinderColdGraphNodeDefinition,
  CinderColdGraphNodeRef,
  CinderGraphEdge,
  CinderGraphLayerSource,
  CinderGraphNode,
  CinderGraphNodeType,
  CinderGraphSnapshot,
  CinderHybridGraphDiagnostics,
  CinderRouteDefinition,
  CinderSemanticNodeSource,
} from "../../types.js";
import type { CinderInternalRouteReference } from "../semantic/referenceScanner.js";
import { normalizeOptionalSemanticKey, uniqueNormalizedValues } from "../semantic/normalize.js";

const ROOT_INDEX_KEY = "__root__";
const APP_ROOT_FALLBACK_ID = "app:root";
const SCOPE_SEPARATOR = "/";
const GRAPH_TEMPERATURE_KEY = "graphTemperature";
const GRAPH_SOURCES_KEY = "graphSources";
const CATALOG_IDS_KEY = "catalogIds";

type GraphTemperature = "hot" | "cold";

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

function uniqueGraphSources(values: Array<CinderGraphLayerSource | undefined>): CinderGraphLayerSource[] {
  const seen = new Set<CinderGraphLayerSource>();
  const result: CinderGraphLayerSource[] = [];

  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(value);
  }

  return result;
}

function getMetadataRecord(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {};
}

function getGraphSources(metadata: Record<string, unknown> | undefined): CinderGraphLayerSource[] {
  const value = metadata?.[GRAPH_SOURCES_KEY];

  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueGraphSources(
    value.filter(
      (item): item is CinderGraphLayerSource =>
        item === "scan" || item === "route_registry" || item === "cold_catalog",
    ),
  );
}

function getCatalogIds(metadata: Record<string, unknown> | undefined): string[] {
  const value = metadata?.[CATALOG_IDS_KEY];

  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueStrings(value.filter((item): item is string => typeof item === "string" && item.length > 0));
}

function getGraphTemperature(metadata: Record<string, unknown> | undefined): GraphTemperature | undefined {
  return metadata?.[GRAPH_TEMPERATURE_KEY] === "cold"
    ? "cold"
    : metadata?.[GRAPH_TEMPERATURE_KEY] === "hot"
      ? "hot"
      : undefined;
}

function mergeDefinedMetadata(
  preferred?: Record<string, unknown>,
  fallback?: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fallback ?? {})) {
    if (key === GRAPH_TEMPERATURE_KEY || key === GRAPH_SOURCES_KEY || key === CATALOG_IDS_KEY) {
      continue;
    }

    if (value !== undefined) {
      merged[key] = value;
    }
  }

  for (const [key, value] of Object.entries(preferred ?? {})) {
    if (key === GRAPH_TEMPERATURE_KEY || key === GRAPH_SOURCES_KEY || key === CATALOG_IDS_KEY) {
      continue;
    }

    if (value !== undefined) {
      merged[key] = value;
    }
  }

  return merged;
}

function applyGraphLayerMetadata(
  metadata: Record<string, unknown>,
  options: {
    preferredTemperature?: GraphTemperature;
    sources?: CinderGraphLayerSource[];
    catalogIds?: string[];
  },
): Record<string, unknown> {
  const sources = uniqueGraphSources([
    ...getGraphSources(metadata),
    ...(options.sources ?? []),
  ]);
  const catalogIds = uniqueStrings([
    ...getCatalogIds(metadata),
    ...(options.catalogIds ?? []),
  ]);
  const graphTemperature =
    options.preferredTemperature ??
    (sources.includes("scan") ? "hot" : getGraphTemperature(metadata) ?? "cold");

  return {
    ...metadata,
    [GRAPH_TEMPERATURE_KEY]: graphTemperature,
    [GRAPH_SOURCES_KEY]: sources,
    ...(catalogIds.length > 0 ? { [CATALOG_IDS_KEY]: catalogIds } : {}),
  };
}

function getAppRootId(snapshot: CinderGraphSnapshot): string {
  return snapshot.nodes.find((node) => node.type === "app")?.id ?? APP_ROOT_FALLBACK_ID;
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

function makeSyntheticRouteNodeId(key: string): string {
  return makeNodeId("route", key, ROOT_INDEX_KEY);
}

function makeEdgeId(type: CinderGraphEdge["type"], from: string, to: string): string {
  return `${type}:${from}->${to}`;
}

function pushIndex(map: Record<string, string[]>, key: string, id: string): void {
  if (!map[key]) {
    map[key] = [];
  }

  if (!map[key]!.includes(id)) {
    map[key]!.push(id);
  }
}

function indexNode(snapshot: CinderGraphSnapshot, node: CinderGraphNode): void {
  if (!snapshot.indexes.byType[node.type].includes(node.id)) {
    snapshot.indexes.byType[node.type].push(node.id);
  }

  pushIndex(snapshot.indexes.byKey, node.key, node.id);
  pushIndex(snapshot.indexes.byContext, node.contextId ?? ROOT_INDEX_KEY, node.id);
  pushIndex(snapshot.indexes.byRoute, node.routeId ?? ROOT_INDEX_KEY, node.id);
}

function mergeNodeMetadata(
  existing: Record<string, unknown> | undefined,
  candidate: Record<string, unknown> | undefined,
  fallbackTemperature: GraphTemperature,
): Record<string, unknown> {
  const existingRecord = getMetadataRecord(existing);
  const candidateRecord = getMetadataRecord(candidate);
  const merged = mergeDefinedMetadata(existingRecord, candidateRecord);
  const graphTemperature =
    getGraphTemperature(existingRecord) ??
    getGraphTemperature(candidateRecord) ??
    fallbackTemperature;

  return applyGraphLayerMetadata(merged, {
    preferredTemperature: graphTemperature === "hot" || getGraphSources(existingRecord).includes("scan") ? "hot" : graphTemperature,
    sources: uniqueGraphSources([
      ...getGraphSources(candidateRecord),
      ...getGraphSources(existingRecord),
    ]),
    catalogIds: uniqueStrings([
      ...getCatalogIds(candidateRecord),
      ...getCatalogIds(existingRecord),
    ]),
  });
}

function addEdgeIfMissing(snapshot: CinderGraphSnapshot, edge: CinderGraphEdge): void {
  const existing = snapshot.edges.find((candidate) => candidate.id === edge.id);

  if (existing) {
    existing.metadata = mergeNodeMetadata(
      existing.metadata as Record<string, unknown> | undefined,
      edge.metadata as Record<string, unknown> | undefined,
      getGraphTemperature(getMetadataRecord(existing.metadata)) ?? "cold",
    );
    return;
  }

  snapshot.edges.push(edge);
}

export function markSnapshotGraphHot(snapshot: CinderGraphSnapshot): CinderGraphSnapshot {
  for (const node of snapshot.nodes) {
    node.metadata = applyGraphLayerMetadata(getMetadataRecord(node.metadata), {
      preferredTemperature: "hot",
      sources: ["scan"],
    });
  }

  for (const edge of snapshot.edges) {
    edge.metadata = applyGraphLayerMetadata(getMetadataRecord(edge.metadata), {
      preferredTemperature: "hot",
      sources: ["scan"],
    });
  }

  return snapshot;
}

function mergeAliases(...values: Array<string[] | undefined>): string[] {
  return uniqueNormalizedValues(values.flatMap((value) => value ?? []));
}

function makeNodeSourceKey(source: CinderSemanticNodeSource): string {
  return [source.tagName, source.elementId ?? "", source.selectorHint ?? ""].join("::");
}

function mergeNodeSources(
  ...values: Array<CinderSemanticNodeSource | CinderSemanticNodeSource[] | undefined>
): CinderSemanticNodeSource[] {
  const seen = new Set<string>();
  const result: CinderSemanticNodeSource[] = [];

  for (const value of values) {
    for (const source of Array.isArray(value) ? value : value ? [value] : []) {
      const key = makeNodeSourceKey(source);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      result.push(source);
    }
  }

  return result;
}

function mergeNode(
  snapshot: CinderGraphSnapshot,
  candidate: CinderGraphNode,
  temperature: GraphTemperature,
): void {
  const existing = snapshot.nodes.find((node) => node.id === candidate.id);

  if (!existing) {
    candidate.metadata = applyGraphLayerMetadata(getMetadataRecord(candidate.metadata), {
      preferredTemperature: temperature,
      sources: getGraphSources(getMetadataRecord(candidate.metadata)),
      catalogIds: getCatalogIds(getMetadataRecord(candidate.metadata)),
    });
    snapshot.nodes.push(candidate);
    indexNode(snapshot, candidate);
    return;
  }

  const mergedSources = mergeNodeSources(
    existing.source,
    existing.sources,
    candidate.source,
    candidate.sources,
  );

  existing.label = existing.label ?? candidate.label;
  existing.aliases = mergeAliases([existing.key], existing.aliases, candidate.aliases);
  existing.parentId = existing.parentId ?? candidate.parentId;
  existing.routeId = existing.routeId ?? candidate.routeId;
  existing.contextId = existing.contextId ?? candidate.contextId;
  existing.source = mergedSources[0] ?? existing.source ?? candidate.source;
  existing.sources = mergedSources.length > 1 ? mergedSources : undefined;
  existing.metadata = mergeNodeMetadata(existing.metadata as Record<string, unknown> | undefined, candidate.metadata as Record<string, unknown> | undefined, existing.source ? "hot" : temperature);

  indexNode(snapshot, existing);
}

function normalizePath(values?: string[]): string[] {
  return uniqueNormalizedValues(values ?? []);
}

function getContextNodeId(routeKey: string | undefined, contextPath: string[]): string | undefined {
  const normalizedPath = normalizePath(contextPath);

  if (normalizedPath.length === 0) {
    return undefined;
  }

  const contextKey = normalizedPath[normalizedPath.length - 1];
  const parentPath = normalizedPath.slice(0, -1);
  const scopeKey = makeScopeKey(routeKey, ...parentPath, contextKey);
  return makeNodeId("context", contextKey!, scopeKey);
}

function getCatalogNodeId(definition: CinderColdGraphNodeDefinition | CinderColdGraphNodeRef): string {
  const routeKey = normalizeOptionalSemanticKey(definition.routeKey);
  const contextPath = normalizePath(definition.contextPath);

  if (definition.type === "route") {
    return makeNodeId("route", definition.key, ROOT_INDEX_KEY);
  }

  if (definition.type === "context") {
    const scopeKey = makeScopeKey(routeKey, ...contextPath, definition.key);
    return makeNodeId("context", definition.key, scopeKey);
  }

  const scopeKey = contextPath.length > 0
    ? makeScopeKey(routeKey, ...contextPath)
    : routeKey
      ? makeScopeKey(routeKey)
      : ROOT_INDEX_KEY;

  return makeNodeId(definition.type, definition.key, scopeKey);
}

function getCatalogParentId(definition: CinderColdGraphNodeDefinition, appRootId: string): string {
  const routeKey = normalizeOptionalSemanticKey(definition.routeKey);
  const contextPath = normalizePath(definition.contextPath);

  if (definition.type === "route") {
    return appRootId;
  }

  if (definition.type === "context") {
    if (contextPath.length > 0) {
      return getContextNodeId(routeKey, contextPath) ?? appRootId;
    }

    if (routeKey) {
      return makeSyntheticRouteNodeId(routeKey);
    }

    return appRootId;
  }

  if (contextPath.length > 0) {
    return getContextNodeId(routeKey, contextPath) ?? appRootId;
  }

  if (routeKey) {
    return makeSyntheticRouteNodeId(routeKey);
  }

  return appRootId;
}

function createCatalogNode(definition: CinderColdGraphNodeDefinition, appRootId: string, catalogId: string): CinderGraphNode {
  const routeKey = normalizeOptionalSemanticKey(definition.routeKey);
  const contextPath = normalizePath(definition.contextPath);
  const routeId = routeKey ? makeSyntheticRouteNodeId(routeKey) : undefined;
  const contextId = definition.type === "context"
    ? contextPath.length > 0
      ? getContextNodeId(routeKey, contextPath)
      : undefined
    : getContextNodeId(routeKey, contextPath);

  return {
    id: getCatalogNodeId(definition),
    type: definition.type,
    key: definition.key,
    label: definition.label ?? definition.key,
    aliases: mergeAliases([definition.key], definition.aliases),
    parentId: getCatalogParentId(definition, appRootId),
    routeId,
    contextId,
    metadata: applyGraphLayerMetadata({
      ...(definition.metadata ?? {}),
      synthetic: true,
      catalogNode: true,
      catalogId,
    }, {
      preferredTemperature: "cold",
      sources: ["cold_catalog"],
      catalogIds: [catalogId],
    }),
  };
}

function createContainmentEdgesForNode(
  node: CinderGraphNode,
  source: CinderGraphLayerSource,
  catalogId?: string,
): CinderGraphEdge[] {
  const edges: CinderGraphEdge[] = [];

  if (node.parentId) {
    edges.push({
      id: makeEdgeId("contains", node.parentId, node.id),
      type: "contains",
      from: node.parentId,
      to: node.id,
      metadata: applyGraphLayerMetadata({
        synthetic: true,
      }, {
        preferredTemperature: source === "scan" ? "hot" : "cold",
        sources: [source],
        catalogIds: catalogId ? [catalogId] : undefined,
      }),
    });
  }

  if (node.contextId && node.type !== "context") {
    edges.push({
      id: makeEdgeId("scoped_to", node.id, node.contextId),
      type: "scoped_to",
      from: node.id,
      to: node.contextId,
      metadata: applyGraphLayerMetadata({
        synthetic: true,
      }, {
        preferredTemperature: source === "scan" ? "hot" : "cold",
        sources: [source],
        catalogIds: catalogId ? [catalogId] : undefined,
      }),
    });
  }

  return edges;
}

function normalizeComparableRoutePath(path?: string): string | undefined {
  const trimmedPath = path?.trim();

  if (!trimmedPath) {
    return undefined;
  }

  return trimmedPath.split("#", 1)[0]?.trim() || undefined;
}

function getPathAliasCandidates(path?: string): string[] {
  const trimmedPath = path?.trim();

  if (!trimmedPath || !trimmedPath.startsWith("/")) {
    return [];
  }

  const comparablePath = normalizeComparableRoutePath(trimmedPath);

  if (!comparablePath) {
    return [];
  }

  const sanitizedPath = comparablePath.split(/[?#]/, 1)[0] ?? comparablePath;
  const segments = sanitizedPath
    .split("/")
    .map((segment) => segment.replace(/[-_]+/g, " ").trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return [];
  }

  return [segments.join(" "), segments[segments.length - 1]!];
}

function mergeRouteMetadata(
  node: CinderGraphNode,
  route: CinderRouteDefinition,
  temperature: GraphTemperature,
): void {
  const existingMetadata = getMetadataRecord(node.metadata);
  const routeMetadata = {
    routePath: route.path,
    routeSelector: route.selector,
    registeredRoute: true,
    synthetic: existingMetadata.synthetic,
  } as Record<string, unknown>;

  node.aliases = uniqueNormalizedValues([
    node.key,
    ...(node.aliases ?? []),
    ...(route.aliases ?? []),
    ...getPathAliasCandidates(route.path),
  ]);

  // A real tagged element's own accessible name always wins when it has one - this only fills
  // in for a tagged element that genuinely has no label of its own (see CinderRouteDefinition's
  // `label` doc comment for why this fallback exists).
  node.label = node.label ?? route.label;

  node.metadata = applyGraphLayerMetadata(
    mergeDefinedMetadata(existingMetadata, routeMetadata),
    {
      preferredTemperature: existingMetadata.graphTemperature === "hot" || node.source ? "hot" : temperature,
      sources: [...getGraphSources(existingMetadata), "route_registry"],
      catalogIds: getCatalogIds(existingMetadata),
    },
  );
}

function createSyntheticRouteNode(route: CinderRouteDefinition, appRootId: string): CinderGraphNode {
  return {
    id: makeSyntheticRouteNodeId(route.key),
    type: "route",
    key: route.key,
    label: route.label ?? route.key,
    aliases: uniqueNormalizedValues([
      route.key,
      ...(route.aliases ?? []),
      ...getPathAliasCandidates(route.path),
    ]),
    parentId: appRootId,
    metadata: applyGraphLayerMetadata({
      routePath: route.path,
      routeSelector: route.selector,
      registeredRoute: true,
      synthetic: true,
    }, {
      preferredTemperature: "cold",
      sources: ["route_registry"],
    }),
  };
}

function findRouteNodeByPath(
  snapshot: CinderGraphSnapshot,
  path: string,
): CinderGraphNode | undefined {
  const comparablePath = normalizeComparableRoutePath(path);

  if (!comparablePath) {
    return undefined;
  }

  return snapshot.nodes.find((node) => {
    if (node.type !== "route") {
      return false;
    }

    return normalizeComparableRoutePath(getMetadataRecord(node.metadata).routePath as string | undefined) === comparablePath;
  });
}

function mergeHarvestedRouteReferenceMetadata(
  node: CinderGraphNode,
  reference: CinderInternalRouteReference,
): void {
  const existingMetadata = getMetadataRecord(node.metadata);
  const mergedSources = mergeNodeSources(node.source, node.sources, reference.source);
  const existingReferenceCount = typeof existingMetadata.harvestedReferenceCount === "number"
    ? existingMetadata.harvestedReferenceCount
    : 0;

  node.label = node.label ?? reference.label ?? node.key;
  node.aliases = uniqueNormalizedValues([
    node.key,
    ...(node.aliases ?? []),
    ...(reference.aliases ?? []),
    ...getPathAliasCandidates(reference.path),
  ]);
  node.source = mergedSources[0] ?? node.source ?? reference.source;
  node.sources = mergedSources.length > 1 ? mergedSources : undefined;
  node.metadata = applyGraphLayerMetadata(
    mergeDefinedMetadata(existingMetadata, {
      routePath: normalizeComparableRoutePath(reference.path),
      harvestedReference: true,
      harvestedReferenceCount: existingReferenceCount + 1,
    }),
    {
      preferredTemperature: "hot",
      sources: [...getGraphSources(existingMetadata), "scan"],
      catalogIds: getCatalogIds(existingMetadata),
    },
  );
}

function createSyntheticRouteNodeFromReference(
  reference: CinderInternalRouteReference,
  appRootId: string,
): CinderGraphNode {
  return {
    id: makeSyntheticRouteNodeId(reference.key),
    type: "route",
    key: reference.key,
    label: reference.label ?? reference.key,
    aliases: uniqueNormalizedValues([
      reference.key,
      ...(reference.aliases ?? []),
      ...getPathAliasCandidates(reference.path),
    ]),
    parentId: appRootId,
    source: reference.source,
    metadata: applyGraphLayerMetadata({
      routePath: normalizeComparableRoutePath(reference.path),
      synthetic: true,
      harvestedReference: true,
      harvestedReferenceCount: 1,
    }, {
      preferredTemperature: "hot",
      sources: ["scan"],
    }),
  };
}

export function mergeRegisteredRoutesIntoSnapshot(
  snapshot: CinderGraphSnapshot,
  routes: CinderRouteDefinition[],
): CinderGraphSnapshot {
  const appRootId = getAppRootId(snapshot);

  for (const route of routes) {
    const existingNode = snapshot.nodes.find((node) => node.type === "route" && node.key === route.key);

    if (existingNode) {
      mergeRouteMetadata(existingNode, route, existingNode.source ? "hot" : "cold");
      indexNode(snapshot, existingNode);
      continue;
    }

    const syntheticNode = createSyntheticRouteNode(route, appRootId);
    mergeNode(snapshot, syntheticNode, "cold");
    addEdgeIfMissing(snapshot, {
      id: makeEdgeId("contains", appRootId, syntheticNode.id),
      type: "contains",
      from: appRootId,
      to: syntheticNode.id,
      metadata: applyGraphLayerMetadata({ synthetic: true }, {
        preferredTemperature: "cold",
        sources: ["route_registry"],
      }),
    });
  }

  return snapshot;
}

function createCatalogEdge(edge: NonNullable<CinderColdGraphCatalog["edges"]>[number], catalogId: string): CinderGraphEdge {
  const from = getCatalogNodeId(edge.from);
  const to = getCatalogNodeId(edge.to);

  return {
    id: makeEdgeId(edge.type, from, to),
    type: edge.type,
    from,
    to,
    metadata: applyGraphLayerMetadata({
      ...(edge.metadata ?? {}),
      synthetic: true,
      catalogEdge: true,
      catalogId,
    }, {
      preferredTemperature: "cold",
      sources: ["cold_catalog"],
      catalogIds: [catalogId],
    }),
  };
}

export function mergeHarvestedRouteReferencesIntoSnapshot(
  snapshot: CinderGraphSnapshot,
  references: CinderInternalRouteReference[],
): CinderGraphSnapshot {
  const appRootId = getAppRootId(snapshot);

  for (const reference of references) {
    const comparablePath = normalizeComparableRoutePath(reference.path);

    if (!comparablePath) {
      continue;
    }

    const existingNode = findRouteNodeByPath(snapshot, comparablePath);

    if (existingNode) {
      mergeHarvestedRouteReferenceMetadata(existingNode, {
        ...reference,
        path: comparablePath,
      });
      indexNode(snapshot, existingNode);
      continue;
    }

    const syntheticNode = createSyntheticRouteNodeFromReference({
      ...reference,
      path: comparablePath,
    }, appRootId);
    mergeNode(snapshot, syntheticNode, "hot");
    addEdgeIfMissing(snapshot, {
      id: makeEdgeId("contains", appRootId, syntheticNode.id),
      type: "contains",
      from: appRootId,
      to: syntheticNode.id,
      metadata: applyGraphLayerMetadata({ synthetic: true }, {
        preferredTemperature: "hot",
        sources: ["scan"],
      }),
    });
  }

  return snapshot;
}

export function mergeColdGraphCatalogsIntoSnapshot(
  snapshot: CinderGraphSnapshot,
  catalogs: CinderColdGraphCatalog[],
): CinderGraphSnapshot {
  const appRootId = getAppRootId(snapshot);

  for (const catalog of catalogs) {
    for (const definition of catalog.nodes) {
      const node = createCatalogNode(definition, appRootId, catalog.id);
      mergeNode(snapshot, node, "cold");

      for (const edge of createContainmentEdgesForNode(node, "cold_catalog", catalog.id)) {
        addEdgeIfMissing(snapshot, edge);
      }
    }

    for (const edgeDefinition of catalog.edges ?? []) {
      addEdgeIfMissing(snapshot, createCatalogEdge(edgeDefinition, catalog.id));
    }
  }

  return snapshot;
}

export function getHybridGraphDiagnostics(snapshot: CinderGraphSnapshot): CinderHybridGraphDiagnostics {
  const nodeSourceLists = snapshot.nodes.map((node) => getGraphSources(getMetadataRecord(node.metadata)));
  const edgeSourceLists = snapshot.edges.map((edge) => getGraphSources(getMetadataRecord(edge.metadata)));
  const hotNodeCount = snapshot.nodes.filter((node) => getGraphTemperature(getMetadataRecord(node.metadata)) !== "cold").length;
  const coldNodeCount = snapshot.nodes.filter((node) => getGraphTemperature(getMetadataRecord(node.metadata)) === "cold").length;
  const hybridNodeCount = nodeSourceLists.filter((sources) => sources.length > 1).length;
  const hotEdgeCount = snapshot.edges.filter((edge) => getGraphTemperature(getMetadataRecord(edge.metadata)) !== "cold").length;
  const coldEdgeCount = snapshot.edges.filter((edge) => getGraphTemperature(getMetadataRecord(edge.metadata)) === "cold").length;
  const hybridEdgeCount = edgeSourceLists.filter((sources) => sources.length > 1).length;
  const routeRegistryNodeCount = nodeSourceLists.filter((sources) => sources.includes("route_registry")).length;
  const coldCatalogNodeCount = nodeSourceLists.filter((sources) => sources.includes("cold_catalog")).length;
  const coldCatalogEdgeCount = edgeSourceLists.filter((sources) => sources.includes("cold_catalog")).length;
  const coldCatalogIds = uniqueStrings([
    ...snapshot.nodes.flatMap((node) => getCatalogIds(getMetadataRecord(node.metadata))),
    ...snapshot.edges.flatMap((edge) => getCatalogIds(getMetadataRecord(edge.metadata))),
  ]);

  let mode: CinderHybridGraphDiagnostics["mode"] = "hot";
  if (coldNodeCount > 0 && hotNodeCount === 0) {
    mode = "cold";
  } else if (coldNodeCount > 0 || hybridNodeCount > 0 || hybridEdgeCount > 0) {
    mode = "hybrid";
  }

  return {
    mode,
    nodeCount: snapshot.nodes.length,
    edgeCount: snapshot.edges.length,
    hotNodeCount,
    coldNodeCount,
    hybridNodeCount,
    hotEdgeCount,
    coldEdgeCount,
    hybridEdgeCount,
    routeRegistryNodeCount,
    coldCatalogNodeCount,
    coldCatalogEdgeCount,
    coldCatalogCount: coldCatalogIds.length,
    coldCatalogIds,
  };
}

export function updateHybridGraphCounts(snapshot: CinderGraphSnapshot): CinderGraphSnapshot {
  const diagnostics = getHybridGraphDiagnostics(snapshot);
  snapshot.meta.hotNodeCount = diagnostics.hotNodeCount;
  snapshot.meta.coldNodeCount = diagnostics.coldNodeCount;
  snapshot.meta.hotEdgeCount = diagnostics.hotEdgeCount;
  snapshot.meta.coldEdgeCount = diagnostics.coldEdgeCount;
  snapshot.meta.hybrid = diagnostics;
  return snapshot;
}
