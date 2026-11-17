import type {
  CinderBindingHandler,
  CinderBindingType,
  CinderColdGraphCatalog,
  CinderConfig,
  CinderSiteManifest,
  CinderContextProvider,
  CinderDispatchResult,
  CinderDomAdapter,
  CinderGraphSnapshot,
  CinderIntentMatcher,
  CinderReflexHandler,
  CinderReflexOptions,
  CinderReflexResult,
  CinderResolvedIntent,
  CinderRouteDefinition,
  CinderRunResult,
  CinderRuntimeEventHandler,
  CinderRuntimeEventName,
  CinderRuntimeStatus,
  CinderSemanticScanResult,
  CinderSpeechErrorHandler,
  CinderSpeechListenOptions,
  CinderSpeechListenResult,
  CinderSpeechStatus,
  CinderSpeechTranscriptHandler,
} from "./types.js";
import { CinderSemanticRuntime } from "./core/csr/csrRuntime.js";
import type { CinderLlmCore } from "./core/ai/llmCore.js";

const runtime = new CinderSemanticRuntime();

export const Cinder = {
  init(config?: CinderConfig): Promise<void> {
    return runtime.init(config);
  },

  configure(config?: CinderConfig): void {
    runtime.configure(config);
  },

  scan(root?: ParentNode | Document): Promise<CinderSemanticScanResult> {
    return runtime.scan(root);
  },

  lastScan(): CinderSemanticScanResult {
    return runtime.getLastScanResult();
  },

  graph(): CinderGraphSnapshot {
    return runtime.graph();
  },

  resolve(input: string): CinderResolvedIntent {
    return runtime.resolve(input);
  },

  dispatch(
    intent: CinderResolvedIntent,
    root?: ParentNode | Document,
  ): Promise<CinderDispatchResult> {
    return runtime.dispatch(intent, root);
  },

  feedback(
    intent: CinderResolvedIntent,
    dispatch?: CinderDispatchResult,
  ): CinderReflexResult {
    return runtime.feedback(intent, dispatch);
  },

  respond(
    intent: CinderResolvedIntent,
    dispatch?: CinderDispatchResult,
    options?: CinderReflexOptions,
  ): Promise<CinderReflexResult> {
    return runtime.respond(intent, dispatch, options);
  },

  run(
    input: string,
    root?: ParentNode | Document,
    options?: CinderReflexOptions,
  ): Promise<CinderRunResult> {
    return runtime.run(input, root, options);
  },

  registerRoute(definition: CinderRouteDefinition): void {
    runtime.registerRoute(definition);
  },

  unregisterRoute(key: string): void {
    runtime.unregisterRoute(key);
  },

  getRoutes(): CinderRouteDefinition[] {
    return runtime.getRoutes();
  },

  registerSiteManifest(manifest: CinderSiteManifest): void {
    runtime.registerSiteManifest(manifest);
  },

  unregisterSiteManifest(id: string): void {
    runtime.unregisterSiteManifest(id);
  },

  getSiteManifests(): CinderSiteManifest[] {
    return runtime.getSiteManifests();
  },

  registerColdGraph(catalog: CinderColdGraphCatalog): void {
    runtime.registerColdGraph(catalog);
  },

  unregisterColdGraph(id: string): void {
    runtime.unregisterColdGraph(id);
  },

  getColdGraphs(): CinderColdGraphCatalog[] {
    return runtime.getColdGraphs();
  },

  registerDomAdapter(adapter: CinderDomAdapter): void {
    runtime.registerDomAdapter(adapter);
  },

  unregisterDomAdapter(id: string): void {
    runtime.unregisterDomAdapter(id);
  },

  getDomAdapters(): CinderDomAdapter[] {
    return runtime.getDomAdapters();
  },

  registerIntent(matcher: CinderIntentMatcher): void {
    runtime.registerIntent(matcher);
  },

  unregisterIntent(id: string): void {
    runtime.unregisterIntent(id);
  },

  getIntents(): CinderIntentMatcher[] {
    return runtime.getIntents();
  },

  setLlmCore(core: CinderLlmCore, options?: { requiresNetwork?: boolean }): void {
    runtime.setLlmCore(core, options);
  },

  resetLlmCore(): void {
    runtime.resetLlmCore();
  },

  setContextProvider(provider: CinderContextProvider): void {
    runtime.setContextProvider(provider);
  },

  clearContextProvider(): void {
    runtime.clearContextProvider();
  },

  getContext(): Promise<Record<string, unknown>> {
    return runtime.getContext();
  },

  on<EventName extends CinderRuntimeEventName>(
    event: EventName,
    handler: CinderRuntimeEventHandler<EventName>,
  ): void {
    runtime.on(event, handler);
  },

  off<EventName extends CinderRuntimeEventName>(
    event: EventName,
    handler: CinderRuntimeEventHandler<EventName>,
  ): void {
    runtime.off(event, handler);
  },

  bind(type: CinderBindingType, key: string, handler: CinderBindingHandler): void {
    runtime.bind(type, key, handler);
  },

  unbind(type: CinderBindingType, key: string): void {
    runtime.unbind(type, key);
  },

  onReflex(handler: CinderReflexHandler): void {
    runtime.onReflex(handler);
  },

  offReflex(handler: CinderReflexHandler): void {
    runtime.offReflex(handler);
  },

  say(text: string): boolean {
    return runtime.say(text);
  },

  listen(options?: CinderSpeechListenOptions): Promise<CinderSpeechListenResult> {
    return runtime.listen(options);
  },

  stopListening(): void {
    runtime.stopListening();
  },

  speechStatus(): CinderSpeechStatus {
    return runtime.speechStatus();
  },

  onTranscript(handler: CinderSpeechTranscriptHandler): void {
    runtime.onTranscript(handler);
  },

  offTranscript(handler: CinderSpeechTranscriptHandler): void {
    runtime.offTranscript(handler);
  },

  onSpeechError(handler: CinderSpeechErrorHandler): void {
    runtime.onSpeechError(handler);
  },

  offSpeechError(handler: CinderSpeechErrorHandler): void {
    runtime.offSpeechError(handler);
  },

  status(): CinderRuntimeStatus {
    return runtime.getStatus();
  },

  destroy(): void {
    runtime.destroy();
  },
};

export { CinderSemanticRuntime } from "./core/csr/csrRuntime.js";
export {
  buildGraphFromScanResult,
  createColdGraphFromSiteManifest,
  createEmptyGraphSnapshot,
  formatGraphDebugSummary,
  getDependenciesOf,
  getDependents,
  getHybridGraphDiagnostics,
  getNavigationTargetOf,
  getNodesAffecting,
  getOutputsAffectedBy,
} from "./core/cag/index.js";
export { createReflexEngine } from "./core/cre/index.js";
export { createDispatcher } from "./core/dispatch/dispatcher.js";
export { createSpeechEngine } from "./core/input/speechEngine.js";
export {
  isCloudFallbackSupported,
  type CinderSpeechCloudFallbackOptions,
} from "./core/input/speechCloudFallback.js";
export { createLlmCore, type CinderLlmCore, type CinderLlmInferResult } from "./core/ai/llmCore.js";
export { auditLabelQuality, type CinderLabelAuditFinding, type CinderLabelQualityIssue } from "./core/tools/labelAudit.js";
export { auditUntaggedElements, type CinderUntaggedElementFinding, type CinderSuggestedTag } from "./core/tools/untaggedElementAudit.js";
export {
  exportGraphForEnrichment,
  type CinderGraphEnrichmentExport,
  type CinderEnrichmentNodeSummary,
  type CinderEnrichmentEdgeSummary,
} from "./core/tools/graphEnrichment.js";
export {
  createGraphQueryEngine,
  getActiveContextNodes,
  getActiveRouteNodes,
  type CinderGraphQueryDiagnostics,
  type CinderGraphQueryEngine,
  type CinderGraphQueryOptions,
} from "./core/cge/index.js";
export {
  createAgriculturePriceFlowIntentMatcher,
  createIntentEngine,
  normalizeInput,
} from "./core/cie/index.js";
export {
  classifyRunOutcome,
  classifyRunResult,
  isUnresolvedIntent,
  type CinderRunOutcome,
  type CinderRunOutcomeOptions,
} from "./core/cie/outcome.js";
export { defaultCinderConfig, mergeConfig } from "./config.js";
export {
  CINDER_TAG_ATTRIBUTE_TO_TYPE,
  CINDER_V1_ATTRIBUTES,
  CINDER_V1_TYPES,
  createEmptySemanticScanResult,
  createTagRecord,
  createTagRecordFromSource,
  createSemanticModule,
  detectDuplicateTagRecords,
  formatSemanticScanDebugSummary,
  getTagTypeForAttribute,
  isCanonicalSemanticKey,
  normalizeOptionalSemanticKey,
  normalizeSemanticKey,
  scanSemanticTree,
  uniqueNormalizedValues,
} from "./core/semantic/index.js";
export type {
  CinderAiConfig,
  CinderAppConfig,
  CinderBindingHandler,
  CinderBindingType,
  CinderColdGraphCatalog,
  CinderColdGraphEdgeDefinition,
  CinderColdGraphNodeDefinition,
  CinderColdGraphNodeRef,
  CinderConfig,
  CinderSiteManifest,
  CinderSiteManifestGroupDefinition,
  CinderSiteManifestNodeDefinition,
  CinderSiteManifestRouteDefinition,
  CinderContextProvider,
  CinderDispatchContext,
  CinderFallbackAuthMode,
  CinderFallbackErrorCode,
  CinderFallbackReason,
  CinderFallbackResultMeta,
  CinderIntentMatcher,
  CinderIntentMatcherContext,
  CinderDomAdapter,
  CinderDomAdapterContext,
  CinderDispatchResult,
  CinderGraphEdge,
  CinderGraphLayerSource,
  CinderGraphNode,
  CinderGraphNodeType,
  CinderGraphQueryCandidate,
  CinderGraphSnapshot,
  CinderHybridGraphDiagnostics,
  CinderNormalizedInput,
  CinderReflexHandler,
  CinderReflexKind,
  CinderReflexOptions,
  CinderReflexResult,
  CinderResolvedIntent,
  CinderRouteDefinition,
  CinderResolutionStep,
  CinderRunResult,
  CinderRuntimeContext,
  CinderRuntimeEventHandler,
  CinderRuntimeEventMap,
  CinderRuntimeEventName,
  CinderRuntimeStatus,
  CinderSemanticConfig,
  CinderSemanticNodeSource,
  CinderSemanticScanEntry,
  CinderSemanticScanResult,
  CinderSemanticScanSummary,
  CinderSemanticSource,
  CinderSemanticWarning,
  CinderSemanticWarningCode,
  CinderSpeechConfig,
  CinderSpeechError,
  CinderSpeechErrorHandler,
  CinderSpeechListenOptions,
  CinderSpeechListenResult,
  CinderSpeechStatus,
  CinderSpeechTranscriptEvent,
  CinderSpeechTranscriptHandler,
  CinderTagAttributeName,
  CinderTagMetadata,
  CinderTagRecord,
  CinderTagRecordResult,
  CinderTagType,
} from "./types.js";
