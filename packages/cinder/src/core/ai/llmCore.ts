import {
  normalizeInferIntentResponse,
  type CinderInferGraphNodeDetail,
  type CinderResolutionStep,
  type InferIntentRequest,
  type InferIntentResponse,
} from "@cinder/shared";
import type {
  CinderConfig,
  CinderFallbackAuthMode,
  CinderFallbackErrorCode,
  CinderFallbackReason,
  CinderFallbackResultMeta,
  CinderGraphNode,
  CinderGraphSnapshot,
  CinderResolvedIntent,
  CinderRuntimeContext,
} from "../../types.js";

const CLOUD_MATCH_AMBIGUITY_DELTA = 8;

type CloudMatchScopeHints = {
  routeTerms?: Array<unknown>;
  contextTerms?: Array<unknown>;
  routeIds?: string[];
  contextIds?: string[];
  preferredRouteIds?: string[];
  preferredContextIds?: string[];
};

type CloudMatchResult = {
  node?: CinderGraphNode;
  ambiguous?: boolean;
};

function getFallbackReason(
  config: Required<CinderConfig>,
  localIntent: CinderResolvedIntent,
): CinderFallbackReason | undefined {
  if (!config.ai.enabled) {
    return undefined;
  }

  if (config.ai.mode === "local") {
    return undefined;
  }

  if (!config.ai.endpoint) {
    return undefined;
  }

  if (localIntent.intent === "unknown") {
    return "unknown_intent";
  }

  if (localIntent.confidence < 0.5) {
    return "low_confidence";
  }

  return undefined;
}

function shouldUseCloudFallback(
  config: Required<CinderConfig>,
  localIntent: CinderResolvedIntent,
): boolean {
  return Boolean(getFallbackReason(config, localIntent));
}

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getKeysByType(snapshot: CinderGraphSnapshot, type: string): string[] {
  return [...new Set(snapshot.nodes.filter((node) => node.type === type).map((node) => node.key))];
}

function getNodeContextPath(node: CinderGraphNode): string[] | undefined {
  const raw = node.metadata?.contextPath;

  if (!Array.isArray(raw)) {
    return undefined;
  }

  const path = raw.filter((entry): entry is string => typeof entry === "string");
  return path.length > 0 ? path : undefined;
}

/**
 * Richer per-candidate description for tier 3's prompt - see CinderInferGraphNodeDetail's doc
 * comment in @cinder/shared for why (a bare key like "dashboard-tile-disbursed-count" can't be
 * told apart from "dashboard-tile-disbursed-amount" the way their real labels, "Loans disbursed"
 * vs. "Amount disbursed," can). Purely additive - normalizeInferResponseToIntent still
 * re-validates the model's returned key against the real graph regardless of what the prompt
 * said, so richer prompt context never weakens grounding.
 */
function buildNodeDetails(snapshot: CinderGraphSnapshot): CinderInferGraphNodeDetail[] {
  const routeKeysById = new Map(
    snapshot.nodes.filter((node) => node.type === "route").map((node) => [node.id, node.key] as const),
  );

  return snapshot.nodes
    .filter((node) => node.type !== "app")
    .map((node) => {
      const detail: CinderInferGraphNodeDetail = { key: node.key, type: node.type };

      if (node.label) {
        detail.label = node.label;
      }

      const contextPath = getNodeContextPath(node);
      if (contextPath) {
        detail.contextPath = contextPath;
      }

      const routeKey = node.routeId ? routeKeysById.get(node.routeId) : undefined;
      if (routeKey) {
        detail.routeKey = routeKey;
      }

      // navigates_to (known-limitations.md #2): tells the model what an action actually
      // does beyond its bare label - most actions have no edge here, which is normal.
      if (node.type === "action") {
        const navigationEdge = snapshot.edges.find(
          (edge) => edge.type === "navigates_to" && edge.from === node.id,
        );
        const targetKey = navigationEdge ? routeKeysById.get(navigationEdge.to) : undefined;

        if (targetKey) {
          detail.navigatesTo = targetKey;
        }
      }

      return detail;
    });
}

function buildInferRequest(
  input: string,
  snapshot: CinderGraphSnapshot,
  config: Required<CinderConfig>,
  runtimeContext?: CinderRuntimeContext,
): InferIntentRequest {
  const activeRoute = snapshot.nodes.find(
    (node) => node.id === snapshot.runtime.activeRouteId,
  );
  const activeContext = snapshot.nodes.find(
    (node) => node.id === snapshot.runtime.activeContextId,
  );

  return {
    text: input,
    context: {
      ...(runtimeContext ?? {}),
      ...(snapshot.runtime.selections ?? {}),
      activeRoute: activeRoute?.key,
      activeContext: activeContext?.key,
    },
    graph: {
      activeRoute: activeRoute?.key,
      activeContext: activeContext?.key,
      routes: getKeysByType(snapshot, "route"),
      contexts: getKeysByType(snapshot, "context"),
      entities: getKeysByType(snapshot, "entity"),
      fields: getKeysByType(snapshot, "field"),
      filters: getKeysByType(snapshot, "filter"),
      actions: getKeysByType(snapshot, "action"),
      outputs: getKeysByType(snapshot, "output"),
      dataSources: getKeysByType(snapshot, "data"),
      selections: snapshot.runtime.selections,
      nodeDetails: buildNodeDetails(snapshot),
    },
    app: {
      name: config.app.name,
      version: config.app.version,
      route: activeRoute?.key,
    },
    options: {
      temperature: 0.2,
      generateReply: true,
    },
  };
}

function getNormalizedTerms(...values: Array<unknown>): string[] {
  const terms = values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .flatMap((value) => {
      const trimmed = value.trim();
      const normalized = normalizeKey(trimmed);
      return normalized && normalized !== trimmed ? [trimmed, normalized] : [trimmed];
    });

  return [...new Set(terms)];
}

function matchesNodeTerm(node: CinderGraphNode, term: string): number {
  const normalizedTerm = normalizeKey(term);

  if (!normalizedTerm) {
    return 0;
  }

  const nodeKey = normalizeKey(node.key);
  const aliases = (node.aliases ?? []).map((alias) => normalizeKey(alias));

  if (nodeKey === normalizedTerm) {
    return 100;
  }

  if (aliases.includes(normalizedTerm)) {
    return 90;
  }

  if (normalizedTerm.includes(nodeKey) || nodeKey.includes(normalizedTerm)) {
    return 60;
  }

  if (aliases.some((alias) => normalizedTerm.includes(alias) || alias.includes(normalizedTerm))) {
    return 50;
  }

  return 0;
}

function getNodesByType(
  snapshot: CinderGraphSnapshot,
  type: CinderGraphNode["type"],
): CinderGraphNode[] {
  return snapshot.nodes.filter((node) => node.type === type);
}

function matchesRouteId(node: CinderGraphNode, routeId: string | undefined): boolean {
  if (!routeId) {
    return false;
  }

  return node.type === "route" ? node.id === routeId : node.routeId === routeId;
}

function resolveScopeIds(
  snapshot: CinderGraphSnapshot,
  type: CinderGraphNode["type"],
  terms: Array<unknown> | undefined,
  preferredRouteIds?: string[],
): string[] {
  const normalizedTerms = getNormalizedTerms(...(terms ?? []));

  if (normalizedTerms.length === 0) {
    return [];
  }

  const nodes = getNodesByType(snapshot, type).filter((node) => {
    if (!preferredRouteIds || preferredRouteIds.length === 0) {
      return true;
    }

    return preferredRouteIds.some((routeId) => matchesRouteId(node, routeId));
  });

  const matches = nodes
    .map((node) => ({ node, score: Math.max(...normalizedTerms.map((term) => matchesNodeTerm(node, term))) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((candidate) => candidate.node.id);

  return [...new Set(matches)];
}

function getExplicitRouteIds(
  snapshot: CinderGraphSnapshot,
  hints?: CloudMatchScopeHints,
): string[] {
  const ids = new Set<string>();

  for (const routeId of hints?.routeIds ?? []) {
    ids.add(routeId);
  }

  for (const routeId of resolveScopeIds(snapshot, "route", hints?.routeTerms)) {
    ids.add(routeId);
  }

  return [...ids];
}

function getPreferredRouteIds(
  snapshot: CinderGraphSnapshot,
  hints?: CloudMatchScopeHints,
): string[] {
  const ids = new Set<string>();

  for (const routeId of hints?.preferredRouteIds ?? []) {
    ids.add(routeId);
  }

  if (snapshot.runtime.activeRouteId) {
    ids.add(snapshot.runtime.activeRouteId);
  }

  return [...ids];
}

function getExplicitContextIds(
  snapshot: CinderGraphSnapshot,
  hints?: CloudMatchScopeHints,
): string[] {
  const explicitRouteIds = getExplicitRouteIds(snapshot, hints);
  const ids = new Set<string>();

  for (const contextId of hints?.contextIds ?? []) {
    ids.add(contextId);
  }

  for (const contextId of resolveScopeIds(
    snapshot,
    "context",
    hints?.contextTerms,
    explicitRouteIds.length > 0 ? explicitRouteIds : undefined,
  )) {
    ids.add(contextId);
  }

  return [...ids];
}

function getPreferredContextIds(
  snapshot: CinderGraphSnapshot,
  hints?: CloudMatchScopeHints,
): string[] {
  const ids = new Set<string>();
  const preferredRouteIds = getPreferredRouteIds(snapshot, hints);

  for (const contextId of hints?.preferredContextIds ?? []) {
    ids.add(contextId);
  }

  if (hints?.contextTerms?.length) {
    for (const contextId of resolveScopeIds(
      snapshot,
      "context",
      hints.contextTerms,
      preferredRouteIds.length > 0 ? preferredRouteIds : undefined,
    )) {
      ids.add(contextId);
    }
  }

  if (snapshot.runtime.activeContextId) {
    ids.add(snapshot.runtime.activeContextId);
  }

  return [...ids];
}

function findScopedNodeByTerms(
  snapshot: CinderGraphSnapshot,
  type: CinderGraphNode["type"],
  terms: Array<unknown>,
  hints?: CloudMatchScopeHints,
): CloudMatchResult {
  const normalizedTerms = getNormalizedTerms(...terms);

  if (normalizedTerms.length === 0) {
    return {};
  }

  const explicitRouteIds = getExplicitRouteIds(snapshot, hints);
  const explicitContextIds = getExplicitContextIds(snapshot, hints);
  const preferredRouteIds = getPreferredRouteIds(snapshot, hints);
  const preferredContextIds = getPreferredContextIds(snapshot, hints);

  const candidates = getNodesByType(snapshot, type)
    .map((node) => {
      const baseScore = Math.max(...normalizedTerms.map((term) => matchesNodeTerm(node, term)));

      if (baseScore <= 0) {
        return undefined;
      }

      let score = baseScore;

      if (explicitContextIds.some((contextId) => node.contextId === contextId)) {
        score += 80;
      }

      if (explicitRouteIds.some((routeId) => matchesRouteId(node, routeId))) {
        score += 60;
      }

      if (
        explicitContextIds.length === 0 &&
        explicitRouteIds.length === 0 &&
        preferredContextIds.some((contextId) => node.contextId === contextId)
      ) {
        score += 40;
      }

      if (explicitRouteIds.length === 0 && preferredRouteIds.some((routeId) => matchesRouteId(node, routeId))) {
        score += 25;
      }

      if (
        explicitContextIds.length === 0 &&
        explicitRouteIds.length === 0 &&
        snapshot.runtime.activeContextId &&
        node.contextId === snapshot.runtime.activeContextId
      ) {
        score += 20;
      }

      if (
        explicitRouteIds.length === 0 &&
        snapshot.runtime.activeRouteId &&
        matchesRouteId(node, snapshot.runtime.activeRouteId)
      ) {
        score += 10;
      }

      return { node, score };
    })
    .filter((candidate): candidate is { node: CinderGraphNode; score: number } => Boolean(candidate))
    .sort((left, right) => right.score - left.score);

  if (candidates.length === 0) {
    return {};
  }

  const [first, second] = candidates;

  if (first && second && first.score - second.score <= CLOUD_MATCH_AMBIGUITY_DELTA) {
    return { ambiguous: true };
  }

  return { node: first?.node };
}

function getFallbackAuthMode(config: Required<CinderConfig>): CinderFallbackAuthMode {
  return config.ai.apiKey ? "bearer" : "none";
}

function getFallbackProvider(config: Required<CinderConfig>): string {
  return config.ai.provider?.trim() || "custom";
}

function getFallbackTimeoutMs(config: Required<CinderConfig>): number {
  return Number.isFinite(config.ai.timeoutMs) && (config.ai.timeoutMs ?? 0) > 0
    ? Math.max(1, Math.floor(config.ai.timeoutMs!))
    : 10000;
}

function getResponseValue(response: InferIntentResponse): unknown {
  if (response.entities && "value" in response.entities) {
    return response.entities.value;
  }

  if (response.context && "value" in response.context) {
    return response.context.value;
  }

  return undefined;
}

function getNodeTypeForStep(step: CinderResolutionStep): CinderGraphNode["type"] | undefined {
  switch (step.type) {
    case "navigate":
      return "route";
    case "trigger_action":
    case "search":
      return "action";
    case "set_field":
      return "field";
    case "set_filter":
      return "filter";
    case "show_output":
      return "output";
    default:
      return undefined;
  }
}

function normalizeCompositeFlowFromSteps(
  response: InferIntentResponse,
  normalizedInput: CinderResolvedIntent["normalizedInput"],
  source: CinderResolvedIntent["source"],
  confidence: number,
  snapshot: CinderGraphSnapshot,
  responseScopeHints: CloudMatchScopeHints,
): CinderResolvedIntent | undefined {
  const responseSteps = response.steps;

  if (!responseSteps || responseSteps.length === 0) {
    return undefined;
  }

  const normalizedSteps: CinderResolutionStep[] = [];
  const matchedNodeIds: string[] = [];
  let coherentRouteId: string | undefined;
  let coherentContextId: string | undefined;

  for (const responseStep of responseSteps) {
    const nodeType = getNodeTypeForStep(responseStep);

    if (!nodeType || !responseStep.target) {
      return undefined;
    }

    const stepHints: CloudMatchScopeHints = {
      ...responseScopeHints,
      routeIds: coherentRouteId ? [coherentRouteId] : responseScopeHints.routeIds,
      contextIds: coherentContextId ? [coherentContextId] : responseScopeHints.contextIds,
      preferredRouteIds: coherentRouteId ? [coherentRouteId] : responseScopeHints.preferredRouteIds,
      preferredContextIds: coherentContextId ? [coherentContextId] : responseScopeHints.preferredContextIds,
    };

    const match = findScopedNodeByTerms(
      snapshot,
      nodeType,
      [responseStep.target],
      stepHints,
    );

    if (!match.node || match.ambiguous) {
      return undefined;
    }

    const node = match.node;
    coherentRouteId = coherentRouteId ?? node.routeId;
    coherentContextId = coherentContextId ?? node.contextId;
    matchedNodeIds.push(node.id);
    normalizedSteps.push({
      type: responseStep.type,
      target: node.key,
      value: responseStep.value,
    });
  }

  const finalStep = normalizedSteps[normalizedSteps.length - 1];

  return {
    intent: response.intent ?? "composite_flow",
    target: finalStep?.target,
    steps: normalizedSteps,
    confidence,
    source,
    context: {
      ...response.context,
      entities: response.entities,
    },
    matchedNodeIds,
    normalizedInput,
    reason: response.reply,
  };
}

function getResponseScopeHints(
  snapshot: CinderGraphSnapshot,
  response: InferIntentResponse,
): CloudMatchScopeHints {
  const routeTerms = [response.context?.route, response.context?.activeRoute];
  const routeMatch = findScopedNodeByTerms(snapshot, "route", routeTerms);
  const routeIds = routeMatch.node ? [routeMatch.node.id] : undefined;

  const contextTerms = [response.context?.context, response.context?.activeContext];
  const contextMatch = findScopedNodeByTerms(snapshot, "context", contextTerms, {
    routeIds,
    preferredRouteIds: routeIds,
  });
  const contextIds = contextMatch.node ? [contextMatch.node.id] : undefined;

  return {
    routeTerms,
    contextTerms,
    routeIds,
    contextIds,
  };
}

function normalizeInferResponseToIntent(
  response: InferIntentResponse,
  localIntent: CinderResolvedIntent,
  snapshot: CinderGraphSnapshot,
): CinderResolvedIntent | undefined {
  if (!response.intent) {
    return undefined;
  }

  const normalizedInput = localIntent.normalizedInput;
  const source = response.source === "local" || response.source === "hybrid" ? response.source : "cloud";
  const confidence = typeof response.confidence === "number" ? response.confidence : 0.6;
  const responseScopeHints = getResponseScopeHints(snapshot, response);

  if (response.intent === "navigate") {
    const routeMatch = findScopedNodeByTerms(
      snapshot,
      "route",
      [response.target, response.context?.route, response.context?.activeRoute],
      responseScopeHints,
    );

    if (!routeMatch.node || routeMatch.ambiguous) {
      return undefined;
    }

    const route = routeMatch.node;

    return {
      intent: "navigate",
      target: route.key,
      steps: [{ type: "navigate", target: route.key }],
      confidence,
      source,
      context: response.context,
      matchedNodeIds: [route.id],
      normalizedInput,
      reason: response.reply,
    };
  }

  if (response.intent === "trigger_action") {
    const actionMatch = findScopedNodeByTerms(
      snapshot,
      "action",
      [response.target, response.context?.action],
      responseScopeHints,
    );

    if (!actionMatch.node || actionMatch.ambiguous) {
      return undefined;
    }

    const action = actionMatch.node;

    return {
      intent: "trigger_action",
      target: action.key,
      steps: [{ type: "trigger_action", target: action.key }],
      confidence,
      source,
      context: response.context,
      matchedNodeIds: [action.id],
      normalizedInput,
      reason: response.reply,
    };
  }

  if (response.intent === "show_output") {
    const outputMatch = findScopedNodeByTerms(
      snapshot,
      "output",
      [response.target, response.context?.output],
      responseScopeHints,
    );

    if (!outputMatch.node || outputMatch.ambiguous) {
      return undefined;
    }

    const output = outputMatch.node;

    return {
      intent: "show_output",
      target: output.key,
      steps: [{ type: "show_output", target: output.key }],
      confidence,
      source,
      context: response.context,
      matchedNodeIds: [output.id],
      normalizedInput,
      reason: response.reply,
    };
  }

  if (response.intent === "set_field") {
    const fieldMatch = findScopedNodeByTerms(
      snapshot,
      "field",
      [response.target, response.context?.field],
      responseScopeHints,
    );
    const value = getResponseValue(response);

    if (!fieldMatch.node || fieldMatch.ambiguous || typeof value === "undefined") {
      return undefined;
    }

    const field = fieldMatch.node;

    return {
      intent: "set_field",
      target: field.key,
      value,
      steps: [{ type: "set_field", target: field.key, value }],
      confidence,
      source,
      context: response.context,
      matchedNodeIds: [field.id],
      normalizedInput,
      reason: response.reply,
    };
  }

  if (response.intent === "set_filter") {
    const filterMatch = findScopedNodeByTerms(
      snapshot,
      "filter",
      [response.target, response.context?.filter],
      responseScopeHints,
    );
    const value = getResponseValue(response);

    if (!filterMatch.node || filterMatch.ambiguous || typeof value === "undefined") {
      return undefined;
    }

    const filter = filterMatch.node;

    return {
      intent: "set_filter",
      target: filter.key,
      value,
      steps: [{ type: "set_filter", target: filter.key, value }],
      confidence,
      source,
      context: response.context,
      matchedNodeIds: [filter.id],
      normalizedInput,
      reason: response.reply,
    };
  }

  if (response.intent === "composite_flow") {
    return normalizeCompositeFlowFromSteps(
      response,
      normalizedInput,
      source,
      confidence,
      snapshot,
      responseScopeHints,
    );
  }

  return undefined;
}

export interface CinderLlmInferResult {
  intent?: CinderResolvedIntent;
  meta: CinderFallbackResultMeta;
}

export interface CinderLlmCore {
  infer(
    input: string,
    localIntent: CinderResolvedIntent,
    snapshot: CinderGraphSnapshot,
    config: Required<CinderConfig>,
    runtimeContext?: CinderRuntimeContext,
  ): Promise<CinderLlmInferResult | undefined>;
}

function createFallbackMeta(
  config: Required<CinderConfig>,
  localIntent: CinderResolvedIntent,
): Omit<CinderFallbackResultMeta, "latencyMs" | "normalized" | "used"> {
  return {
    endpoint: config.ai.endpoint ?? "",
    provider: getFallbackProvider(config),
    authMode: getFallbackAuthMode(config),
    timeoutMs: getFallbackTimeoutMs(config),
    reason: getFallbackReason(config, localIntent) ?? "unknown_intent",
  };
}

function createErrorMeta(
  base: Omit<CinderFallbackResultMeta, "latencyMs" | "normalized" | "used">,
  latencyMs: number,
  errorCode: CinderFallbackErrorCode,
  errorMessage?: string,
  statusCode?: number,
  normalized = false,
): CinderFallbackResultMeta {
  return {
    ...base,
    latencyMs,
    statusCode,
    normalized,
    used: false,
    errorCode,
    errorMessage,
  };
}

export function createLlmCore(): CinderLlmCore {
  return {
    async infer(input, localIntent, snapshot, config, runtimeContext) {
      if (!shouldUseCloudFallback(config, localIntent)) {
        return undefined;
      }

      const endpoint = config.ai.endpoint;

      if (!endpoint) {
        return undefined;
      }

      const request = buildInferRequest(input, snapshot, config, runtimeContext);
      const baseMeta = createFallbackMeta(config, localIntent);
      const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined;
      const startedAt = Date.now();
      const timeoutId = controller
        ? setTimeout(() => controller.abort(), baseMeta.timeoutMs)
        : undefined;

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(config.ai.apiKey
              ? {
                  authorization: `Bearer ${config.ai.apiKey}`,
                }
              : {}),
          },
          body: JSON.stringify(request),
          signal: controller?.signal,
        });

        const latencyMs = Date.now() - startedAt;

        if (!response.ok) {
          return {
            meta: createErrorMeta(
              baseMeta,
              latencyMs,
              "http_error",
              response.statusText || `HTTP ${response.status}`,
              response.status,
            ),
          };
        }

        const payload = normalizeInferIntentResponse(await response.json());
        if (!payload) {
          return {
            meta: createErrorMeta(
              baseMeta,
              latencyMs,
              "invalid_response",
              "Provider returned an invalid infer response.",
              response.status,
            ),
          };
        }

        if (payload.intent === null) {
          return {
            meta: createErrorMeta(
              baseMeta,
              latencyMs,
              "no_intent",
              payload.reply || "Provider returned no intent.",
              response.status,
              true,
            ),
          };
        }

        const normalizedIntent = normalizeInferResponseToIntent(payload, localIntent, snapshot);
        if (!normalizedIntent) {
          return {
            meta: createErrorMeta(
              baseMeta,
              latencyMs,
              "normalization_failed",
              "Provider response could not be grounded to the current graph.",
              response.status,
              true,
            ),
          };
        }

        return {
          intent: normalizedIntent,
          meta: {
            ...baseMeta,
            latencyMs,
            statusCode: response.status,
            normalized: true,
            used: true,
          },
        };
      } catch (error) {
        const latencyMs = Date.now() - startedAt;
        const isAbort = error instanceof Error && error.name === "AbortError";

        return {
          meta: createErrorMeta(
            baseMeta,
            latencyMs,
            isAbort ? "timeout" : "network_error",
            error instanceof Error ? error.message : "Fallback request failed.",
          ),
        };
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    },
  };
}
