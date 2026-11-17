import type { CinderSemanticNodeSource } from "../tags/index.js";

export type CinderGraphNodeType =
  | "app"
  | "route"
  | "context"
  | "entity"
  | "field"
  | "filter"
  | "action"
  | "output"
  | "data";

export type CinderGraphEdgeType =
  | "contains"
  | "scoped_to"
  | "navigates_to"
  | "targets"
  | "relates_to"
  | "displays"
  | "filters"
  | "depends_on";

export interface CinderGraphNode {
  id: string;
  type: CinderGraphNodeType;
  key: string;
  label?: string;
  aliases?: string[];
  parentId?: string;
  routeId?: string;
  contextId?: string;
  source?: CinderSemanticNodeSource;
  /** Every real DOM element this node was built from, when more than one tagged element
   * shares the same key (e.g. the same action rendered in two places) - `source` stays the
   * first/primary one for back-compat, this carries the full set. */
  sources?: CinderSemanticNodeSource[];
  metadata?: Record<string, unknown>;
}

export interface CinderGraphEdge {
  id: string;
  type: CinderGraphEdgeType;
  from: string;
  to: string;
  metadata?: Record<string, unknown>;
}

export interface CinderGraphIndexes {
  byType: Record<CinderGraphNodeType, string[]>;
  byKey: Record<string, string[]>;
  byContext: Record<string, string[]>;
  byRoute: Record<string, string[]>;
}

export interface CinderGraphRuntimeState {
  activeRouteId?: string;
  activeContextId?: string;
  focusedNodeId?: string;
  selections?: Record<string, unknown>;
}

export interface CinderHybridGraphDiagnostics {
  mode: "hot" | "cold" | "hybrid";
  nodeCount: number;
  edgeCount: number;
  hotNodeCount: number;
  coldNodeCount: number;
  hybridNodeCount: number;
  hotEdgeCount: number;
  coldEdgeCount: number;
  hybridEdgeCount: number;
  routeRegistryNodeCount: number;
  coldCatalogNodeCount: number;
  coldCatalogEdgeCount: number;
  coldCatalogCount: number;
  coldCatalogIds: string[];
}

export interface CinderGraphSnapshot {
  version: "v1";
  nodes: CinderGraphNode[];
  edges: CinderGraphEdge[];
  indexes: CinderGraphIndexes;
  runtime: CinderGraphRuntimeState;
  meta: {
    scannedAt?: string;
    entryCount?: number;
    warningCount?: number;
    lastScanDurationMs?: number;
    lastScanReason?: "manual" | "mutation";
    mutationRescanCount?: number;
    coldNodeCount?: number;
    hotNodeCount?: number;
    coldEdgeCount?: number;
    hotEdgeCount?: number;
    hybrid?: CinderHybridGraphDiagnostics;
  };
}

/**
 * Richer per-candidate description for tier 3's prompt, carrying the SAME keys already listed
 * in CinderInferGraphSummary's flat arrays below - additive, never a replacement. The flat
 * arrays remain the authoritative candidate set for grounding/validation (see llmCore.ts's
 * normalizeInferResponseToIntent); this is purely extra, optional context to help a real cloud
 * model actually tell same-sounding candidates apart (e.g. "Loans disbursed: open the list" vs.
 * "Amount disbursed: open the list" - two real labels that disambiguate what a bare key like
 * "dashboard-tile-disbursed-count" cannot on its own).
 */
export interface CinderInferGraphNodeDetail {
  key: string;
  type: CinderGraphNodeType;
  /** The node's real, human-facing label - what a user would actually read on the page. */
  label?: string;
  /** Breadcrumb of the page section/context this node sits in (e.g. ["dashboard",
   * "collections-summary"]) - lets the model tell apart two same-sounding candidates that live
   * in different parts of the page. */
  contextPath?: string[];
  /** The real route key this node is scoped to, if any - a second structural disambiguator
   * alongside contextPath. */
  routeKey?: string;
  /** For an action node with a real "navigates_to" edge: the route key it leads to (e.g.
   * "View details" -> "loan-detail") - tells the model what clicking this action actually
   * does, beyond its bare label. Only present when the app author declared it
   * (data-cinder-navigates-to); most actions have no navigation target at all. */
  navigatesTo?: string;
}

export interface CinderInferGraphSummary {
  activeRoute?: string;
  activeContext?: string;
  routes?: string[];
  contexts?: string[];
  entities?: string[];
  fields?: string[];
  filters?: string[];
  actions?: string[];
  outputs?: string[];
  dataSources?: string[];
  selections?: Record<string, unknown>;
  /** See CinderInferGraphNodeDetail's doc comment. */
  nodeDetails?: CinderInferGraphNodeDetail[];
}
