// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import type { CinderGraphNode, CinderGraphSnapshot } from "usecinder";
import { embed } from "./model.js";

/**
 * Only these node types are candidates for embedding-based recovery (tier-2 phase 1,
 * deliberately scoped - see docs/local-engine-fully-fledged-plan.md §12). A field/filter
 * match needs to know not just WHICH node but also extract a value from the user's text,
 * which is a genuinely different, harder problem (the same reasoning that excluded the
 * value position from reference carryover's substitution) - left for a later phase rather
 * than guessing at a value split that embeddings alone can't resolve.
 */
export const CANDIDATE_TYPES = new Set<CinderGraphNode["type"]>(["route", "output", "action"]);

export interface EmbeddingCandidate {
  node: CinderGraphNode;
  score: number;
}

/**
 * The text actually embedded for a node - its label if it has one (closest to how a human
 * would describe it), falling back to its aliases joined together, falling back to its raw
 * key. Richer text gives the embedding model more to work with than a bare key like
 * "open-docs-search" would.
 */
export function describeNode(node: CinderGraphNode): string {
  if (node.label && node.label.trim()) {
    return node.label.trim();
  }

  if (node.aliases && node.aliases.length > 0) {
    return node.aliases.join(" ");
  }

  return node.key;
}

// One cache per snapshot object, so repeated calls against the same (unchanged) graph don't
// re-embed every candidate node on every single command - only the user's input text is
// embedded fresh each call. Mirrors the WeakMap-per-snapshot caching pattern already used in
// cinder's own core/cge/queryEngine.ts.
const candidateEmbeddingCache = new WeakMap<CinderGraphSnapshot, Map<string, Float32Array>>();

async function getCandidateEmbeddings(snapshot: CinderGraphSnapshot): Promise<Map<string, Float32Array>> {
  const cached = candidateEmbeddingCache.get(snapshot);

  if (cached) {
    return cached;
  }

  const embeddings = new Map<string, Float32Array>();
  const candidates = snapshot.nodes.filter((node) => CANDIDATE_TYPES.has(node.type));

  for (const node of candidates) {
    embeddings.set(node.id, await embed(describeNode(node)));
  }

  candidateEmbeddingCache.set(snapshot, embeddings);
  return embeddings;
}

function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0;

  for (let index = 0; index < a.length; index += 1) {
    sum += a[index]! * b[index]!;
  }

  return sum;
}

/**
 * Ranks every route/output/action node in the snapshot by embedding similarity to `input`,
 * highest first. Both vectors are L2-normalized by embed(), so the dot product IS the cosine
 * similarity - no separate magnitude division needed.
 */
export async function rankCandidates(
  input: string,
  snapshot: CinderGraphSnapshot,
): Promise<EmbeddingCandidate[]> {
  const candidateEmbeddings = await getCandidateEmbeddings(snapshot);

  if (candidateEmbeddings.size === 0) {
    return [];
  }

  const inputEmbedding = await embed(input);
  const nodesById = new Map(snapshot.nodes.map((node) => [node.id, node] as const));

  const ranked: EmbeddingCandidate[] = [];

  for (const [nodeId, candidateEmbedding] of candidateEmbeddings) {
    const node = nodesById.get(nodeId);

    if (!node) {
      continue;
    }

    ranked.push({ node, score: dotProduct(inputEmbedding, candidateEmbedding) });
  }

  ranked.sort((left, right) => right.score - left.score);
  return ranked;
}

export type EmbeddingMatchOutcome =
  /** No candidate (or the best one) cleared the minimum score at all - nothing good exists
   * to even present as a choice. */
  | "no_match"
  /** The top candidate cleared the score bar, but is too close to the second-best to tell
   * apart confidently - exactly the case the constrained generative escalation tier
   * (generative.ts) is for: present these specific candidates and ask which one, rather
   * than silently picking the top of a near-tie. */
  | "ambiguous"
  /** A single candidate clearly stands out - safe to use directly. */
  | "confident";

/**
 * Same ambiguity-safety principle as cinder core's isAmbiguous (planners/shared.ts): don't
 * trust a single top score in isolation - require a real gap to the second-best candidate
 * before treating the top one as a confident answer. Cosine similarity for unrelated short
 * phrases against a MiniLM-class model rarely drops below ~0.2-0.3, so a fixed absolute
 * minimum score is paired with a relative-gap check, not either alone.
 *
 * Distinguishes "no_match" from "ambiguous" (rather than collapsing both into one boolean,
 * as an earlier version of this function did) specifically so the caller can treat them
 * differently: a genuinely weak best score means there's nothing worth presenting as a
 * choice, but a close tie between two otherwise-good candidates is exactly the case worth
 * escalating to a constrained pick-one generative step instead of giving up.
 */
export function classifyMatchOutcome(
  ranked: EmbeddingCandidate[],
  options: { minScore: number; minGap: number },
): EmbeddingMatchOutcome {
  const [best, second] = ranked;

  if (!best || best.score < options.minScore) {
    return "no_match";
  }

  if (!second || best.score - second.score >= options.minGap) {
    return "confident";
  }

  return "ambiguous";
}
