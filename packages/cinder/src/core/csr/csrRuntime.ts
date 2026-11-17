import { mergeConfig } from "../../config.js";
import type {
  CinderBindingHandler,
  CinderBindingType,
  CinderColdGraphCatalog,
  CinderConfig,
  CinderSiteManifest,
  CinderContextProvider,
  CinderDispatchResult,
  CinderDomAdapter,
  CinderFallbackReason,
  CinderGraphSnapshot,
  CinderIntentMatcher,
  CinderReflexHandler,
  CinderReflexOptions,
  CinderReflexResult,
  CinderResolvedIntent,
  CinderRouteDefinition,
  CinderRunResult,
  CinderRuntimeContext,
  CinderRuntimeEventHandler,
  CinderRuntimeEventName,
  CinderRuntimeStatus,
  CinderSemanticScanResult,
  CinderSpeechError,
  CinderSpeechErrorHandler,
  CinderSpeechListenOptions,
  CinderSpeechListenResult,
  CinderSpeechStatus,
  CinderSpeechTranscriptEvent,
  CinderSpeechTranscriptHandler,
} from "../../types.js";
import {
  buildGraphFromScanResult,
  CinderGraphStore,
  createColdGraphFromSiteManifest,
  markSnapshotGraphHot,
  mergeColdGraphCatalogsIntoSnapshot,
  mergeHarvestedRouteReferencesIntoSnapshot,
  mergeRegisteredRoutesIntoSnapshot,
  updateHybridGraphCounts,
} from "../cag/index.js";
import { createGraphQueryEngine } from "../cge/index.js";
import { createIntentEngine } from "../cie/index.js";
import { createReflexEngine } from "../cre/index.js";
import { createDispatcher } from "../dispatch/dispatcher.js";
import { createSpeechEngine } from "../input/speechEngine.js";
import type { CinderSpeechCloudFallbackOptions } from "../input/speechCloudFallback.js";
import { createLlmCore, type CinderLlmCore } from "../ai/llmCore.js";
import { createEventBus } from "../events/eventBus.js";
import { applyResolvedActiveRuntimeState } from "../router/routeState.js";
import { createSemanticModule } from "../semantic/index.js";
import { scanInternalLinkRouteReferences } from "../semantic/referenceScanner.js";

const MUTATION_RESCAN_DEBOUNCE_MS = 80;
const MUTATION_RESCAN_MIN_INTERVAL_MS = 220;
const MUTATION_SUPPRESSION_WINDOW_MS = 140;

/**
 * Whether the local resolution itself is weak enough to warrant escalating at all - unknown
 * intent, or confidence below 0.5. Mode/endpoint/enabled are deliberately NOT checked here;
 * this is the reusable "is tier 1 good enough" judgment, shared by both the network fallback
 * gate below and the swappable llm-core gate in run() (see setLlmCore), so neither has to
 * re-derive it differently.
 */
function getResolutionWeaknessReason(
  localIntent: CinderResolvedIntent,
): CinderFallbackReason | undefined {
  if (localIntent.intent === "unknown") {
    return "unknown_intent";
  }

  if (localIntent.confidence < 0.5) {
    return "low_confidence";
  }

  return undefined;
}

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

  return getResolutionWeaknessReason(localIntent);
}

function shouldAttemptCloudFallback(
  config: Required<CinderConfig>,
  localIntent: CinderResolvedIntent,
): boolean {
  return Boolean(getFallbackReason(config, localIntent));
}

function resolveRuntimeRoot(root?: ParentNode | Document): ParentNode | Document | undefined {
  if (root) {
    return root;
  }

  if (typeof document !== "undefined") {
    return document;
  }

  return undefined;
}

function getOwnerDocument(root?: ParentNode | Document): Document | undefined {
  if (!root) {
    return typeof document !== "undefined" ? document : undefined;
  }

  const candidate = root as ParentNode & {
    nodeType?: number;
    ownerDocument?: Document | null;
    defaultView?: Window | null;
  };

  if (candidate.nodeType === 9) {
    return candidate as unknown as Document;
  }

  return candidate.ownerDocument ?? undefined;
}

function getMutationObserverConstructor(root?: ParentNode | Document): typeof MutationObserver | undefined {
  if (typeof MutationObserver !== "undefined") {
    return MutationObserver;
  }

  const ownerDocument = getOwnerDocument(root);
  return ownerDocument?.defaultView?.MutationObserver;
}

function getObserverTarget(root?: ParentNode | Document): Node | undefined {
  const resolvedRoot = resolveRuntimeRoot(root);
  if (!resolvedRoot) {
    return undefined;
  }

  const candidate = resolvedRoot as ParentNode & { nodeType?: number };
  return typeof candidate.nodeType === "number" ? (resolvedRoot as unknown as Node) : undefined;
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === "object" && value !== null && "then" in value;
}

function normalizeRuntimeContext(context: unknown): CinderRuntimeContext {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return {};
  }

  return { ...(context as Record<string, unknown>) };
}

export class CinderSemanticRuntime {
  private config = mergeConfig();
  private status: CinderRuntimeStatus = "idle";
  private readonly graphStore = new CinderGraphStore();
  private lastScanResult: CinderSemanticScanResult;

  private readonly semantic = createSemanticModule();
  private readonly cge = createGraphQueryEngine();
  private readonly cie = createIntentEngine();
  private readonly cre = createReflexEngine();
  private readonly dispatcher = createDispatcher();
  private readonly speech = createSpeechEngine();
  private llm: CinderLlmCore = createLlmCore();
  /**
   * Whether the currently-installed llm core needs network access. Defaults to true (the
   * safe default): a custom core installed via setLlmCore() without explicitly declaring
   * itself local-safe will NOT run in ai.mode "local" or without an endpoint, same as the
   * built-in HTTP core always required - so installing an unmarked custom core can't
   * accidentally make "local" mode start reaching the network.
   */
  private llmRequiresNetwork = true;
  private readonly events = createEventBus();
  private readonly coldGraphCatalogs = new Map<string, CinderColdGraphCatalog>();
  private readonly siteManifests = new Map<string, CinderSiteManifest>();
  private contextProvider?: CinderContextProvider;
  private cachedContext: CinderRuntimeContext = {};
  private lastRoot?: ParentNode | Document;
  private currentListenOptions?: CinderSpeechListenOptions;
  private mutationObserver?: MutationObserver;
  private mutationRescanTimer?: ReturnType<typeof setTimeout>;
  private mutationSuppressionTimer?: ReturnType<typeof setTimeout>;
  private mutationRescanInFlight = false;
  private mutationRescanQueued = false;
  private suppressedMutationPending = false;
  private suppressMutationsUntil = 0;
  private lastMutationRescanCompletedAt = 0;
  private mutationRescanCount = 0;
  private lastScanDurationMs = 0;
  private lastScanReason: "manual" | "mutation" = "manual";

  constructor() {
    this.lastScanResult = this.semantic.createEmptyScanResult();

    this.speech.onTranscript(async (event) => {
      if (!event.isFinal) {
        return;
      }

      const shouldAutoRun = this.currentListenOptions?.autoRun ?? true;

      if (!shouldAutoRun) {
        return;
      }

      await this.run(
        event.transcript,
        this.currentListenOptions?.root ?? this.lastRoot,
        {
          speak: this.currentListenOptions?.speakFeedback,
        },
      );
    });

    this.speech.onError((error) => {
      this.events.emit("speech:error", {
        error,
        timestamp: new Date().toISOString(),
      });
    });
  }

  private getContextSync(): CinderRuntimeContext {
    if (!this.contextProvider) {
      return this.cachedContext;
    }

    try {
      const value = this.contextProvider();
      if (isPromiseLike(value)) {
        return this.cachedContext;
      }

      this.cachedContext = normalizeRuntimeContext(value);
      return this.cachedContext;
    } catch {
      return this.cachedContext;
    }
  }

  private clearMutationRescanTimer(): void {
    if (!this.mutationRescanTimer) {
      return;
    }

    clearTimeout(this.mutationRescanTimer);
    this.mutationRescanTimer = undefined;
  }

  private clearMutationSuppressionTimer(): void {
    if (!this.mutationSuppressionTimer) {
      return;
    }

    clearTimeout(this.mutationSuppressionTimer);
    this.mutationSuppressionTimer = undefined;
  }

  private stopMutationObservation(): void {
    this.clearMutationRescanTimer();
    this.clearMutationSuppressionTimer();
    this.mutationObserver?.disconnect();
    this.mutationObserver = undefined;
    this.mutationRescanInFlight = false;
    this.mutationRescanQueued = false;
    this.suppressedMutationPending = false;
    this.suppressMutationsUntil = 0;
  }

  private suppressMutationObservation(windowMs = MUTATION_SUPPRESSION_WINDOW_MS): void {
    const nextSuppressionUntil = Date.now() + windowMs;
    this.suppressMutationsUntil = Math.max(this.suppressMutationsUntil, nextSuppressionUntil);

    this.clearMutationSuppressionTimer();
    this.mutationSuppressionTimer = setTimeout(() => {
      this.mutationSuppressionTimer = undefined;

      if (!this.suppressedMutationPending) {
        return;
      }

      this.suppressedMutationPending = false;
      this.scheduleMutationRescan();
    }, Math.max(0, this.suppressMutationsUntil - Date.now()));
  }

  private scheduleMutationRescan(): void {
    if (this.status !== "ready") {
      return;
    }

    if (Date.now() < this.suppressMutationsUntil) {
      this.suppressedMutationPending = true;
      this.suppressMutationObservation();
      return;
    }

    this.clearMutationRescanTimer();
    const earliestAllowedAt = this.lastMutationRescanCompletedAt + MUTATION_RESCAN_MIN_INTERVAL_MS;
    const delayMs = Math.max(MUTATION_RESCAN_DEBOUNCE_MS, earliestAllowedAt - Date.now(), 0);
    this.mutationRescanTimer = setTimeout(() => {
      void this.handleMutationRescan();
    }, delayMs);
  }

  private async handleMutationRescan(): Promise<void> {
    this.mutationRescanTimer = undefined;

    if (this.status !== "ready") {
      return;
    }

    if (this.mutationRescanInFlight) {
      this.mutationRescanQueued = true;
      return;
    }

    this.mutationRescanInFlight = true;

    try {
      await this.performScan(this.lastRoot, "mutation");
      this.lastMutationRescanCompletedAt = Date.now();
    } finally {
      this.mutationRescanInFlight = false;

      if (this.mutationRescanQueued) {
        this.mutationRescanQueued = false;
        this.scheduleMutationRescan();
      }
    }
  }

  private startMutationObservation(root?: ParentNode | Document): void {
    this.stopMutationObservation();

    if (!this.config.semantic.observeMutations) {
      return;
    }

    const observerTarget = getObserverTarget(root ?? this.lastRoot);
    const MutationObserverCtor = getMutationObserverConstructor(root ?? this.lastRoot);

    if (!observerTarget || !MutationObserverCtor) {
      return;
    }

    this.mutationObserver = new MutationObserverCtor(() => {
      if (Date.now() < this.suppressMutationsUntil) {
        this.suppressedMutationPending = true;
        this.suppressMutationObservation();
        return;
      }

      this.scheduleMutationRescan();
    });

    this.mutationObserver.observe(observerTarget, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "id",
        "href",
        "title",
        "placeholder",
        "role",
        "aria-label",
        "aria-current",
        "aria-hidden",
        "hidden",
        "cinder-route",
        "cinder-context",
        "cinder-entity",
        "cinder-field",
        "cinder-filter",
        "cinder-action",
        "cinder-output",
        "cinder-data",
        "data-cinder-path",
        "data-cinder-route-path",
        "data-cinder-route-selector",
      ],
    });
  }

  private refreshMutationObservation(root?: ParentNode | Document): void {
    if (!this.config.semantic.observeMutations) {
      this.stopMutationObservation();
      return;
    }

    this.startMutationObservation(root ?? this.lastRoot);
  }

  private getEffectiveColdGraphs(): CinderColdGraphCatalog[] {
    return [
      ...this.getColdGraphs(),
      ...this.getSiteManifests().map((manifest) => createColdGraphFromSiteManifest(manifest)),
    ];
  }

  private composeSnapshot(root?: ParentNode | Document): CinderGraphSnapshot {
    const snapshot = buildGraphFromScanResult(this.lastScanResult);
    markSnapshotGraphHot(snapshot);
    mergeRegisteredRoutesIntoSnapshot(snapshot, this.getRoutes());
    mergeColdGraphCatalogsIntoSnapshot(snapshot, this.getEffectiveColdGraphs());
    mergeHarvestedRouteReferencesIntoSnapshot(snapshot, scanInternalLinkRouteReferences(root ?? this.lastRoot));
    updateHybridGraphCounts(snapshot);
    applyResolvedActiveRuntimeState(snapshot, this.getRoutes(), root ?? this.lastRoot);
    return snapshot;
  }

  private refreshGraphSnapshot(root?: ParentNode | Document): CinderGraphSnapshot {
    const snapshot = this.composeSnapshot(root);
    snapshot.meta.lastScanDurationMs = this.lastScanDurationMs;
    snapshot.meta.lastScanReason = this.lastScanReason;
    snapshot.meta.mutationRescanCount = this.mutationRescanCount;
    this.graphStore.setSnapshot(snapshot);
    return snapshot;
  }

  private async performScan(
    root?: ParentNode | Document,
    reason: "manual" | "mutation" = "manual",
  ): Promise<CinderSemanticScanResult> {
    const startedAt = Date.now();
    const resolvedRoot = resolveRuntimeRoot(root);
    this.events.emit("scan:start", {
      root: resolvedRoot,
      reason,
      timestamp: new Date().toISOString(),
    });

    this.lastRoot = resolvedRoot;
    this.lastScanResult = this.semantic.scan(resolvedRoot);

    this.lastScanDurationMs = Date.now() - startedAt;
    this.lastScanReason = reason;
    if (reason === "mutation") {
      this.mutationRescanCount += 1;
    }
    const snapshot = this.refreshGraphSnapshot(resolvedRoot);
    this.refreshMutationObservation(resolvedRoot);

    this.events.emit("scan:end", {
      root: resolvedRoot,
      result: this.lastScanResult,
      reason,
      durationMs: this.lastScanDurationMs,
      mutationRescanCount: this.mutationRescanCount,
      timestamp: new Date().toISOString(),
    });
    this.events.emit("graph:updated", {
      snapshot,
      reason: "scan",
      durationMs: this.lastScanDurationMs,
      mutationRescanCount: this.mutationRescanCount,
      timestamp: new Date().toISOString(),
    });

    return this.lastScanResult;
  }

  async init(config?: CinderConfig): Promise<void> {
    this.config = mergeConfig(config);
    this.status = "ready";

    if (this.config.semantic.scanOnInit) {
      await this.performScan(undefined, "manual");
      return;
    }

    this.lastRoot = resolveRuntimeRoot();
    this.refreshGraphSnapshot(this.lastRoot);
    this.refreshMutationObservation(this.lastRoot);
  }

  configure(config?: CinderConfig): void {
    this.config = mergeConfig(config);

    if (this.status === "ready") {
      this.refreshMutationObservation(this.lastRoot);
    }
  }

  async scan(root?: ParentNode | Document): Promise<CinderSemanticScanResult> {
    return this.performScan(root, "manual");
  }

  graph(): CinderGraphSnapshot {
    return this.graphStore.getSnapshot();
  }

  resolve(input: string): CinderResolvedIntent {
    const snapshot = this.graphStore.getSnapshot();
    const runtimeContext = this.getContextSync();
    this.events.emit("resolve:start", {
      input,
      snapshot,
      timestamp: new Date().toISOString(),
    });

    const intent = this.cie.resolve(snapshot, input, this.cge, runtimeContext);

    this.events.emit("resolve:end", {
      input,
      snapshot,
      intent,
      timestamp: new Date().toISOString(),
    });

    return intent;
  }

  async dispatch(
    intent: CinderResolvedIntent,
    root?: ParentNode | Document,
  ): Promise<CinderDispatchResult> {
    const resolvedRoot = root ?? this.lastRoot;
    const snapshot = this.graphStore.getSnapshot();

    this.events.emit("dispatch:start", {
      intent,
      root: resolvedRoot,
      snapshot,
      timestamp: new Date().toISOString(),
    });

    this.suppressMutationObservation();
    const result = await this.dispatcher.dispatch(snapshot, intent, resolvedRoot);
    this.suppressMutationObservation();
    applyResolvedActiveRuntimeState(snapshot, this.getRoutes(), resolvedRoot);
    this.graphStore.setSnapshot(snapshot);

    this.events.emit("dispatch:end", {
      intent,
      root: resolvedRoot,
      snapshot,
      result,
      timestamp: new Date().toISOString(),
    });
    this.events.emit("graph:updated", {
      snapshot,
      reason: "dispatch",
      mutationRescanCount: this.mutationRescanCount,
      timestamp: new Date().toISOString(),
    });

    return result;
  }

  feedback(
    intent: CinderResolvedIntent,
    dispatch?: CinderDispatchResult,
  ): CinderReflexResult {
    return this.cre.format(intent, dispatch);
  }

  async respond(
    intent: CinderResolvedIntent,
    dispatch?: CinderDispatchResult,
    options?: CinderReflexOptions,
  ): Promise<CinderReflexResult> {
    return this.cre.respond(intent, dispatch, options);
  }

  async run(
    input: string,
    root?: ParentNode | Document,
    options?: CinderReflexOptions,
  ): Promise<CinderRunResult> {
    const runtimeContext = await this.getContext();
    const snapshot = this.graphStore.getSnapshot();

    this.events.emit("resolve:start", {
      input,
      snapshot,
      timestamp: new Date().toISOString(),
    });

    const localIntent = this.cie.resolve(snapshot, input, this.cge, runtimeContext);

    this.events.emit("resolve:end", {
      input,
      snapshot,
      intent: localIntent,
      timestamp: new Date().toISOString(),
    });

    const config = this.getConfig();
    const resolutionWeaknessReason = getResolutionWeaknessReason(localIntent);
    // The installed llm core runs when EITHER the existing network-fallback conditions are
    // met (unchanged: ai enabled, mode not "local", an endpoint configured), OR the
    // installed core declared itself local-safe via setLlmCore's requiresNetwork option -
    // in which case it's allowed to run even in "local" mode and without an endpoint, since
    // it makes no network call. A custom core that does NOT declare itself local-safe
    // follows the exact same rules the built-in HTTP core always has, so installing one
    // can't accidentally make "local" mode start reaching the network.
    const networkFallbackAllowed = config.ai.enabled && config.ai.mode !== "local" && Boolean(config.ai.endpoint);
    const localSafeFallbackAllowed = config.ai.enabled && !this.llmRequiresNetwork;
    const shouldFallback = Boolean(resolutionWeaknessReason) && (networkFallbackAllowed || localSafeFallbackAllowed);
    const fallbackReason = shouldFallback ? resolutionWeaknessReason : undefined;

    let inferredIntent: CinderResolvedIntent | undefined;

    if (shouldFallback && fallbackReason) {
      this.events.emit("fallback:start", {
        input,
        localIntent,
        snapshot,
        endpoint: config.ai.endpoint ?? "",
        provider: config.ai.provider ?? "custom",
        authMode: config.ai.apiKey ? "bearer" : "none",
        timeoutMs: config.ai.timeoutMs ?? 10000,
        reason: fallbackReason,
        timestamp: new Date().toISOString(),
      });

      const fallbackResult = await this.llm.infer(
        input,
        localIntent,
        snapshot,
        config,
        runtimeContext,
      );

      inferredIntent = fallbackResult?.intent;

      if (fallbackResult) {
        this.events.emit("fallback:end", {
          input,
          localIntent,
          snapshot,
          intent: fallbackResult.intent,
          endpoint: fallbackResult.meta.endpoint,
          provider: fallbackResult.meta.provider,
          authMode: fallbackResult.meta.authMode,
          timeoutMs: fallbackResult.meta.timeoutMs,
          reason: fallbackResult.meta.reason,
          latencyMs: fallbackResult.meta.latencyMs,
          statusCode: fallbackResult.meta.statusCode,
          normalized: fallbackResult.meta.normalized,
          used: fallbackResult.meta.used,
          errorCode: fallbackResult.meta.errorCode,
          errorMessage: fallbackResult.meta.errorMessage,
          timestamp: new Date().toISOString(),
        });
      }
    }

    const intent = inferredIntent ?? localIntent;

    const dispatch = await this.dispatch(intent, root);
    const reflex = await this.respond(intent, dispatch, options);

    return {
      intent,
      dispatch,
      reflex,
    };
  }

  /**
   * Wires up CinderSpeechConfig.engine's "auto" value (docs/known-limitations.md #3): reuses
   * the SAME self-hosted @cinder/server endpoint already configured for text tier-3 fallback
   * (config.ai), never a separate config surface - an app that already works for text
   * fallback gets speech fallback for free by setting speech.engine to "auto". Returns
   * undefined (no fallback offered) when engine is explicitly "browser", or when no endpoint
   * is configured at all - speechEngine.ts only reaches for this when the browser itself has
   * no native SpeechRecognition.
   */
  private resolveSpeechCloudFallback(): CinderSpeechCloudFallbackOptions | undefined {
    if (this.config.speech.engine === "browser" || !this.config.ai.endpoint) {
      return undefined;
    }

    return {
      endpoint: this.config.ai.endpoint,
      apiKey: this.config.ai.apiKey || undefined,
      timeoutMs: this.config.ai.timeoutMs,
    };
  }

  async listen(options?: CinderSpeechListenOptions): Promise<CinderSpeechListenResult> {
    this.currentListenOptions = options;

    if (options?.root) {
      this.lastRoot = options.root;
      this.refreshMutationObservation(this.lastRoot);
    }

    const result = await this.speech.start({
      continuous: options?.continuous,
      interimResults: options?.interimResults,
      lang: options?.lang ?? this.config.speech.lang,
      autoRun: options?.autoRun,
      speakFeedback: options?.speakFeedback,
      root: options?.root,
      cloudFallback: this.resolveSpeechCloudFallback(),
    });

    this.events.emit("speech:start", {
      options,
      result,
      timestamp: new Date().toISOString(),
    });

    if (!result.ok) {
      this.events.emit("speech:end", {
        status: result.status,
        timestamp: new Date().toISOString(),
      });
    }

    return result;
  }

  stopListening(): void {
    this.speech.stop();
    this.events.emit("speech:end", {
      status: this.speech.getStatus(),
      timestamp: new Date().toISOString(),
    });
  }

  speechStatus(): CinderSpeechStatus {
    return this.speech.getStatus();
  }

  onTranscript(handler: CinderSpeechTranscriptHandler): void {
    this.speech.onTranscript(handler);
  }

  offTranscript(handler: CinderSpeechTranscriptHandler): void {
    this.speech.offTranscript(handler);
  }

  onSpeechError(handler: CinderSpeechErrorHandler): void {
    this.speech.onError(handler);
  }

  offSpeechError(handler: CinderSpeechErrorHandler): void {
    this.speech.offError(handler);
  }

  registerRoute(definition: CinderRouteDefinition): void {
    this.dispatcher.registerRoute(definition);

    if (this.status === "ready") {
      this.refreshGraphSnapshot(this.lastRoot);
    }
  }

  unregisterRoute(key: string): void {
    this.dispatcher.unregisterRoute(key);

    if (this.status === "ready") {
      this.refreshGraphSnapshot(this.lastRoot);
    }
  }

  getRoutes(): CinderRouteDefinition[] {
    return this.dispatcher.getRoutes();
  }

  registerSiteManifest(manifest: CinderSiteManifest): void {
    this.siteManifests.set(manifest.id, manifest);

    if (this.status === "ready") {
      this.refreshGraphSnapshot(this.lastRoot);
    }
  }

  unregisterSiteManifest(id: string): void {
    this.siteManifests.delete(id);

    if (this.status === "ready") {
      this.refreshGraphSnapshot(this.lastRoot);
    }
  }

  getSiteManifests(): CinderSiteManifest[] {
    return [...this.siteManifests.values()];
  }

  registerColdGraph(catalog: CinderColdGraphCatalog): void {
    this.coldGraphCatalogs.set(catalog.id, catalog);

    if (this.status === "ready") {
      this.refreshGraphSnapshot(this.lastRoot);
    }
  }

  unregisterColdGraph(id: string): void {
    this.coldGraphCatalogs.delete(id);

    if (this.status === "ready") {
      this.refreshGraphSnapshot(this.lastRoot);
    }
  }

  getColdGraphs(): CinderColdGraphCatalog[] {
    return [...this.coldGraphCatalogs.values()];
  }

  registerDomAdapter(adapter: CinderDomAdapter): void {
    this.dispatcher.registerDomAdapter(adapter);
  }

  unregisterDomAdapter(id: string): void {
    this.dispatcher.unregisterDomAdapter(id);
  }

  getDomAdapters(): CinderDomAdapter[] {
    return this.dispatcher.getDomAdapters();
  }

  registerIntent(matcher: CinderIntentMatcher): void {
    this.cie.registerIntent(matcher);
  }

  unregisterIntent(id: string): void {
    this.cie.unregisterIntent(id);
  }

  getIntents(): CinderIntentMatcher[] {
    return this.cie.getIntents();
  }

  /**
   * Swaps the single installed llm-core slot that run() escalates to when local resolution
   * is unknown or low-confidence (see getResolutionWeaknessReason). The default is the
   * built-in HTTP core (createLlmCore()); this lets a different implementation - e.g. a
   * client-side embedding model, or a chain of local-then-cloud cores - take that slot
   * instead, without any other part of the resolve/dispatch/respond pipeline changing.
   *
   * `requiresNetwork` defaults to true (the safe default - see the field doc comment on
   * `llmRequiresNetwork`): a core that doesn't explicitly declare itself local-safe follows
   * the exact same mode/endpoint gating the built-in HTTP core always has, so swapping in an
   * unmarked custom core can't accidentally make ai.mode "local" start reaching the network.
   */
  setLlmCore(core: CinderLlmCore, options?: { requiresNetwork?: boolean }): void {
    this.llm = core;
    this.llmRequiresNetwork = options?.requiresNetwork ?? true;
  }

  /** Restores the default built-in HTTP llm core, undoing a prior setLlmCore() call. */
  resetLlmCore(): void {
    this.llm = createLlmCore();
    this.llmRequiresNetwork = true;
  }

  setContextProvider(provider: CinderContextProvider): void {
    this.contextProvider = provider;
    void this.getContext();
  }

  clearContextProvider(): void {
    this.contextProvider = undefined;
    this.cachedContext = {};
  }

  async getContext(): Promise<CinderRuntimeContext> {
    if (!this.contextProvider) {
      this.cachedContext = {};
      return this.cachedContext;
    }

    try {
      const value = this.contextProvider();
      const resolved = isPromiseLike(value) ? await value : value;
      this.cachedContext = normalizeRuntimeContext(resolved);
      return this.cachedContext;
    } catch {
      return this.cachedContext;
    }
  }

  on<EventName extends CinderRuntimeEventName>(
    event: EventName,
    handler: CinderRuntimeEventHandler<EventName>,
  ): void {
    this.events.on(event, handler);
  }

  off<EventName extends CinderRuntimeEventName>(
    event: EventName,
    handler: CinderRuntimeEventHandler<EventName>,
  ): void {
    this.events.off(event, handler);
  }

  bind(type: CinderBindingType, key: string, handler: CinderBindingHandler): void {
    this.dispatcher.bind(type, key, handler);
  }

  unbind(type: CinderBindingType, key: string): void {
    this.dispatcher.unbind(type, key);
  }

  onReflex(handler: CinderReflexHandler): void {
    this.cre.bind(handler);
  }

  offReflex(handler: CinderReflexHandler): void {
    this.cre.unbind(handler);
  }

  say(text: string): boolean {
    return this.cre.say(text);
  }

  getLastScanResult(): CinderSemanticScanResult {
    return this.lastScanResult;
  }

  getConfig(): Required<CinderConfig> {
    return this.config;
  }

  getStatus(): CinderRuntimeStatus {
    return this.status;
  }

  destroy(): void {
    this.stopMutationObservation();
    this.coldGraphCatalogs.clear();
    this.siteManifests.clear();
    this.graphStore.reset();
    this.status = "destroyed";
  }

  getInternals() {
    return {
      semantic: this.semantic,
      cge: this.cge,
      cie: this.cie,
      cre: this.cre,
      dispatcher: this.dispatcher,
      speech: this.speech,
      llm: this.llm,
    };
  }
}
