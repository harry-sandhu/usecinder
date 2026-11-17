// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import type { CinderConfig, CinderGraphNode, CinderGraphSnapshot, CinderLlmCore, CinderLlmInferResult, CinderResolvedIntent, CinderRuntimeContext } from "usecinder";
import { CANDIDATE_TYPES, describeNode } from "./similarity.js";
import { scoreTextPair, CROSS_ENCODER_MIN_GAP } from "./reranker.js";
import { createEmbeddingLlmCore, type CinderEmbeddingFallbackOptions } from "./index.js";

const DEFAULT_STORAGE_KEY = "cinder:learned-aliases:v1";

export interface CinderAliasLearningOptions {
  /**
   * Options forwarded to the internal tier-2 core that re-checks the ENRICHED snapshot before
   * falling through to `inner` - the same options `createEmbeddingLlmCore` itself takes.
   */
  embeddingOptions?: CinderEmbeddingFallbackOptions;
  /**
   * Override for the tier-2-equivalent core that resolves against the alias-enriched snapshot.
   * Defaults to a real `createEmbeddingLlmCore(embeddingOptions)` - swappable for tests so they
   * don't need the real embedding model to verify the orchestration (enrich -> try -> teach).
   */
  embeddingCore?: CinderLlmCore;
  /**
   * localStorage key the learned aliases persist under. Pass `false` to keep them in memory
   * only (cleared on reload) - e.g. for tests or SSR.
   */
  storageKey?: string | false;
  /** Node types eligible to be taught a new alias - defaults to the exact same scope tier 2's
   * own embedding ranking already covers (route/output/action), since a learned alias on a
   * field/filter would never be read by anything (see similarity.ts's CANDIDATE_TYPES doc
   * comment for why those are out of scope for generic embedding ranking). */
  learnableTypes?: Array<CinderGraphNode["type"]>;
  /**
   * Extra cross-encoder verification, against ALL real same-type candidates' own canonical
   * labels, applied ONLY when the embedding stage's winning node actually has a learned alias
   * on record - found necessary by real testing: tier 2's own built-in ambiguity handling
   * (`classifyMatchOutcome`'s gap-check, even with `enableTiebreaker`) is tuned for its normal
   * job of recovering typos/paraphrases of NATIVE aliases, and measured considerably less safe
   * than this once freshly-taught aliases (reusing the same embedding model's known weak spot -
   * see semanticCache.ts's doc comment on "on reflex" vs. "off reflex") are in the mix - 51-62%
   * of repeat-variant resolutions were wrong without this, vs. the low single digits the
   * semantic cache achieved with the equivalent check. Scoped to learned-alias resolutions only,
   * so tier 2's existing, already-proven behavior on native aliases is never second-guessed or
   * slowed down. Defaults to true - this is what makes teaching safe to leave on by default.
   */
  verifyLearnedMatches?: boolean;
  /** Override for the cross-encoder scoring call used by `verifyLearnedMatches` - defaults to
   * @cinder/embeddings' own reranker model, swappable for tests. */
  verifyFn?: (input: string, candidateText: string) => Promise<number>;
  /** Minimum cross-encoder score margin required over the best different-target competitor
   * among all real same-type candidates. Defaults to the same empirically-calibrated gap
   * `pickTiebreakCandidate` already uses (reranker.ts's MIN_GAP). Shared by both
   * `verifyLearnedMatches` and `verifyBeforeTeaching`. */
  verifyMinGap?: number;
  /**
   * The OTHER real root cause found by testing, distinct from `verifyLearnedMatches`: some
   * phrases tier 3 resolves are themselves too generic to uniquely identify one target even in
   * principle - "app collections workspace" or a bare "disbursed" - and teaching one of those
   * verbatim doesn't just risk a wrong answer for a repeat of that exact phrase, it creates a
   * magnet that pulls ANY future input sharing that generic word toward the one target that
   * happened to get taught it first, even for completely unrelated targets (measured: one bad
   * teach of "workspace" on a "Collected" dashboard tile wrongly captured later questions about
   * three OTHER, unrelated tiles). Fixed by cross-encoder-verifying the input against ALL real
   * same-type siblings BEFORE committing it to the store, reusing the identical check
   * `verifyLearnedMatches` runs at use time, just run once more at teach time - if the phrase
   * itself doesn't clearly and uniquely point to this target among its real siblings, it is
   * never taught, regardless of what tier 3 said. Defaults to true.
   */
  verifyBeforeTeaching?: boolean;
}

type LearnedAliasStore = Map<string, string[]>;

function storeKeyFor(nodeType: string, nodeKey: string): string {
  return `${nodeType}:${nodeKey}`;
}

function loadStore(storageKey: string | undefined): LearnedAliasStore {
  if (!storageKey || typeof localStorage === "undefined") {
    return new Map();
  }

  try {
    const raw = localStorage.getItem(storageKey);

    if (!raw) {
      return new Map();
    }

    return new Map(Object.entries(JSON.parse(raw) as Record<string, string[]>));
  } catch {
    return new Map();
  }
}

function persistStore(storageKey: string | undefined, store: LearnedAliasStore): void {
  if (!storageKey || typeof localStorage === "undefined") {
    return;
  }

  try {
    localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(store)));
  } catch {
    // Storage full or unavailable - degrades to memory-only for the rest of this session,
    // the same correctness no-op as the semantic cache's own persistence failure handling.
  }
}

/**
 * Returns a shallow-cloned snapshot where every node eligible for a learned alias (per
 * `learnableTypes`) has whatever phrases were taught for it folded into its text - this is the
 * ONLY integration point with tier 2: nothing in similarity.ts/index.ts changes, because a
 * learned alias looks exactly like any other real alias once it's on the node, so it flows
 * through tier 2's existing, already-safety-tested ranking + ambiguity gap-check
 * (classifyMatchOutcome) + optional cross-encoder tiebreak completely unchanged.
 *
 * Appends to `label`, not just `aliases` - found via the real end-to-end test
 * (validate-alias-learning-real.mjs) to matter: `describeNode` (similarity.ts) uses `label` as
 * its FIRST choice whenever one exists, falling back to `aliases` only when there's no label at
 * all. Almost every real route/action/output node has a label, so appending only to `aliases`
 * was silently never read for the common case - the taught phrase has to reach whichever field
 * `describeNode` actually embeds, not just "an alias" in the abstract.
 */
function applyLearnedAliases(snapshot: CinderGraphSnapshot, store: LearnedAliasStore): CinderGraphSnapshot {
  if (store.size === 0) {
    return snapshot;
  }

  return {
    ...snapshot,
    nodes: snapshot.nodes.map((node) => {
      const learned = store.get(storeKeyFor(node.type, node.key));

      if (!learned || learned.length === 0) {
        return node;
      }

      const existing = new Set(node.aliases ?? []);
      const newAliases = learned.filter((alias) => !existing.has(alias));
      const merged = [...(node.aliases ?? []), ...newAliases];
      const enrichedLabel = newAliases.length > 0 && node.label ? `${node.label} ${newAliases.join(" ")}` : node.label;

      return { ...node, aliases: merged, label: enrichedLabel };
    }),
  };
}

/** Same step-type -> node-type mapping semanticCache.ts already duplicates from llmCore.ts's
 * own internal (unexported) helper - kept as a small, independent copy rather than a shared
 * export, since it's a stable, five-line, unlikely-to-drift fact about the type system. */
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
 * Cross-encoder-verifies that `input` clearly and uniquely points to `winningTarget` among ALL
 * real same-type candidates' own canonical labels (not a narrow shortlist - see
 * semanticCache.ts's identical lesson about why a narrow window let a real bug through). Used
 * twice, for two distinct real bugs found by testing: once at USE time (`verifyLearnedMatches` -
 * tier 2's own built-in gap-check alone was measured considerably less safe once a
 * freshly-taught alias is in the mix) and once at TEACH time (`verifyBeforeTeaching` - some
 * phrases tier 3 resolves are themselves too generic to uniquely identify one target, and
 * teaching one verbatim creates a magnet for later unrelated inputs sharing that generic word).
 */
async function verifyAgainstSiblings(
  input: string,
  winningTarget: string,
  nodeType: CinderGraphNode["type"],
  snapshot: CinderGraphSnapshot,
  verifyFn: (input: string, candidateText: string) => Promise<number>,
  verifyMinGap: number,
): Promise<boolean> {
  const candidates = snapshot.nodes.filter((node) => node.type === nodeType);
  const scored = await Promise.all(
    candidates.map(async (node) => ({ node, score: await verifyFn(input, describeNode(node)) })),
  );
  scored.sort((a, b) => b.score - a.score);

  const [best, ...rest] = scored;

  if (!best || best.node.key !== winningTarget) {
    return false;
  }

  const competitor = rest.find((candidate) => candidate.node.key !== winningTarget);

  if (!competitor) {
    return true;
  }

  return best.score - competitor.score >= verifyMinGap;
}

/**
 * Wraps a tier-3 (or any) CinderLlmCore so that, once it resolves something tier 2 alone
 * couldn't, the input text is taught back as a new real alias on the resolved target - the
 * NEXT similar input is then resolved natively BY tier 2 itself (source: "embedding"), not by a
 * side-channel cache.
 *
 * Safety history (see docs/known-limitations.md item 4's 2026-11-15 updates): measured against
 * real fallback data from two real apps, this started at a ~7.9% overall wrong-answer rate -
 * roughly 2.5x the semantic cache's. The dominant cause, found by inspecting the actual wrong
 * cases rather than re-guessing, was NOT the already-known embedding-confusion bug
 * `verifyLearnedMatches` guards against - it was a teaching-time bug: some phrases tier 3
 * resolves are themselves too generic to uniquely identify one target ("app collections
 * workspace," a bare "disbursed"), and teaching one verbatim turns it into a magnet that
 * wrongly captures later, UNRELATED questions sharing that generic word. `verifyBeforeTeaching`
 * (default true) fixes it: the same cross-encoder-against-real-siblings check used at use time
 * runs once more before a resolution is ever committed to the store, so a phrase that doesn't
 * clearly and uniquely point to its target is never taught, regardless of tier 3's confidence.
 * Re-measured after the fix: overall wrong rate dropped to ~3.3%, roughly matching the cache,
 * while still recovering more repeat-phrased variants (6.2%) than the cache alone (2.7%). This
 * does trade away some non-obvious paraphrase learning a real LLM's domain knowledge would
 * support but a text-only cross-encoder cannot independently verify - a deliberate, measured
 * tradeoff in favor of safety, not an oversight.
 *
 * Install it as the single llm core, e.g.:
 *   Cinder.setLlmCore(createAliasLearningLlmCore(createCloudLlmCore(...)), { requiresNetwork: false })
 * (requiresNetwork reflects whatever the wrapped cloud core needs, same as installing it alone).
 */
export function createAliasLearningLlmCore(
  inner: CinderLlmCore,
  options: CinderAliasLearningOptions = {},
): CinderLlmCore {
  const embeddingCore = options.embeddingCore ?? createEmbeddingLlmCore(options.embeddingOptions);
  const storageKey = options.storageKey === false ? undefined : options.storageKey ?? DEFAULT_STORAGE_KEY;
  const learnableTypes = new Set(options.learnableTypes ?? CANDIDATE_TYPES);
  const verifyLearnedMatches = options.verifyLearnedMatches ?? true;
  const verifyBeforeTeaching = options.verifyBeforeTeaching ?? true;
  const verifyFn = options.verifyFn ?? scoreTextPair;
  const verifyMinGap = options.verifyMinGap ?? CROSS_ENCODER_MIN_GAP;

  const store = loadStore(storageKey);

  return {
    async infer(
      input: string,
      localIntent: CinderResolvedIntent,
      snapshot: CinderGraphSnapshot,
      config: Required<CinderConfig>,
      runtimeContext?: CinderRuntimeContext,
    ): Promise<CinderLlmInferResult | undefined> {
      const enrichedSnapshot = applyLearnedAliases(snapshot, store);
      const embeddingResult = await embeddingCore.infer(input, localIntent, enrichedSnapshot, config, runtimeContext);

      if (embeddingResult?.intent) {
        const target = embeddingResult.intent.target;
        const nodeType = nodeTypeForIntent(embeddingResult.intent.intent);
        const wasLearnedMatch = Boolean(target && nodeType && (store.get(storeKeyFor(nodeType, target)) ?? []).length > 0);

        if (!wasLearnedMatch || !verifyLearnedMatches) {
          return embeddingResult;
        }

        const approved = target && nodeType
          ? await verifyAgainstSiblings(input, target, nodeType, enrichedSnapshot, verifyFn, verifyMinGap)
          : false;

        if (approved) {
          return embeddingResult;
        }
        // Not approved - fall through to `inner` below exactly as if tier 2 had missed,
        // consistent with "miss a reuse rather than risk a bad one."
      }

      const result = await inner.infer(input, localIntent, snapshot, config, runtimeContext);
      const target = result?.intent?.target;
      const nodeType = result?.intent ? nodeTypeForIntent(result.intent.intent) : undefined;

      const safeToTeach = target && nodeType && learnableTypes.has(nodeType)
        ? (verifyBeforeTeaching ? await verifyAgainstSiblings(input, target, nodeType, snapshot, verifyFn, verifyMinGap) : true)
        : false;

      if (safeToTeach && target && nodeType) {
        const key = storeKeyFor(nodeType, target);
        const existing = store.get(key) ?? [];

        if (!existing.includes(input)) {
          store.set(key, [...existing, input]);
          persistStore(storageKey, store);
        }
      }

      return result;
    },
  };
}
