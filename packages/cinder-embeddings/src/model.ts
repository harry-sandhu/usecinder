// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
/**
 * Lazy-loaded sentence-embedding pipeline. See deviceSelection.ts for the WebGPU-first,
 * environment-aware-fallback logic (and the two real bugs, found via real-browser testing,
 * that it exists to avoid).
 *
 * The model is NOT loaded until the first actual call that needs it (getEmbedder is only
 * invoked from infer(), which only runs when tier 1 already failed) - this package adds
 * zero load-time cost to a page that never needs tier 2.
 */
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { loadPipelineWithFallback } from "./deviceSelection.js";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

let pipelinePromise: Promise<FeatureExtractionPipeline> | undefined;

export function getEmbedder(): Promise<FeatureExtractionPipeline> {
  pipelinePromise ??= loadPipelineWithFallback(
    (device) => pipeline("feature-extraction", MODEL_ID, { device }) as Promise<FeatureExtractionPipeline>,
  );

  return pipelinePromise;
}

/**
 * Computes a single mean-pooled, L2-normalized embedding vector for `text`. Normalizing here
 * means similarity.ts can use a plain dot product instead of a full cosine-similarity
 * division - same math, one less division per comparison.
 */
export async function embed(text: string): Promise<Float32Array> {
  const embedder = await getEmbedder();
  const output = await embedder(text, { pooling: "mean", normalize: true });
  return output.data as Float32Array;
}

/** Resets the cached pipeline - for tests only, so each test run loads cleanly. */
export function resetEmbedderForTests(): void {
  pipelinePromise = undefined;
}
