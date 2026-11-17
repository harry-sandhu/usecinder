// Types shared with @cinder/server and any other consumer of the wire/graph contracts live in
// @cinder/shared, the single source of truth (docs/known-limitations.md #5/#6) - re-exported
// here so every existing "../../types.js" import across this package keeps working unchanged.
// Everything below this block is local to the cinder client package itself (route/cold-graph
// definitions, DOM adapters, speech, fallback telemetry, runtime events) and has no shared
// contract to deduplicate against.
import type {
  CinderAppConfig,
  CinderSpeechConfig,
  CinderSemanticConfig,
  CinderAiConfig,
  CinderConfig,
  CinderTagType,
  CinderTagAttributeName,
  CinderTagMetadata,
  CinderTagRecord,
  CinderSemanticSource,
  CinderSemanticWarningCode,
  CinderSemanticWarning,
  CinderTagRecordResult,
  CinderSemanticNodeSource,
  CinderSemanticScanEntry,
  CinderSemanticScanSummary,
  CinderSemanticScanResult,
  CinderGraphNodeType,
  CinderGraphEdge,
  CinderGraphNode,
  CinderHybridGraphDiagnostics,
  CinderGraphSnapshot,
  CinderNormalizedInput,
  CinderGraphQueryCandidate,
  CinderResolutionStep,
  CinderResolvedIntent,
  CinderBindingType,
  CinderDispatchContext,
  CinderBindingHandler,
  CinderDispatchResult,
  CinderReflexKind,
  CinderReflexOptions,
  CinderReflexResult,
  CinderReflexHandler,
  CinderRunResult,
} from "@cinder/shared";

export type {
  CinderAppConfig,
  CinderSpeechConfig,
  CinderSemanticConfig,
  CinderAiConfig,
  CinderConfig,
  CinderTagType,
  CinderTagAttributeName,
  CinderTagMetadata,
  CinderTagRecord,
  CinderSemanticSource,
  CinderSemanticWarningCode,
  CinderSemanticWarning,
  CinderTagRecordResult,
  CinderSemanticNodeSource,
  CinderSemanticScanEntry,
  CinderSemanticScanSummary,
  CinderSemanticScanResult,
  CinderGraphNodeType,
  CinderGraphEdge,
  CinderGraphNode,
  CinderHybridGraphDiagnostics,
  CinderGraphSnapshot,
  CinderNormalizedInput,
  CinderGraphQueryCandidate,
  CinderResolutionStep,
  CinderResolvedIntent,
  CinderBindingType,
  CinderDispatchContext,
  CinderBindingHandler,
  CinderDispatchResult,
  CinderReflexKind,
  CinderReflexOptions,
  CinderReflexResult,
  CinderReflexHandler,
  CinderRunResult,
};

export type CinderRuntimeStatus = "idle" | "ready" | "destroyed";

export type CinderRuntimeContext = Record<string, unknown>;

export type CinderContextProvider = () =>
  | CinderRuntimeContext
  | Promise<CinderRuntimeContext>;

export interface CinderIntentMatcherContext {
  input: string;
  normalizedInput: CinderNormalizedInput;
  snapshot: CinderGraphSnapshot;
  runtimeContext?: CinderRuntimeContext;
}

export interface CinderIntentMatcher {
  id: string;
  match(context: CinderIntentMatcherContext): CinderResolvedIntent | undefined;
}

export interface CinderRouteDefinition {
  key: string;
  path?: string;
  selector?: string;
  aliases?: string[];
  /**
   * A real, human-facing label for this route - used as the node's label whenever no live
   * tagged DOM element can supply one (e.g. a route only ever reachable via a JS callback, not
   * a real `cinder-route`-tagged element, so there's nothing for the scanner to read an
   * accessible name from). Also used whenever a tagged element IS found but genuinely has no
   * accessible name of its own (no aria-label, no associated <label>) - the developer's single
   * place to supply one without having to touch the tagged element itself. A real tagged
   * element's own accessible name always wins when it has one; this is a fallback, not an
   * override. Found necessary by real testing - see docs/known-limitations.md's label-quality
   * entry for the real case (a CRM's "My profile" page, reachable only via a menu callback).
   */
  label?: string;
  navigate?: () => void | Promise<void>;
  isActive?: () => boolean;
}

export interface CinderColdGraphNodeDefinition {
  type: Exclude<CinderGraphNodeType, "app">;
  key: string;
  label?: string;
  aliases?: string[];
  routeKey?: string;
  contextPath?: string[];
  metadata?: Record<string, unknown>;
}

export interface CinderColdGraphNodeRef {
  type: Exclude<CinderGraphNodeType, "app">;
  key: string;
  routeKey?: string;
  contextPath?: string[];
}

export interface CinderColdGraphEdgeDefinition {
  type:
    | "contains"
    | "scoped_to"
    | "navigates_to"
    | "targets"
    | "relates_to"
    | "displays"
    | "filters"
    | "depends_on";
  from: CinderColdGraphNodeRef;
  to: CinderColdGraphNodeRef;
  metadata?: Record<string, unknown>;
}

export interface CinderColdGraphCatalog {
  id: string;
  nodes: CinderColdGraphNodeDefinition[];
  edges?: CinderColdGraphEdgeDefinition[];
}

export interface CinderSiteManifestNodeDefinition {
  type: Exclude<CinderGraphNodeType, "app" | "route">;
  key: string;
  label?: string;
  aliases?: string[];
  metadata?: Record<string, unknown>;
  children?: CinderSiteManifestNodeDefinition[];
}

export interface CinderSiteManifestRouteDefinition {
  key: string;
  path?: string;
  selector?: string;
  title?: string;
  aliases?: string[];
  metadata?: Record<string, unknown>;
  nodes?: CinderSiteManifestNodeDefinition[];
}

export interface CinderSiteManifestGroupDefinition {
  key: string;
  title: string;
  routeKey?: string;
  aliases?: string[];
  metadata?: Record<string, unknown>;
  memberRouteKeys?: string[];
}

export interface CinderSiteManifest {
  id: string;
  routes: CinderSiteManifestRouteDefinition[];
  groups?: CinderSiteManifestGroupDefinition[];
}

export type CinderGraphLayerSource = "scan" | "route_registry" | "cold_catalog";

export interface CinderDomAdapterContext extends CinderDispatchContext {
  element: Element;
}

export interface CinderDomAdapter {
  id: string;
  match(context: CinderDomAdapterContext): boolean;
  execute(context: CinderDomAdapterContext): boolean | Promise<boolean>;
}

export type CinderSpeechStatus =
  | "idle"
  | "listening"
  | "stopped"
  | "unsupported"
  | "error";

export interface CinderSpeechListenOptions {
  continuous?: boolean;
  interimResults?: boolean;
  lang?: string;
  autoRun?: boolean;
  speakFeedback?: boolean;
  root?: ParentNode | Document;
  /**
   * Set only when speech.engine is "auto" and a self-hosted @cinder/server endpoint is
   * configured (core/csr/csrRuntime.ts derives this from config.ai) - used ONLY when the
   * browser has no native SpeechRecognition at all. See
   * core/input/speechCloudFallback.ts for why this reuses the text tier-3 endpoint rather
   * than a separate config surface.
   */
  cloudFallback?: import("./core/input/speechCloudFallback.js").CinderSpeechCloudFallbackOptions;
}

export interface CinderSpeechTranscriptEvent {
  transcript: string;
  isFinal: boolean;
  timestamp: string;
}

export interface CinderSpeechError {
  code: string;
  message: string;
}

export interface CinderSpeechListenResult {
  ok: boolean;
  status: CinderSpeechStatus;
  message?: string;
}

export type CinderSpeechTranscriptHandler = (
  event: CinderSpeechTranscriptEvent,
) => void | Promise<void>;

export type CinderSpeechErrorHandler = (
  error: CinderSpeechError,
) => void | Promise<void>;

export type CinderFallbackReason = "unknown_intent" | "low_confidence";

export type CinderFallbackAuthMode = "none" | "bearer";

export type CinderFallbackErrorCode =
  | "timeout"
  | "network_error"
  | "http_error"
  | "invalid_response"
  | "no_intent"
  | "normalization_failed"
  /** A local (non-network) llm core, e.g. @cinder/embeddings, failed to load or run its model. */
  | "model_error";

export interface CinderFallbackResultMeta {
  endpoint: string;
  provider: string;
  authMode: CinderFallbackAuthMode;
  timeoutMs: number;
  reason: CinderFallbackReason;
  latencyMs: number;
  statusCode?: number;
  normalized: boolean;
  used: boolean;
  errorCode?: CinderFallbackErrorCode;
  errorMessage?: string;
}

export type CinderRuntimeEventName =
  | "scan:start"
  | "scan:end"
  | "graph:updated"
  | "resolve:start"
  | "resolve:end"
  | "dispatch:start"
  | "dispatch:end"
  | "fallback:start"
  | "fallback:end"
  | "speech:start"
  | "speech:end"
  | "speech:error";

export interface CinderRuntimeEventMap {
  "scan:start": {
    root?: ParentNode | Document;
    reason: "manual" | "mutation";
    timestamp: string;
  };
  "scan:end": {
    root?: ParentNode | Document;
    result: CinderSemanticScanResult;
    reason: "manual" | "mutation";
    durationMs: number;
    mutationRescanCount: number;
    timestamp: string;
  };
  "graph:updated": {
    snapshot: CinderGraphSnapshot;
    reason: "scan" | "dispatch";
    durationMs?: number;
    mutationRescanCount?: number;
    timestamp: string;
  };
  "resolve:start": {
    input: string;
    snapshot: CinderGraphSnapshot;
    timestamp: string;
  };
  "resolve:end": {
    input: string;
    snapshot: CinderGraphSnapshot;
    intent: CinderResolvedIntent;
    timestamp: string;
  };
  "dispatch:start": {
    intent: CinderResolvedIntent;
    root?: ParentNode | Document;
    snapshot: CinderGraphSnapshot;
    timestamp: string;
  };
  "dispatch:end": {
    intent: CinderResolvedIntent;
    root?: ParentNode | Document;
    snapshot: CinderGraphSnapshot;
    result: CinderDispatchResult;
    timestamp: string;
  };
  "fallback:start": {
    input: string;
    localIntent: CinderResolvedIntent;
    snapshot: CinderGraphSnapshot;
    endpoint: string;
    provider: string;
    authMode: CinderFallbackAuthMode;
    timeoutMs: number;
    reason: CinderFallbackReason;
    timestamp: string;
  };
  "fallback:end": {
    input: string;
    localIntent: CinderResolvedIntent;
    snapshot: CinderGraphSnapshot;
    intent?: CinderResolvedIntent;
    endpoint: string;
    provider: string;
    authMode: CinderFallbackAuthMode;
    timeoutMs: number;
    reason: CinderFallbackReason;
    latencyMs: number;
    statusCode?: number;
    normalized: boolean;
    used: boolean;
    errorCode?: CinderFallbackErrorCode;
    errorMessage?: string;
    timestamp: string;
  };
  "speech:start": {
    options?: CinderSpeechListenOptions;
    result: CinderSpeechListenResult;
    timestamp: string;
  };
  "speech:end": {
    status: CinderSpeechStatus;
    timestamp: string;
  };
  "speech:error": {
    error: CinderSpeechError;
    timestamp: string;
  };
}

export type CinderRuntimeEventHandler<EventName extends CinderRuntimeEventName> = (
  payload: CinderRuntimeEventMap[EventName],
) => void | Promise<void>;
