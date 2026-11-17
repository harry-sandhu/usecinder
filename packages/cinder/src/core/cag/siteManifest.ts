import type {
  CinderColdGraphCatalog,
  CinderColdGraphEdgeDefinition,
  CinderColdGraphNodeDefinition,
  CinderSiteManifest,
  CinderSiteManifestGroupDefinition,
  CinderSiteManifestNodeDefinition,
  CinderSiteManifestRouteDefinition,
} from "../../types.js";
import { normalizeOptionalSemanticKey, uniqueNormalizedValues } from "../semantic/normalize.js";

function uniqueStrings(values: Array<string | undefined>): string[] {
  return uniqueNormalizedValues(values);
}

function getMetadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function getPathAliasCandidates(path?: string): string[] {
  const trimmedPath = path?.trim();

  if (!trimmedPath || !trimmedPath.startsWith("/")) {
    return [];
  }

  const sanitizedPath = trimmedPath.split(/[?#]/, 1)[0] ?? trimmedPath;
  const segments = sanitizedPath
    .split("/")
    .map((segment) => segment.replace(/[-_]+/g, " ").trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return [];
  }

  return [segments.join(" "), segments[segments.length - 1]!];
}

function getTerminalTitleAliasCandidates(title?: string): string[] {
  const trimmed = title?.trim();

  if (!trimmed) {
    return [];
  }

  const parts = trimmed
    .split(/(?:::|[./#])/g)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    return [];
  }

  return [parts.join(" "), parts[parts.length - 1]!];
}

function getGroupDerivedAliases(route: CinderSiteManifestRouteDefinition): string[] {
  const metadata = route.metadata as Record<string, unknown> | undefined;
  const group = getMetadataString(metadata, "group")?.toLowerCase();
  const title = route.title?.trim();
  const terminalTitle = getTerminalTitleAliasCandidates(title)[1];

  if (!group || !terminalTitle) {
    return [];
  }

  if (group.includes("api")) {
    return [
      `api ${terminalTitle}`,
      `${terminalTitle} api`,
      `${terminalTitle} method`,
      `${terminalTitle} function`,
    ];
  }

  if (group.includes("guide")) {
    return [`guide ${terminalTitle}`, `${terminalTitle} guide`];
  }

  if (group.includes("concept")) {
    return [`concept ${terminalTitle}`, `${terminalTitle} concept`];
  }

  if (group.includes("reference")) {
    return [`reference ${terminalTitle}`, `${terminalTitle} reference`];
  }

  return [];
}

function createRouteAliases(route: CinderSiteManifestRouteDefinition): string[] {
  return uniqueStrings([
    route.key,
    ...(route.aliases ?? []),
    route.title,
    ...getTerminalTitleAliasCandidates(route.title),
    ...getPathAliasCandidates(route.path),
    ...getGroupDerivedAliases(route),
  ]);
}

function createRouteNode(route: CinderSiteManifestRouteDefinition): CinderColdGraphNodeDefinition {
  return {
    type: "route",
    key: route.key,
    label: route.title ?? route.key,
    aliases: createRouteAliases(route),
    metadata: {
      routePath: route.path,
      routeSelector: route.selector,
      ...(route.metadata ?? {}),
    },
  };
}

function createColdNodeFromManifestNode(
  node: CinderSiteManifestNodeDefinition,
  routeKey: string,
  contextPath: string[],
): CinderColdGraphNodeDefinition {
  return {
    type: node.type,
    key: node.key,
    label: node.label,
    aliases: uniqueStrings([node.key, ...(node.aliases ?? []), node.label]),
    routeKey,
    contextPath: contextPath.length > 0 ? contextPath : undefined,
    metadata: node.metadata,
  };
}

function collectManifestNodes(
  route: CinderSiteManifestRouteDefinition,
  node: CinderSiteManifestNodeDefinition,
  contextPath: string[],
  nodes: CinderColdGraphNodeDefinition[],
): void {
  nodes.push(createColdNodeFromManifestNode(node, route.key, contextPath));

  const nextContextPath = node.type === "context"
    ? [...contextPath, node.key]
    : contextPath;

  for (const child of node.children ?? []) {
    collectManifestNodes(route, child, nextContextPath, nodes);
  }
}

function createGroupNode(group: CinderSiteManifestGroupDefinition): CinderColdGraphNodeDefinition {
  return {
    type: "context",
    key: group.key,
    label: group.title,
    aliases: uniqueStrings([group.key, group.title, ...(group.aliases ?? [])]),
    routeKey: normalizeOptionalSemanticKey(group.routeKey),
    metadata: {
      kind: "site-manifest-group",
      ...(group.metadata ?? {}),
    },
  };
}

function createGroupEdges(group: CinderSiteManifestGroupDefinition): CinderColdGraphEdgeDefinition[] {
  return (group.memberRouteKeys ?? [])
    .map((routeKey) => normalizeOptionalSemanticKey(routeKey))
    .filter((routeKey): routeKey is string => Boolean(routeKey))
    .map((routeKey) => ({
      type: "relates_to" as const,
      from: {
        type: "context",
        key: group.key,
        routeKey: normalizeOptionalSemanticKey(group.routeKey),
      },
      to: {
        type: "route",
        key: routeKey,
      },
      metadata: {
        kind: "site-manifest-group-membership",
      },
    }));
}

export function createColdGraphFromSiteManifest(
  manifest: CinderSiteManifest,
): CinderColdGraphCatalog {
  const nodes: CinderColdGraphNodeDefinition[] = manifest.routes.map(createRouteNode);
  const edges: CinderColdGraphEdgeDefinition[] = [];

  for (const route of manifest.routes) {
    for (const node of route.nodes ?? []) {
      collectManifestNodes(route, node, [], nodes);
    }
  }

  for (const group of manifest.groups ?? []) {
    nodes.push(createGroupNode(group));
    edges.push(...createGroupEdges(group));
  }

  return {
    id: manifest.id,
    nodes,
    edges,
  };
}
