import type { CinderGraphNodeType, CinderInferGraphNodeDetail, CinderInferGraphSummary } from "../graph/index.js";
import type { CinderResolutionStep } from "../intents/index.js";

const GRAPH_NODE_TYPES: ReadonlySet<CinderGraphNodeType> = new Set([
  "app",
  "route",
  "context",
  "entity",
  "field",
  "filter",
  "action",
  "output",
  "data",
]);

export interface InferIntentRequest {
  text: string;
  context?: Record<string, unknown>;
  graph?: CinderInferGraphSummary;
  app?: {
    name?: string;
    route?: string;
    version?: string;
  };
  session?: {
    id?: string;
    locale?: string;
  };
  options?: {
    temperature?: number;
    generateReply?: boolean;
  };
}

export interface InferIntentResponse {
  intent: string | null;
  target?: string | null;
  confidence?: number;
  entities?: Record<string, unknown>;
  context?: Record<string, unknown>;
  steps?: CinderResolutionStep[];
  reply?: string;
  source: "local" | "cloud" | "hybrid";
}

export interface LLMAdapter {
  infer(input: InferIntentRequest): Promise<InferIntentResponse>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .map((item) => normalizeString(item))
    .filter((item): item is string => Boolean(item));

  return normalized.length > 0 ? [...new Set(normalized)] : undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeRecord(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return { ...value };
}

function normalizeStepType(value: unknown): CinderResolutionStep["type"] | undefined {
  return value === "navigate" ||
    value === "trigger_action" ||
    value === "set_field" ||
    value === "set_filter" ||
    value === "show_output" ||
    value === "search"
    ? value
    : undefined;
}

function normalizeSteps(value: unknown): CinderResolutionStep[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized: CinderResolutionStep[] = [];

  for (const rawStep of value) {
    if (!isRecord(rawStep)) {
      continue;
    }

    const type = normalizeStepType(rawStep.type);
    if (!type) {
      continue;
    }

    const step: CinderResolutionStep = {
      type,
    };

    const target = normalizeString(rawStep.target);
    if (target) {
      step.target = target;
    }

    if ("value" in rawStep) {
      step.value = rawStep.value;
    }

    normalized.push(step);
  }

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeConfidence(value: unknown, intent: string | null): number | undefined {
  const normalized = normalizeNumber(value);

  if (typeof normalized === "number") {
    return Math.max(0, Math.min(1, normalized));
  }

  return intent ? 0.6 : 0;
}

function normalizeGraphNodeType(value: unknown): CinderGraphNodeType | undefined {
  return typeof value === "string" && GRAPH_NODE_TYPES.has(value as CinderGraphNodeType)
    ? (value as CinderGraphNodeType)
    : undefined;
}

function normalizeNodeDetails(value: unknown): CinderInferGraphNodeDetail[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized: CinderInferGraphNodeDetail[] = [];

  for (const rawDetail of value) {
    if (!isRecord(rawDetail)) {
      continue;
    }

    const key = normalizeString(rawDetail.key);
    const type = normalizeGraphNodeType(rawDetail.type);

    if (!key || !type) {
      continue;
    }

    const detail: CinderInferGraphNodeDetail = { key, type };

    const label = normalizeString(rawDetail.label);
    if (label) {
      detail.label = label;
    }

    const contextPath = normalizeStringArray(rawDetail.contextPath);
    if (contextPath) {
      detail.contextPath = contextPath;
    }

    const routeKey = normalizeString(rawDetail.routeKey);
    if (routeKey) {
      detail.routeKey = routeKey;
    }

    const navigatesTo = normalizeString(rawDetail.navigatesTo);
    if (navigatesTo) {
      detail.navigatesTo = navigatesTo;
    }

    normalized.push(detail);
  }

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeGraphSummary(value: unknown): CinderInferGraphSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const graph: CinderInferGraphSummary = {};

  const activeRoute = normalizeString(value.activeRoute);
  if (activeRoute) {
    graph.activeRoute = activeRoute;
  }

  const activeContext = normalizeString(value.activeContext);
  if (activeContext) {
    graph.activeContext = activeContext;
  }

  const routes = normalizeStringArray(value.routes);
  if (routes) {
    graph.routes = routes;
  }

  const contexts = normalizeStringArray(value.contexts);
  if (contexts) {
    graph.contexts = contexts;
  }

  const entities = normalizeStringArray(value.entities);
  if (entities) {
    graph.entities = entities;
  }

  const fields = normalizeStringArray(value.fields);
  if (fields) {
    graph.fields = fields;
  }

  const filters = normalizeStringArray(value.filters);
  if (filters) {
    graph.filters = filters;
  }

  const actions = normalizeStringArray(value.actions);
  if (actions) {
    graph.actions = actions;
  }

  const outputs = normalizeStringArray(value.outputs);
  if (outputs) {
    graph.outputs = outputs;
  }

  const dataSources = normalizeStringArray(value.dataSources);
  if (dataSources) {
    graph.dataSources = dataSources;
  }

  const selections = normalizeRecord(value.selections);
  if (selections) {
    graph.selections = selections;
  }

  const nodeDetails = normalizeNodeDetails(value.nodeDetails);
  if (nodeDetails) {
    graph.nodeDetails = nodeDetails;
  }

  return Object.keys(graph).length > 0 ? graph : undefined;
}

export function normalizeInferIntentRequest(value: unknown): InferIntentRequest | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const text = normalizeString(value.text);

  if (!text) {
    return undefined;
  }

  const request: InferIntentRequest = {
    text,
  };

  const context = normalizeRecord(value.context);
  if (context) {
    request.context = context;
  }

  const graph = normalizeGraphSummary(value.graph);
  if (graph) {
    request.graph = graph;
  }

  if (isRecord(value.app)) {
    const app = {
      name: normalizeString(value.app.name),
      route: normalizeString(value.app.route),
      version: normalizeString(value.app.version),
    };

    if (app.name || app.route || app.version) {
      request.app = app;
    }
  }

  if (isRecord(value.session)) {
    const session = {
      id: normalizeString(value.session.id),
      locale: normalizeString(value.session.locale),
    };

    if (session.id || session.locale) {
      request.session = session;
    }
  }

  if (isRecord(value.options)) {
    const options = {
      temperature: normalizeNumber(value.options.temperature),
      generateReply:
        typeof value.options.generateReply === "boolean"
          ? value.options.generateReply
          : undefined,
    };

    if (
      typeof options.temperature === "number" ||
      typeof options.generateReply === "boolean"
    ) {
      request.options = options;
    }
  }

  return request;
}

export function isInferIntentRequest(value: unknown): value is InferIntentRequest {
  return Boolean(normalizeInferIntentRequest(value));
}

export function normalizeInferIntentResponse(value: unknown): InferIntentResponse | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const rawIntent = value.intent;
  const intent = rawIntent === null ? null : normalizeString(rawIntent) ?? null;
  const source =
    value.source === "local" || value.source === "cloud" || value.source === "hybrid"
      ? value.source
      : "cloud";

  const response: InferIntentResponse = {
    intent,
    confidence: normalizeConfidence(value.confidence, intent),
    source,
  };

  if (rawIntent !== null && typeof rawIntent !== "string") {
    return undefined;
  }

  if (value.target === null) {
    response.target = null;
  } else {
    const target = normalizeString(value.target);
    if (target) {
      response.target = target;
    }
  }

  const entities = normalizeRecord(value.entities);
  if (entities) {
    response.entities = entities;
  }

  const context = normalizeRecord(value.context);
  if (context) {
    response.context = context;
  }

  const steps = normalizeSteps(value.steps);
  if (steps) {
    response.steps = steps;
  }

  const reply = normalizeString(value.reply);
  if (reply) {
    response.reply = reply;
  }

  return response;
}
