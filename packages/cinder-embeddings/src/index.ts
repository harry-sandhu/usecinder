import type {
  CinderFallbackResultMeta,
  CinderGraphNode,
  CinderGraphSnapshot,
  CinderLlmCore,
  CinderLlmInferResult,
  CinderResolutionStep,
  CinderResolvedIntent,
} from "usecinder";
import { classifyMatchOutcome, rankCandidates, type EmbeddingCandidate } from "./similarity.js";
import { pickTiebreakCandidate } from "./reranker.js";
import {
  extractShape,
  findOfferedOption,
  getFieldAndFilterNodes,
  hasValueCommandSignal,
  isSearchLikeField,
  matchFieldPhrase,
} from "./valueExtraction.js";
import { extractValueByQuestionAnswering } from "./qaValueExtraction.js";

export { resetEmbedderForTests } from "./model.js";
export { resetRerankerForTests, scoreTextPair, CROSS_ENCODER_MIN_GAP } from "./reranker.js";
export { resetQaPipelineForTests } from "./qaValueExtraction.js";
export {
  prefetchEmbeddingModel,
  shouldSkipPrefetchForConnection,
  type CinderEmbeddingPrefetchOptions,
} from "./prefetch.js";
export { createSemanticCachingLlmCore, type CinderSemanticCacheOptions } from "./semanticCache.js";
export { createAliasLearningLlmCore, type CinderAliasLearningOptions } from "./aliasLearning.js";

export interface CinderEmbeddingFallbackOptions {
  /** Minimum absolute cosine similarity to even consider the top candidate. Default 0.5. */
  minScore?: number;
  /**
   * Minimum gap between the top and second-best candidate's score to treat the top one as
   * confident rather than ambiguous. Default 0.08 - same spirit as cinder core's own
   * isAmbiguous gap-check (shared.ts), tuned separately since embedding-similarity scores
   * and the graph engine's own 0-100 match scores aren't on the same scale.
   */
  minGap?: number;
  /**
   * Whether to escalate a genuine near-tie to the constrained cross-encoder tiebreak step
   * (reranker.ts) instead of just reporting not_resolved. Default false - opt-in, since this
   * pulls in a second small model (~23MB, see reranker.ts's doc comment for why a
   * cross-encoder replaced the originally-planned generative model) that most apps installing
   * @cinder/embeddings for its primary job (recovering typos/paraphrases) will never need.
   */
  enableTiebreaker?: boolean;
  /** How many top candidates to present to the tiebreak step when escalating. Default 3. */
  maxAmbiguousCandidates?: number;
}

const DEFAULT_MIN_SCORE = 0.5;
const DEFAULT_MIN_GAP = 0.08;
const DEFAULT_MAX_AMBIGUOUS_CANDIDATES = 3;

/** The confidence ceiling for a tier-2 match - deliberately below the 0.85 resolved_exact
 * threshold (classifyRunResult, core/cie/outcome.ts): a similarity match is, by nature, a
 * best guess among known candidates, never full certainty, so it should never classify as
 * resolved_exact even when the similarity score itself is very high. */
const CONFIDENCE_CEILING = 0.84;
const CONFIDENCE_FLOOR = 0.3;

/**
 * A tiebreak-arbitrated pick is reported at a fixed, modest confidence rather than derived
 * from the embedding score that was ALREADY too close to call on its own merits (that's
 * exactly why it needed arbitration) - lower than a clean embedding win
 * (mapScoreToConfidence), but still above the floor, since a dedicated cross-encoder model
 * scored it a clear winner over the alternative(s), which is more considered than a coin-flip.
 */
const TIEBREAK_PICK_CONFIDENCE = 0.55;

function mapScoreToConfidence(score: number): number {
  return Math.min(CONFIDENCE_CEILING, Math.max(CONFIDENCE_FLOOR, score));
}

function buildStepForNode(node: CinderGraphNode): { intent: string; step: CinderResolutionStep } | undefined {
  switch (node.type) {
    case "route":
      return { intent: "navigate", step: { type: "navigate", target: node.key } };
    case "output":
      return { intent: "show_output", step: { type: "show_output", target: node.key } };
    case "action":
      return { intent: "trigger_action", step: { type: "trigger_action", target: node.key } };
    default:
      // Deliberately unreachable in practice - similarity.ts's CANDIDATE_TYPES only ever
      // ranks route/output/action nodes (see its own doc comment for why field/filter are
      // out of scope for this phase). Returning undefined here is the honest fallback if
      // that ever changes without this function being updated alongside it.
      return undefined;
  }
}

function buildMeta(
  reason: CinderFallbackResultMeta["reason"],
  latencyMs: number,
  used: boolean,
): CinderFallbackResultMeta {
  return {
    endpoint: "",
    provider: "cinder-embeddings",
    authMode: "none",
    timeoutMs: 0,
    reason,
    latencyMs,
    normalized: true,
    used,
  };
}

/**
 * Tier 2: a client-side embedding model (all-MiniLM-L6-v2 via Transformers.js, WebGPU with
 * automatic CPU/WASM fallback) that recovers typos/paraphrases of a page's own
 * route/output/action nodes - the cases tier 1's deterministic graph engine couldn't resolve
 * - before any network call. Install it via Cinder.setLlmCore(createEmbeddingLlmCore(), {
 * requiresNetwork: false }).
 *
 * Phase 1 scope, deliberately: route/output/action only, not field/filter (see
 * similarity.ts's CANDIDATE_TYPES doc comment). Never claims resolved_exact confidence (see
 * CONFIDENCE_CEILING) - this is always a best-guess-among-known-candidates signal, reported
 * honestly as such.
 */
function intentFromCandidate(
  candidate: EmbeddingCandidate,
  confidence: number,
  normalizedInput: CinderResolvedIntent["normalizedInput"],
  reasonSuffix: string,
): CinderResolvedIntent | undefined {
  const built = buildStepForNode(candidate.node);

  if (!built) {
    return undefined;
  }

  return {
    intent: built.intent,
    target: candidate.node.key,
    confidence,
    source: "embedding",
    normalizedInput,
    matchedNodeIds: [candidate.node.id],
    steps: [built.step],
    reason: `Matched "${candidate.node.key}" ${reasonSuffix} after local graph resolution failed.`,
  };
}

const FIELD_MATCH_MIN_GAP = 40;

/**
 * Tier 2's value-extraction path for set_field/set_filter commands - see
 * valueExtraction.ts's module doc comment for why tier 1 alone can't handle these once a
 * filler word precedes the verb. Two stages, cheapest first: compromise.js's grammar-shape
 * match (no model, near-instant) is tried before the extractive-QA model (qaValueExtraction.ts,
 * a real inference call per candidate) - the QA stage only runs when the cheap stage found
 * nothing usable, exactly the same "escalate only when needed" shape as the route/action
 * embedding-then-cross-encoder-tiebreak flow below.
 */
async function tryExtractValueIntent(
  input: string,
  snapshot: CinderGraphSnapshot,
  normalizedInput: CinderResolvedIntent["normalizedInput"],
): Promise<CinderResolvedIntent | undefined> {
  const shape = extractShape(input);
  const candidates = getFieldAndFilterNodes(snapshot);

  if (candidates.length === 0) {
    return undefined;
  }

  if (shape?.kind === "named-field") {
    const matches = matchFieldPhrase(shape.fieldPhrase, candidates);
    const [best, second] = matches;

    if (best && (!second || best.score - second.score >= FIELD_MATCH_MIN_GAP)) {
      const node = best.node;
      const realOptions = (node.metadata as { options?: unknown })?.options;
      const hasEnumeratedOptions = node.type === "filter" && Array.isArray(realOptions) && realOptions.length > 0;
      const matchedOption = hasEnumeratedOptions ? findOfferedOption(node, shape.value) : undefined;

      // The right filter was found, but the stated value isn't one of its real options even
      // after cleanup - found via a real live-browser test ("self serve" vs. the real option
      // "Self-serve only"). Found the FIELD, not the value: an honest decline, not a guess at
      // a value that was never actually selectable. Only applies when real options are known
      // to check against - a filter/field with no captured options (free text, or a control
      // this package can't enumerate) keeps the previous, more lenient behavior, same as
      // core's own matchSetValuePlanner never validating a filter's value either.
      if (hasEnumeratedOptions && !matchedOption) {
        return undefined;
      }

      const value = matchedOption ?? shape.value;

      return {
        intent: node.type === "filter" ? "set_filter" : "set_field",
        target: node.key,
        value,
        confidence: 0.72,
        source: "embedding",
        normalizedInput,
        matchedNodeIds: [node.id],
        steps: [{ type: node.type === "filter" ? "set_filter" : "set_field", target: node.key, value }],
        reason: `Matched "${node.key}" from "${shape.fieldPhrase}" (compromise.js grammar-shape match) after local graph resolution failed.`,
      };
    }
  }

  if (shape?.kind === "value-only") {
    const filterCandidates = candidates.filter((node) => node.type === "filter");
    const offering = filterCandidates
      .map((node) => ({ node, option: findOfferedOption(node, shape.value) }))
      .filter((candidate): candidate is { node: CinderGraphNode; option: string } => Boolean(candidate.option));

    const distinctKeys = new Set(offering.map((candidate) => candidate.node.key));

    if (offering.length > 0 && distinctKeys.size === 1) {
      const winner = offering[0]!;

      return {
        intent: "set_filter",
        target: winner.node.key,
        value: winner.option,
        confidence: 0.72,
        source: "embedding",
        normalizedInput,
        matchedNodeIds: [winner.node.id],
        steps: [{ type: "set_filter", target: winner.node.key, value: winner.option }],
        reason: `Matched "${winner.node.key}" as the filter offering "${shape.value}" (compromise.js grammar-shape match) after local graph resolution failed.`,
      };
    }
  }

  if (shape?.kind === "search") {
    const searchLikeCandidates = candidates.filter(isSearchLikeField);
    const distinctKeys = new Set(searchLikeCandidates.map((node) => node.key));

    // Structural match, same reasoning as core's matchSearchFieldPlanner: exactly one real
    // search-like field on the page is confident, more than one is a genuine ambiguity.
    if (searchLikeCandidates.length > 0 && distinctKeys.size === 1) {
      const target = searchLikeCandidates[0]!;

      return {
        intent: "set_field",
        target: target.key,
        value: shape.value,
        confidence: 0.7,
        source: "embedding",
        normalizedInput,
        matchedNodeIds: [target.id],
        steps: [{ type: "set_field", target: target.key, value: shape.value }],
        reason: `Matched "${target.key}" as the page's search field (compromise.js grammar-shape match) after local graph resolution failed.`,
      };
    }
  }

  // Cheap stage found nothing usable - escalate to the extractive-QA model, which doesn't
  // need the sentence to have a clean "verb ... to ... " shape at all. Still gated on a
  // cheap signal check first (see hasValueCommandSignal's doc comment) - never spend a real
  // model call, or risk its known calibration weakness, on a sentence with nothing in it
  // that even superficially resembles a value-setting command.
  if (!hasValueCommandSignal(input)) {
    return undefined;
  }

  try {
    const qaResult = await extractValueByQuestionAnswering(input, candidates);

    if (!qaResult) {
      return undefined;
    }

    const node = qaResult.node;
    const realOptions = (node.metadata as { options?: unknown })?.options;
    const hasEnumeratedOptions = node.type === "filter" && Array.isArray(realOptions) && realOptions.length > 0;
    const matchedOption = hasEnumeratedOptions ? findOfferedOption(node, qaResult.value) : undefined;

    // Same reasoning as the compromise.js path above (see the named-field branch): the QA
    // model is known to always attempt an answer regardless of whether it's real - found via
    // a real adversarial test, it confidently answered "nobody" for a filter whose real
    // options don't include "nobody" at all. The right FIELD, an invalid value: an honest
    // decline, never a fabricated value that was never actually selectable.
    if (hasEnumeratedOptions && !matchedOption) {
      return undefined;
    }

    const value = matchedOption ?? qaResult.value;

    return {
      intent: node.type === "filter" ? "set_filter" : "set_field",
      target: node.key,
      value,
      confidence: 0.6,
      source: "embedding",
      normalizedInput,
      matchedNodeIds: [node.id],
      steps: [{ type: node.type === "filter" ? "set_filter" : "set_field", target: node.key, value }],
      reason: `Matched "${node.key}" by extractive question-answering (score ${qaResult.score.toFixed(3)}) after local graph resolution failed.`,
    };
  } catch {
    // Honest miss if the QA model itself fails to load/run - never silently fall back to a
    // weaker, unvalidated guess.
    return undefined;
  }
}

export function createEmbeddingLlmCore(options: CinderEmbeddingFallbackOptions = {}): CinderLlmCore {
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const minGap = options.minGap ?? DEFAULT_MIN_GAP;
  const enableTiebreaker = options.enableTiebreaker ?? false;
  const maxAmbiguousCandidates = options.maxAmbiguousCandidates ?? DEFAULT_MAX_AMBIGUOUS_CANDIDATES;

  return {
    async infer(input, localIntent, snapshot): Promise<CinderLlmInferResult | undefined> {
      const startedAt = Date.now();
      const reason = localIntent.intent === "unknown" ? "unknown_intent" : "low_confidence";
      const miss = (): CinderLlmInferResult => ({
        intent: undefined,
        meta: buildMeta(reason, Date.now() - startedAt, false),
      });

      try {
        const valueIntent = await tryExtractValueIntent(input, snapshot, localIntent.normalizedInput);

        if (valueIntent) {
          return { intent: valueIntent, meta: buildMeta(reason, Date.now() - startedAt, true) };
        }
      } catch (error) {
        return {
          intent: undefined,
          meta: {
            ...buildMeta(reason, Date.now() - startedAt, false),
            errorCode: "model_error",
            errorMessage: error instanceof Error ? error.message : "Value-extraction model failed to load or run.",
          },
        };
      }

      let ranked: Awaited<ReturnType<typeof rankCandidates>>;

      try {
        ranked = await rankCandidates(input, snapshot);
      } catch (error) {
        return {
          intent: undefined,
          meta: {
            ...buildMeta(reason, Date.now() - startedAt, false),
            errorCode: "model_error",
            errorMessage: error instanceof Error ? error.message : "Embedding model failed to load or run.",
          },
        };
      }

      const outcome = classifyMatchOutcome(ranked, { minScore, minGap });

      if (outcome === "no_match") {
        // Honest miss, not a guess - nothing cleared the bar, so there's nothing worth
        // presenting as a choice even to the generative escalation step.
        return miss();
      }

      if (outcome === "confident") {
        const intent = intentFromCandidate(
          ranked[0]!,
          mapScoreToConfidence(ranked[0]!.score),
          localIntent.normalizedInput,
          `by semantic similarity (score ${ranked[0]!.score.toFixed(3)})`,
        );

        return intent ? { intent, meta: buildMeta(reason, Date.now() - startedAt, true) } : miss();
      }

      // outcome === "ambiguous": a genuine near-tie. Only escalate if the app opted in -
      // otherwise this is the same honest miss as "no_match", just for a different reason.
      if (!enableTiebreaker) {
        return miss();
      }

      const candidates = ranked.slice(0, maxAmbiguousCandidates);

      let picked: EmbeddingCandidate | undefined;

      try {
        picked = await pickTiebreakCandidate(input, candidates);
      } catch (error) {
        return {
          intent: undefined,
          meta: {
            ...buildMeta(reason, Date.now() - startedAt, false),
            errorCode: "model_error",
            errorMessage: error instanceof Error ? error.message : "Tiebreak model failed to load or run.",
          },
        };
      }

      if (!picked) {
        // The cross-encoder itself couldn't separate the candidates with a real gap (see
        // reranker.ts's MIN_GAP) - honest miss, not a fallback to the embedding's raw top
        // candidate, since picking that silently would defeat the point of having detected a
        // genuine ambiguity in the first place.
        return miss();
      }

      const intent = intentFromCandidate(
        picked,
        TIEBREAK_PICK_CONFIDENCE,
        localIntent.normalizedInput,
        "by constrained cross-encoder arbitration between tied candidates",
      );

      return intent ? { intent, meta: buildMeta(reason, Date.now() - startedAt, true) } : miss();
    },
  };
}
