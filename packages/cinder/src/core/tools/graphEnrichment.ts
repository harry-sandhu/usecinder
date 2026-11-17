// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import type { CinderGraphEdge, CinderGraphNode, CinderGraphNodeType, CinderGraphSnapshot } from "../../types.js";

/**
 * The producer half of the long-planned "Graph Enrichment AI" (docs/mvp-phase-plan.md Phase
 * 12, docs/known-limitations.md #2/#7): a developer-run, offline analysis step that suggests
 * aliases and relationships from the real app's own graph, for a human to review before
 * anything is activated - never a live, runtime AI guess.
 *
 * The CONSUMER side already exists and was already fully tested before this file was written:
 * `CinderColdGraphCatalog` + `Cinder.registerColdGraph()` + `mergeColdGraphCatalogsIntoSnapshot`
 * (core/cag/hybridGraph.ts). Node IDs there are computed purely from `type:scope:key`
 * (makeNodeId), so a catalog entry naming the SAME key/type/scope as a real scanned node merges
 * its aliases onto that real node via mergeNode's existing-id branch, rather than creating a
 * duplicate - confirmed by reading that function, not assumed. This file is the other half:
 * turning a real snapshot into something an LLM (or an agent, via
 * docs/prompts/cinder-graph-enrichment.md) can actually read and suggest improvements against,
 * producing output in the EXACT CinderColdGraphCatalog shape the engine already knows how to
 * merge - no new consumption code needed.
 */
export interface CinderEnrichmentNodeSummary {
  key: string;
  type: CinderGraphNodeType;
  /** The node's current real label, if any - context for judging whether a suggested alias is
   * actually redundant with what's already there. */
  label?: string;
  /** The node's current real aliases, if any - same reason: don't suggest what's already
   * present. */
  aliases?: string[];
  contextPath?: string[];
  routeKey?: string;
}

/** Only the semantically meaningful edge types - "contains"/"scoped_to" are structural and
 * already implied by contextPath/routeKey above, so repeating them here would just be noise an
 * LLM has to read past. */
export interface CinderEnrichmentEdgeSummary {
  type: Exclude<CinderGraphEdge["type"], "contains" | "scoped_to">;
  from: string;
  to: string;
}

export interface CinderGraphEnrichmentExport {
  nodes: CinderEnrichmentNodeSummary[];
  edges: CinderEnrichmentEdgeSummary[];
}

function getContextPath(node: CinderGraphNode): string[] | undefined {
  const raw = node.metadata?.contextPath;

  if (!Array.isArray(raw)) {
    return undefined;
  }

  const path = raw.filter((entry): entry is string => typeof entry === "string");
  return path.length > 0 ? path : undefined;
}

/**
 * Serializes the real (non-"app") part of a graph snapshot into a plain, LLM-readable summary -
 * every real node's key/type/current label/current aliases/page position, and every real,
 * semantically meaningful edge between them. Call this against a live, scanned snapshot
 * (`window.Cinder.graph()`), not a cold/synthetic one - the whole point is analyzing what the
 * real app actually has.
 */
export function exportGraphForEnrichment(snapshot: CinderGraphSnapshot): CinderGraphEnrichmentExport {
  const keysById = new Map(snapshot.nodes.map((node) => [node.id, node.key] as const));

  const nodes: CinderEnrichmentNodeSummary[] = snapshot.nodes
    .filter((node) => node.type !== "app")
    .map((node) => {
      const summary: CinderEnrichmentNodeSummary = { key: node.key, type: node.type };

      if (node.label) {
        summary.label = node.label;
      }

      if (node.aliases && node.aliases.length > 0) {
        summary.aliases = node.aliases;
      }

      const contextPath = getContextPath(node);
      if (contextPath) {
        summary.contextPath = contextPath;
      }

      const routeKey = node.routeId ? keysById.get(node.routeId) : undefined;
      if (routeKey) {
        summary.routeKey = routeKey;
      }

      return summary;
    });

  const edges: CinderEnrichmentEdgeSummary[] = snapshot.edges
    .filter(
      (edge): edge is typeof edge & { type: CinderEnrichmentEdgeSummary["type"] } =>
        edge.type !== "contains" && edge.type !== "scoped_to",
    )
    .map((edge) => ({
      type: edge.type,
      from: keysById.get(edge.from) ?? edge.from,
      to: keysById.get(edge.to) ?? edge.to,
    }));

  return { nodes, edges };
}
