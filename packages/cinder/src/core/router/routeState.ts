// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import type {
  CinderGraphNode,
  CinderGraphSnapshot,
  CinderRouteDefinition,
} from "../../types.js";
import { resolveElementsFromNode } from "../dom/nodeSources.js";
import {
  getDefaultView,
  getOwnerDocument,
  isDocumentNode,
  isDomElement,
  isHtmlElement,
} from "../dom/realm.js";
import { normalizeSemanticKey } from "../semantic/normalize.js";

interface ActiveRuntimeState {
  activeRouteId?: string;
  activeContextId?: string;
}

function getQueryRoot(root?: ParentNode | Document): ParentNode | Document | null {
  if (root) {
    return root;
  }

  if (typeof document !== "undefined") {
    return document;
  }

  return null;
}

function getCurrentLocation(root?: ParentNode | Document) {
  const targetWindow = getDefaultView(root);
  if (!targetWindow) {
    return undefined;
  }

  return {
    origin: targetWindow.location.origin,
    pathname: targetWindow.location.pathname,
    search: targetWindow.location.search,
    hash: targetWindow.location.hash,
  };
}

function findNodeById(snapshot: CinderGraphSnapshot, id?: string): CinderGraphNode | undefined {
  if (!id) {
    return undefined;
  }

  return snapshot.nodes.find((node) => node.id === id);
}

function getRouteNodes(snapshot: CinderGraphSnapshot): CinderGraphNode[] {
  return snapshot.nodes.filter((node) => node.type === "route");
}

function getContextNodes(snapshot: CinderGraphSnapshot): CinderGraphNode[] {
  return snapshot.nodes.filter((node) => node.type === "context");
}

function getNodeMetadataString(node: CinderGraphNode | undefined, key: string): string | undefined {
  const value = node?.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getRouteDefinitionMap(routes: CinderRouteDefinition[]): Map<string, CinderRouteDefinition> {
  return new Map(routes.map((route) => [normalizeSemanticKey(route.key), route]));
}

function getSelectorHint(node: CinderGraphNode | undefined): string | undefined {
  const sources = node
    ? [node.source, ...(node.sources ?? [])].filter((source): source is NonNullable<typeof node.source> => Boolean(source))
    : [];

  for (const source of sources) {
    if (typeof source.selectorHint === "string" && source.selectorHint.trim()) {
      return source.selectorHint.trim();
    }
  }

  return undefined;
}

function resolveElement(node: CinderGraphNode | undefined, root?: ParentNode | Document): Element | null {
  return resolveElementsFromNode(node, root)[0] ?? null;
}

function resolveElementBySelector(selector: string | undefined, root?: ParentNode | Document): Element | null {
  if (!selector) {
    return null;
  }

  const target = getQueryRoot(root);
  if (!target || typeof (target as ParentNode).querySelector !== "function") {
    return null;
  }

  try {
    return target.querySelector(selector);
  } catch {
    return null;
  }
}

function getNormalizedPath(path: string, root?: ParentNode | Document): string {
  if (!path) {
    return "/";
  }

  try {
    const location = getCurrentLocation(root);
    const base = location
      ? `${location.origin}${location.pathname}${location.search}${location.hash}`
      : "http://localhost/";
    const url = new URL(path, base);
    const normalized = `${url.pathname}${url.search}`.replace(/\/$/, "") || "/";
    return normalized;
  } catch {
    return path.replace(/\/$/, "") || "/";
  }
}

function routePathMatchesCurrentLocation(path: string | undefined, root?: ParentNode | Document): boolean {
  const location = getCurrentLocation(root);
  if (!location || !path) {
    return false;
  }

  const normalizedCurrentPath = `${location.pathname}${location.search}`.replace(/\/$/, "") || "/";

  if (path.startsWith("#")) {
    return location.hash === path;
  }

  return getNormalizedPath(path, root) === normalizedCurrentPath;
}

function getRoutePath(
  routeDefinition: CinderRouteDefinition | undefined,
  node: CinderGraphNode | undefined,
): string | undefined {
  return routeDefinition?.path ?? getNodeMetadataString(node, "routePath") ?? getNodeMetadataString(node, "href");
}

function getRouteSelector(
  routeDefinition: CinderRouteDefinition | undefined,
  node: CinderGraphNode | undefined,
): string | undefined {
  return routeDefinition?.selector ?? getNodeMetadataString(node, "routeSelector");
}

function isElementVisible(element: Element | null): boolean {
  if (!element) {
    return false;
  }

  if (element.getAttribute("hidden") !== null || element.getAttribute("aria-hidden") === "true") {
    return false;
  }

  if (!isHtmlElement(element)) {
    return true;
  }

  const targetWindow = getDefaultView(element);
  if (!targetWindow) {
    return true;
  }

  const style = targetWindow.getComputedStyle?.(element);
  if (style && (style.display === "none" || style.visibility === "hidden")) {
    return false;
  }

  return true;
}

function scoreActiveRoute(
  snapshot: CinderGraphSnapshot,
  node: CinderGraphNode,
  routeDefinitionMap: Map<string, CinderRouteDefinition>,
  root?: ParentNode | Document,
): number {
  let score = 0;
  const routeDefinition = routeDefinitionMap.get(normalizeSemanticKey(node.key));
  const routeElements = resolveElementsFromNode(node, root);
  const routeElement = routeElements.find((element) => isElementVisible(element)) ?? routeElements[0] ?? null;
  const selectorElement = resolveElementBySelector(getRouteSelector(routeDefinition, node), root);
  const activeElement = selectorElement ?? routeElement;

  if (routeDefinition?.isActive) {
    try {
      if (routeDefinition.isActive()) {
        score += 1000;
      }
    } catch {
      // ignore user callback failures here
    }
  }

  if (routePathMatchesCurrentLocation(getRoutePath(routeDefinition, node), root)) {
    score += 600;
  }

  const ariaCurrent = getNodeMetadataString(node, "ariaCurrent")
    ?? routeElements.find((element) => {
      const value = element.getAttribute("aria-current");
      return value === "page" || value === "true" || value === "step" || value === "location";
    })?.getAttribute("aria-current")
    ?? activeElement?.getAttribute("aria-current")
    ?? undefined;
  if (ariaCurrent === "page" || ariaCurrent === "true" || ariaCurrent === "step" || ariaCurrent === "location") {
    score += 500;
  }

  if (isElementVisible(routeElement)) {
    score += 120;
  }

  if (isElementVisible(selectorElement)) {
    score += 80;
  }

  if (snapshot.runtime.activeRouteId === node.id) {
    score += 20;
  }

  return score;
}

function resolveActiveRouteId(
  snapshot: CinderGraphSnapshot,
  routes: CinderRouteDefinition[],
  root?: ParentNode | Document,
): string | undefined {
  const routeNodes = getRouteNodes(snapshot);
  if (routeNodes.length === 0) {
    return undefined;
  }

  const routeDefinitionMap = getRouteDefinitionMap(routes);
  let bestNode = routeNodes[0];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const node of routeNodes) {
    const score = scoreActiveRoute(snapshot, node, routeDefinitionMap, root);
    if (score > bestScore) {
      bestNode = node;
      bestScore = score;
    }
  }

  return bestNode?.id;
}

function findNearestContextElement(start: Element | null): Element | null {
  let current = start;

  while (current) {
    if (current.hasAttribute("cinder-context")) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function resolveFocusedContextId(snapshot: CinderGraphSnapshot, root?: ParentNode | Document): string | undefined {
  const target = getQueryRoot(root);
  if (!target) {
    return undefined;
  }

  const ownerDocument = isDocumentNode(target) ? target : getOwnerDocument(target);
  const activeElement = ownerDocument?.activeElement ?? null;
  if (!isDomElement(activeElement)) {
    return undefined;
  }

  const contextElement = findNearestContextElement(activeElement);
  const contextKey = contextElement?.getAttribute("cinder-context")?.trim();
  if (!contextKey) {
    return undefined;
  }

  const normalizedContextKey = normalizeSemanticKey(contextKey);
  return snapshot.nodes.find((node) => node.type === "context" && node.key === normalizedContextKey)?.id;
}

function scoreActiveContext(
  snapshot: CinderGraphSnapshot,
  node: CinderGraphNode,
  activeRouteId: string | undefined,
  root?: ParentNode | Document,
): number {
  let score = 0;
  const contextElement = resolveElement(node, root);

  if (snapshot.runtime.focusedNodeId) {
    const focusedNode = findNodeById(snapshot, snapshot.runtime.focusedNodeId);
    if (focusedNode?.contextId === node.id) {
      score += 220;
    }
  }

  if (snapshot.runtime.activeContextId === node.id) {
    score += 40;
  }

  if (activeRouteId && node.routeId === activeRouteId) {
    score += 180;
  }

  if (isElementVisible(contextElement)) {
    score += 120;
  }

  return score;
}

function resolveActiveContextId(
  snapshot: CinderGraphSnapshot,
  activeRouteId: string | undefined,
  root?: ParentNode | Document,
): string | undefined {
  const focusedContextId = resolveFocusedContextId(snapshot, root);
  if (focusedContextId) {
    return focusedContextId;
  }

  const contextNodes = getContextNodes(snapshot);
  if (contextNodes.length === 0) {
    return undefined;
  }

  const inActiveRoute = activeRouteId
    ? contextNodes.filter((node) => node.routeId === activeRouteId)
    : contextNodes;
  const candidates = inActiveRoute.length > 0 ? inActiveRoute : contextNodes;

  let bestNode = candidates[0];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const node of candidates) {
    const score = scoreActiveContext(snapshot, node, activeRouteId, root);
    if (score > bestScore) {
      bestNode = node;
      bestScore = score;
    }
  }

  return bestNode?.id;
}

export function resolveActiveRuntimeState(
  snapshot: CinderGraphSnapshot,
  routes: CinderRouteDefinition[],
  root?: ParentNode | Document,
): ActiveRuntimeState {
  const activeRouteId = resolveActiveRouteId(snapshot, routes, root);
  const activeContextId = resolveActiveContextId(snapshot, activeRouteId, root);

  return {
    activeRouteId,
    activeContextId,
  };
}

export function applyResolvedActiveRuntimeState(
  snapshot: CinderGraphSnapshot,
  routes: CinderRouteDefinition[],
  root?: ParentNode | Document,
): CinderGraphSnapshot {
  const nextState = resolveActiveRuntimeState(snapshot, routes, root);
  snapshot.runtime.activeRouteId = nextState.activeRouteId;
  snapshot.runtime.activeContextId = nextState.activeContextId;
  return snapshot;
}
