// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
/**
 * Constrained tiebreak arbitration - the rare, lazy-loaded second stage of tier 2, invoked
 * only when the embedding stage (similarity.ts) classifies its result as "ambiguous": a
 * genuine near-tie between two or more real candidates that ALREADY cleared the embedding
 * stage's own absolute-score bar (classifyMatchOutcome never reaches this module on a
 * "no_match").
 *
 * This was originally built around a small generative instruct model
 * (onnx-community/Llama-3.2-1B-Instruct) asked to reply with a candidate's number. Real
 * testing (not assumption) found that approach unreliable: a strong positional bias (tended
 * to just pick whichever option was listed last, regardless of message content, confirmed by
 * swapping option order and watching the "winning" number flip with it) and a strong
 * acquiescence bias in a yes/no framing (answered "yes" to almost everything, including
 * clearly unrelated messages). Debiasing the generative model via logit-averaging across
 * option-order permutations substantially improved it, but a cross-encoder - the standard,
 * purpose-built architecture for exactly this "does message X match option Y" pairwise
 * relevance task (see sbert.net's CrossEncoder docs) - tested as both more reliable AND far
 * smaller, with zero fine-tuning needed:
 *
 * Xenova/ms-marco-MiniLM-L-6-v2, ~23MB quantized (vs. the generative model's ~750MB+ even at
 * q4) - comparable in size to the embedding stage's own model. Real testing across 10
 * realistic (message, candidate-set) cases found its RELATIVE ranking of candidates 100%
 * correct, and - mirroring the project's existing isAmbiguous/classifyMatchOutcome pattern of
 * requiring a real score gap rather than trusting an absolute score alone - the gap between
 * its best and second-best candidate cleanly separated genuine matches (gap >= ~0.7 in every
 * real-match case tested) from cases where nothing genuinely fit (gap <= ~0.4 in every such
 * case tested, with zero overlap between the two groups). MIN_GAP below is set at the
 * midpoint of that empirically observed separation.
 *
 * Deliberately not open generation and not even free-text output: the model scores each
 * candidate independently (a single forward pass per candidate, not autoregressive decoding),
 * so there is no output to parse or hallucinate - just a comparison of numbers the model
 * itself produced, same honest-arbitration spirit, now on a model actually suited to the job.
 */
import { AutoModelForSequenceClassification, AutoTokenizer, type PreTrainedTokenizer } from "@huggingface/transformers";
import { loadPipelineWithFallback } from "./deviceSelection.js";
import { describeNode, type EmbeddingCandidate } from "./similarity.js";

const MODEL_ID = "Xenova/ms-marco-MiniLM-L-6-v2";

/**
 * The minimum gap (raw logit) required between the best and second-best candidate's score
 * for the reranker's pick to be trusted. Empirically calibrated (see module doc comment):
 * every genuine match tested scored a gap of ~0.7+, every case where nothing truly fit
 * scored ~0.4 or less. 0.5 sits in that empirically-clear gap with margin on both sides.
 */
const MIN_GAP = 0.5;

interface CrossEncoderHandle {
  tokenizer: PreTrainedTokenizer;
  model: Awaited<ReturnType<typeof AutoModelForSequenceClassification.from_pretrained>>;
}

let handlePromise: Promise<CrossEncoderHandle> | undefined;

function getCrossEncoder(): Promise<CrossEncoderHandle> {
  handlePromise ??= (async () => {
    const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
    const model = await loadPipelineWithFallback((device) =>
      AutoModelForSequenceClassification.from_pretrained(MODEL_ID, { device }),
    );
    return { tokenizer, model };
  })();

  return handlePromise;
}

async function scoreTextPairWithHandle(handle: CrossEncoderHandle, input: string, candidateText: string): Promise<number> {
  const inputs = await handle.tokenizer(input, {
    text_pair: candidateText,
    padding: true,
    truncation: true,
  });
  const { logits } = await handle.model(inputs);
  return logits.data[0] as number;
}

function scoreCandidate(handle: CrossEncoderHandle, input: string, candidate: EmbeddingCandidate): Promise<number> {
  return scoreTextPairWithHandle(handle, input, describeNode(candidate.node));
}

/**
 * The raw (input, candidateText) cross-encoder score, with no graph node or gap-check wrapping -
 * for callers outside tier 2's own ambiguity arbitration that need the same model on plain
 * text pairs (e.g. the semantic cache's reuse-verification stage in semanticCache.ts). Loads
 * the same lazily-cached model instance `pickTiebreakCandidate` uses, so using both in one
 * process only pays the model-load cost once.
 */
export async function scoreTextPair(input: string, candidateText: string): Promise<number> {
  const handle = await getCrossEncoder();
  return scoreTextPairWithHandle(handle, input, candidateText);
}

/** The same empirically-calibrated gap (see module doc comment) exposed for other callers that
 * need to judge their own cross-encoder score gaps the same way `pickTiebreakCandidate` does. */
export const CROSS_ENCODER_MIN_GAP = MIN_GAP;

/**
 * Picks the one candidate (already vetted as plausible by the embedding stage - see module
 * doc comment) the cross-encoder scores as the best match for `input`, but only if its score
 * clears the next-best candidate's by MIN_GAP. If the cross-encoder itself can't tell them
 * apart confidently, that's the same honest-miss signal as every other tier in this project -
 * returning undefined here, not an arbitrary pick of whichever happened to score a hair
 * higher.
 */
export async function pickTiebreakCandidate(
  input: string,
  candidates: EmbeddingCandidate[],
): Promise<EmbeddingCandidate | undefined> {
  if (candidates.length === 0) {
    return undefined;
  }

  const handle = await getCrossEncoder();
  const scored = await Promise.all(
    candidates.map(async (candidate) => ({ candidate, score: await scoreCandidate(handle, input, candidate) })),
  );

  scored.sort((left, right) => right.score - left.score);
  const [best, second] = scored;

  if (!best) {
    return undefined;
  }

  if (second && best.score - second.score < MIN_GAP) {
    return undefined;
  }

  return best.candidate;
}

/** Resets the cached tokenizer/model - for tests only, so each test run loads cleanly. */
export function resetRerankerForTests(): void {
  handlePromise = undefined;
}
