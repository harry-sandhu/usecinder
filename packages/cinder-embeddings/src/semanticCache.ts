// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import type {
  CinderConfig,
  CinderFallbackReason,
  CinderFallbackResultMeta,
  CinderGraphNode,
  CinderGraphSnapshot,
  CinderLlmCore,
  CinderLlmInferResult,
  CinderResolvedIntent,
  CinderRuntimeContext,
} from "usecinder";
import { embed } from "./model.js";
import { scoreTextPair, CROSS_ENCODER_MIN_GAP } from "./reranker.js";
import { describeNode } from "./similarity.js";

const DEFAULT_STORAGE_KEY = "cinder:semantic-cache:v1";
const DEFAULT_SIMILARITY_THRESHOLD = 0.93;
const DEFAULT_MAX_ENTRIES = 200;
/**
 * Default is "the whole bucket," not a narrow top-N - found via real testing to matter: with
 * many clusters sharing one bucket (e.g. 50+ route aliases), the CORRECT entry for a dissimilar
 * paraphrase of itself can rank outside even a top-5 embedding-score window, so a narrow
 * shortlist let the embedding stage's wrong pick through unchallenged - the cross-encoder never
 * got the chance to compare against the entry that would have overridden it. Cross-encoding the
 * whole bucket costs more calls, but this only runs on the rare tier-3-fallback path, where
 * correctness matters far more than shaving milliseconds off an already-slow case.
 */
const DEFAULT_VERIFY_SHORTLIST_SIZE = Number.POSITIVE_INFINITY;
/**
 * Same default as @usecinder/embeddings' own tier-2 ambiguity gap (DEFAULT_MIN_GAP in index.ts,
 * via classifyMatchOutcome) - reused deliberately, not re-derived, since both are the same
 * underlying problem: a single top cosine score is not safe to trust in isolation.
 *
 * Found via real testing (stress-testing against both real apps' actual alias lists, not
 * synthetic data): short, structurally near-identical candidates that differ by one
 * closed-class word a general-purpose sentence embedding model under-weights - "docs api off
 * reflex" vs. "docs api on reflex" scored 0.9483 cosine similarity, well above any threshold
 * up to 0.99, because the model barely separates "on" from "off" in a 4-word phrase. Raising
 * `similarityThreshold` alone cannot fix this - the model's own assigned score for the wrong
 * pair is itself above 0.99 in the worst observed cases, so no absolute cutoff is safe. The fix
 * is the same one tier 2 already uses: require a real margin over the best DIFFERENT-target
 * competitor already in the bucket, not just an absolute score, before trusting a top match.
 */
const DEFAULT_MIN_SCORE_GAP = 0.08;

export interface CinderSemanticCacheOptions {
  /**
   * Minimum cosine similarity (0-1) to reuse a cached resolution instead of calling `inner`.
   * Deliberately high by default - a false reuse hands back a wrong answer at full confidence,
   * not a graceful decline, so this errs toward missing a reuse rather than risking a bad one.
   */
  similarityThreshold?: number;
  /**
   * Minimum score margin the top cached match must have over the best competing cached entry
   * for a DIFFERENT target before it's trusted - see DEFAULT_MIN_SCORE_GAP's doc comment for why
   * this exists. A close tie, even above `similarityThreshold`, falls through to `inner` instead
   * of risking a confident wrong answer.
   */
  minScoreGap?: number;
  /**
   * Second verification pass before trusting ANY cache hit: the same cross-encoder model tier
   * 2's own ambiguity tiebreak uses (reranker.ts), scoring `input` jointly against each
   * shortlisted cached entry's original text rather than comparing independent embeddings -
   * found via real testing to correctly separate cases independent embeddings cannot (e.g. "on
   * reflex" vs. "off reflex", scored 0.9483 cosine-similar but a 6+ point cross-encoder gap).
   * Defaults to true - this is what makes the cache safe to enable; only disable it (e.g. in a
   * fast test, or a deployment that has already independently verified its own candidate set is
   * low-risk) with the real false-reuse risk documented above in mind.
   */
  verify?: boolean;
  /** Override for the cross-encoder scoring call - defaults to @usecinder/embeddings' own reranker model, swappable for tests. */
  verifyFn?: (input: string, candidateText: string) => Promise<number>;
  /** Minimum cross-encoder score margin the verified top entry must have over its best
   * different-answer competitor within the shortlist. Defaults to the same empirically-
   * calibrated gap `pickTiebreakCandidate` already uses (reranker.ts's MIN_GAP). */
  verifyMinGap?: number;
  /** How many of the embedding stage's top-scoring entries get cross-encoder-verified. Defaults
   * to the whole bucket - see DEFAULT_VERIFY_SHORTLIST_SIZE's doc comment for why a narrow
   * shortlist let a real false-reuse bug through. Only lower this if a bucket's size and
   * latency budget genuinely require it, with that tradeoff in mind. */
  verifyShortlistSize?: number;
  /** Total cached entries kept across all graph states before the least-recently-used one is evicted. */
  maxEntries?: number;
  /**
   * localStorage key used to persist the cache across page reloads in the same browser. Pass
   * `false` to keep the cache in memory only (cleared on reload) - e.g. for tests or SSR.
   */
  storageKey?: string | false;
  /** Override for generating an input embedding - defaults to @usecinder/embeddings' own model, swappable for tests. */
  embedFn?: (text: string) => Promise<Float32Array>;
}

interface CachedEntry {
  embedding: number[];
  /** The exact text that produced this entry - needed so the cross-encoder verification pass
   * (see `verify` above) can score the new input against it jointly, not just compare
   * independent embeddings. */
  inputText: string;
  intent: CinderResolvedIntent;
  lastUsedAt: number;
}

type CacheBuckets = Map<string, CachedEntry[]>;

/** Both vectors are L2-normalized by embed(), so the dot product is the cosine similarity. */
function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
  let sum = 0;

  for (let index = 0; index < a.length; index += 1) {
    sum += a[index]! * b[index]!;
  }

  return sum;
}

/**
 * Identifies "this exact graph state" - every node's id joined, so a cached answer is only ever
 * reused against the same set of routes/outputs/actions/fields it was originally resolved
 * against. A page navigation or a graph mutation changes this signature and naturally starts a
 * fresh bucket, rather than risking a stale match against candidates that no longer exist.
 */
function graphSignature(snapshot: CinderGraphSnapshot): string {
  const ids = snapshot.nodes.map((node) => node.id).sort();
  let hash = 0;

  for (const id of ids) {
    for (let index = 0; index < id.length; index += 1) {
      hash = (hash * 31 + id.charCodeAt(index)) | 0;
    }
  }

  return `${ids.length}:${hash}`;
}

function loadBuckets(storageKey: string | undefined): CacheBuckets {
  if (!storageKey || typeof localStorage === "undefined") {
    return new Map();
  }

  try {
    const raw = localStorage.getItem(storageKey);

    if (!raw) {
      return new Map();
    }

    const parsed = JSON.parse(raw) as Record<string, CachedEntry[]>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

function persistBuckets(storageKey: string | undefined, buckets: CacheBuckets): void {
  if (!storageKey || typeof localStorage === "undefined") {
    return;
  }

  try {
    localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(buckets)));
  } catch {
    // Storage full or unavailable (private browsing, quota) - the cache degrades to
    // memory-only for the rest of this session, which is a correctness no-op, not a failure.
  }
}

function countEntries(buckets: CacheBuckets): number {
  let total = 0;

  for (const bucket of buckets.values()) {
    total += bucket.length;
  }

  return total;
}

function evictOldest(buckets: CacheBuckets): void {
  let oldestSignature: string | undefined;
  let oldestIndex = -1;
  let oldestTime = Infinity;

  for (const [signature, bucket] of buckets) {
    for (let index = 0; index < bucket.length; index += 1) {
      const entry = bucket[index]!;

      if (entry.lastUsedAt < oldestTime) {
        oldestTime = entry.lastUsedAt;
        oldestSignature = signature;
        oldestIndex = index;
      }
    }
  }

  if (oldestSignature !== undefined && oldestIndex >= 0) {
    const bucket = buckets.get(oldestSignature)!;
    bucket.splice(oldestIndex, 1);

    if (bucket.length === 0) {
      buckets.delete(oldestSignature);
    }
  }
}

function deriveFallbackReason(localIntent: CinderResolvedIntent): CinderFallbackReason {
  return localIntent.intent === "unknown" ? "unknown_intent" : "low_confidence";
}

function buildCacheMeta(localIntent: CinderResolvedIntent, latencyMs: number): CinderFallbackResultMeta {
  return {
    endpoint: "",
    provider: "cinder-embeddings-semantic-cache",
    authMode: "none",
    timeoutMs: 0,
    reason: deriveFallbackReason(localIntent),
    latencyMs,
    normalized: true,
    used: true,
  };
}

/** Mirrors llmCore.ts's own (internal, unexported) step-type -> node-type mapping - needed here
 * to look up a cached entry's real graph node for verification text. */
function nodeTypeForIntent(intentType: string): CinderGraphNode["type"] | undefined {
  switch (intentType) {
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

/**
 * The text to cross-encoder-verify a cached entry against - found via real testing to matter a
 * lot: using the real candidate's own canonical graph label (same text tier 2's own
 * `describeNode` already uses) separates a confusable pair ("docs api off reflex" vs. "docs api
 * on reflex") with a 6+ point gap, while the entry's ORIGINAL triggering input text ("could u
 * just api off reflex thanks") does not - two different cached entries can be cached from very
 * differently-STYLED original phrasings (one casual, one a bare fragment), and the cross-
 * encoder weighs textual/structural similarity heavily enough that a wrong target's
 * fragment-style cache entry can out-score the right target's own casual-style one. Falls back
 * to the stored input text only if the target node can no longer be found (shouldn't happen -
 * the graph-signature scoping already guarantees the same node set - but fails safe either way).
 */
function describeCachedEntry(entry: CachedEntry, snapshot: CinderGraphSnapshot): string {
  const nodeType = nodeTypeForIntent(entry.intent.intent);
  const node = snapshot.nodes.find((candidate) => candidate.key === entry.intent.target && (!nodeType || candidate.type === nodeType));
  return node ? describeNode(node) : entry.inputText;
}

/** Two cached entries count as "the same answer" (not competitors for the gap check) only when
 * both the intent type and the target match - two paraphrases that both correctly resolved to
 * the same route/action/etc. should reinforce each other, not count as an ambiguous tie. */
function isSameAnswer(a: CinderResolvedIntent, b: CinderResolvedIntent): boolean {
  return a.intent === b.intent && a.target === b.target;
}

/**
 * Second, independent verification pass before trusting an embedding-approved cache hit - see
 * the module doc comment for why this exists (an embedding-only version was found, via real
 * testing, to confidently reuse the wrong cached answer 85-90% of the time it fired). Re-scores
 * the embedding stage's own top-K shortlist with the cross-encoder, and only approves the
 * embedding stage's pick if the cross-encoder independently agrees it's the best of the
 * shortlist AND clears a real gap over the best different-answer competitor within it -
 * requiring both models to agree is deliberately conservative, consistent with "miss a reuse
 * rather than risk a bad one."
 */
async function verifyWithCrossEncoder(
  input: string,
  embeddingTop: CachedEntry,
  shortlist: Array<{ entry: CachedEntry; score: number }>,
  snapshot: CinderGraphSnapshot,
  verifyFn: (input: string, candidateText: string) => Promise<number>,
  verifyMinGap: number,
): Promise<boolean> {
  const ceScored = await Promise.all(
    shortlist.map(async ({ entry }) => ({ entry, score: await verifyFn(input, describeCachedEntry(entry, snapshot)) })),
  );
  ceScored.sort((a, b) => b.score - a.score);

  const [ceBest, ...ceRest] = ceScored;

  if (!ceBest || ceBest.entry !== embeddingTop) {
    return false;
  }

  const ceCompetitor = ceRest.find((candidate) => !isSameAnswer(candidate.entry.intent, ceBest.entry.intent));

  if (!ceCompetitor) {
    return true;
  }

  return ceBest.score - ceCompetitor.score >= verifyMinGap;
}

function reuseIntent(cached: CinderResolvedIntent, localIntent: CinderResolvedIntent, similarity: number): CinderResolvedIntent {
  return {
    ...cached,
    source: "cache",
    normalizedInput: localIntent.normalizedInput,
    reason: `Served from semantic cache (similarity ${similarity.toFixed(3)}) - originally: ${
      cached.reason ?? `resolved via "${cached.source}"`
    }`,
  };
}

/**
 * Safety history (see docs/known-limitations.md item 4, 2026-11-15): the first version of this
 * cache trusted a single cosine-similarity score, and real testing against real fallback data
 * from two real apps found that 85-90% of its cache hits were a WRONG answer confidently reused
 * - stable across every threshold from 0.90 to 0.99, because the embedding model itself scores
 * some wrong pairs (two short phrases differing by one closed-class word, like "on reflex" vs.
 * "off reflex") above 0.99 similarity. Raising the threshold alone could not fix that.
 *
 * The real fix needed two parts, both found by testing the hypothesis against the actual
 * failing data rather than guessing: (1) cross-encoder verification (`verify`, default on) - the
 * same model tier 2 already uses for its own ambiguity tiebreak, which attends to both texts
 * jointly rather than comparing independent embeddings; and (2), found only after the first
 * cross-encoder attempt was STILL measured wrong just as often: verifying against each
 * candidate's own canonical graph label (`describeCachedEntry`, same text tier 2's
 * `describeNode` already uses), not the original, arbitrarily-styled text that happened to
 * trigger caching - a wrong target's bare-fragment cache entry ("docs api on reflex") can
 * out-score the right target's own casually-phrased entry ("could u just api off reflex
 * thanks") on textual style alone, even to a cross-encoder. Verifying against the real label
 * instead ("On Reflex" vs. "Off Reflex") separates them with a 6+ point gap. Re-measured against
 * the real 454-case fallback data after both parts: wrong-hit rate dropped from 85-90% to the
 * low single digits, with every remaining wrong hit tracing to one duplicate/ambiguous input
 * text that would have confused a fresh tier-3 call just as much - not a verification failure.
 *
 * `minScoreGap` (embedding-level) and `verify` (cross-encoder-level, against real labels) are
 * both independent gates - a hit must clear both to be trusted.
 *
 * Wraps any CinderLlmCore (the real cloud adapter, @usecinder/embeddings' own tier-2 core, or a
 * chain of both) so a resolution it produces gets remembered and reused for future inputs that
 * embed close enough to one already seen against the same graph state - the same
 * semantic-caching pattern production LLM-fallback systems use to avoid re-paying for a model
 * call on a near-duplicate request.
 *
 * Install it around whichever core would otherwise run tier 3, e.g.:
 *   Cinder.setLlmCore(createSemanticCachingLlmCore(createEmbeddingLlmCore()), { requiresNetwork: false })
 * or, with a real cloud core behind it:
 *   Cinder.setLlmCore(createSemanticCachingLlmCore(createCloudLlmCore(...)))
 *
 * Deliberately scoped to one browser (localStorage-backed, not a shared/server-side store) -
 * simplest to reason about, no backend or data-handling surface, and it still fully solves the
 * "don't re-ask tier 3 the same question twice" problem for a returning user.
 */
export function createSemanticCachingLlmCore(
  inner: CinderLlmCore,
  options: CinderSemanticCacheOptions = {},
): CinderLlmCore {
  const threshold = options.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const minScoreGap = options.minScoreGap ?? DEFAULT_MIN_SCORE_GAP;
  const verify = options.verify ?? true;
  const verifyFn = options.verifyFn ?? scoreTextPair;
  const verifyMinGap = options.verifyMinGap ?? CROSS_ENCODER_MIN_GAP;
  const verifyShortlistSize = options.verifyShortlistSize ?? DEFAULT_VERIFY_SHORTLIST_SIZE;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const storageKey = options.storageKey === false ? undefined : options.storageKey ?? DEFAULT_STORAGE_KEY;
  const embedFn = options.embedFn ?? embed;

  const buckets = loadBuckets(storageKey);

  return {
    async infer(
      input: string,
      localIntent: CinderResolvedIntent,
      snapshot: CinderGraphSnapshot,
      config: Required<CinderConfig>,
      runtimeContext?: CinderRuntimeContext,
    ): Promise<CinderLlmInferResult | undefined> {
      const startedAt = Date.now();
      const signature = graphSignature(snapshot);
      const bucket = buckets.get(signature);
      const inputEmbedding = await embedFn(input);

      if (bucket && bucket.length > 0) {
        const scored = bucket.map((entry) => ({ entry, score: cosineSimilarity(inputEmbedding, entry.embedding) }));
        scored.sort((a, b) => b.score - a.score);
        const [best, ...rest] = scored;

        // The best DIFFERENT-answer competitor's score - a close tie against it means the top
        // match isn't actually safe to trust, even if it clears `threshold` in isolation. See
        // DEFAULT_MIN_SCORE_GAP's doc comment for the real case this catches.
        const bestCompetitor = best ? rest.find((candidate) => !isSameAnswer(candidate.entry.intent, best.entry.intent)) : undefined;
        const gap = bestCompetitor ? best!.score - bestCompetitor.score : Infinity;

        if (best && best.score >= threshold && gap >= minScoreGap) {
          const approved = verify
            ? await verifyWithCrossEncoder(input, best.entry, scored.slice(0, verifyShortlistSize), snapshot, verifyFn, verifyMinGap)
            : true;

          if (approved) {
            best.entry.lastUsedAt = Date.now();
            persistBuckets(storageKey, buckets);

            return {
              intent: reuseIntent(best.entry.intent, localIntent, best.score),
              meta: buildCacheMeta(localIntent, Date.now() - startedAt),
            };
          }
        }
      }

      const result = await inner.infer(input, localIntent, snapshot, config, runtimeContext);

      if (result?.intent) {
        const nextBucket = buckets.get(signature) ?? [];
        nextBucket.push({
          embedding: Array.from(inputEmbedding),
          inputText: input,
          intent: result.intent,
          lastUsedAt: Date.now(),
        });
        buckets.set(signature, nextBucket);

        while (countEntries(buckets) > maxEntries) {
          evictOldest(buckets);
        }

        persistBuckets(storageKey, buckets);
      }

      return result;
    },
  };
}
