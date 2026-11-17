// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { pipeline, type QuestionAnsweringPipeline } from "@huggingface/transformers";
import type { CinderGraphNode } from "usecinder";
import { loadPipelineWithFallback } from "./deviceSelection.js";

/**
 * The ML fallback for value extraction - only reached when valueExtraction.ts's compromise.js
 * pass finds no shape at all, or finds one it can't confidently pin to a real field/filter.
 * Reformulates "what value did the user give for field X" as extractive question answering
 * ("What is X set to?" against the user's sentence) - a standard, pretrained-once,
 * domain-agnostic NLU task (see docs/local-engine-fully-fledged-plan.md's research notes):
 * the model was never trained on any app's field names, the same way the embedding model in
 * this package was never trained on "loan status" or "shipping address" and still works.
 *
 * Found empirically unreliable in one specific way worth flagging: asked about a field that
 * is NOT what the sentence is really about, the model still confidently points at whatever
 * value-shaped span exists (SQuAD-style QA models are trained to always attempt an answer,
 * not to recognize "this question doesn't apply here" - there's no built-in "no answer"
 * signal to lean on). That is exactly why this never trusts a single candidate's score alone
 * - every field/filter candidate on the page is asked the same question, and a pick is only
 * trusted when it clearly beats every other candidate's answer for the same sentence,
 * mirroring the "require a real gap" principle already used by reranker.ts and
 * classifyMatchOutcome in this package.
 */
const MODEL_ID = "Xenova/distilbert-base-cased-distilled-squad";
const MIN_SCORE = 0.5;
const MIN_GAP = 0.15;

let qaPipelinePromise: Promise<QuestionAnsweringPipeline> | undefined;

export function resetQaPipelineForTests(): void {
  qaPipelinePromise = undefined;
}

async function getQaPipeline(): Promise<QuestionAnsweringPipeline> {
  qaPipelinePromise ??= loadPipelineWithFallback(
    (device) => pipeline("question-answering", MODEL_ID, { device }) as Promise<QuestionAnsweringPipeline>,
  );
  return qaPipelinePromise;
}

function questionForNode(node: CinderGraphNode): string {
  const label = (node.label ?? node.key.replace(/-/g, " ")).trim();
  return `What is ${label} set to?`;
}

export interface QaValueExtractionResult {
  node: CinderGraphNode;
  value: string;
  score: number;
}

/**
 * Asks every candidate the same question against the same sentence, and only returns a pick
 * when it clearly, unambiguously beats the rest - an honest miss (undefined) otherwise, never
 * a guess among several plausible-looking answers.
 */
export async function extractValueByQuestionAnswering(
  input: string,
  candidates: CinderGraphNode[],
): Promise<QaValueExtractionResult | undefined> {
  if (candidates.length === 0) {
    return undefined;
  }

  const qa = await getQaPipeline();
  const scored: QaValueExtractionResult[] = [];

  for (const node of candidates) {
    const result = await qa(questionForNode(node), input);
    const answer = Array.isArray(result) ? result[0] : result;

    if (answer && typeof answer.answer === "string" && answer.answer.trim()) {
      scored.push({ node, value: answer.answer.trim(), score: answer.score });
    }
  }

  scored.sort((left, right) => right.score - left.score);

  const [first, second] = scored;

  if (!first || first.score < MIN_SCORE) {
    return undefined;
  }

  if (second && first.score - second.score < MIN_GAP) {
    // Two different fields both looking like a plausible answer to "what did the user set
    // this to" is a genuine ambiguity - decline rather than guess which one was meant.
    return undefined;
  }

  return first;
}
