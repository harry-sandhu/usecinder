// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import type { CinderResolvedIntent } from "../../../types.js";
import {
  buildAmbiguityReason,
  createIntent,
  createUnknownIntent,
  findBestCandidateOutcome,
  scoreToConfidence,
  type CinderPlannerContext,
} from "./shared.js";

export function matchOutputPlanner({ cge, snapshot, normalizedInput, runtimeContext }: CinderPlannerContext): CinderResolvedIntent | undefined {
  const match = normalizedInput.normalized.match(/^(show|read|display|view|check|get)\s+(.+)$/);

  if (!match) {
    return undefined;
  }

  const outputTerm = match[2]?.trim();

  if (!outputTerm) {
    return undefined;
  }

  const outcome = findBestCandidateOutcome(cge, snapshot, outputTerm, ["output"], {
    graphPreference: "hot-only",
  });

  if (outcome.candidates && !outcome.node) {
    return createUnknownIntent(
      normalizedInput,
      buildAmbiguityReason("output", outcome.candidates),
      runtimeContext,
    );
  }

  const output = outcome.node;

  if (!output) {
    return undefined;
  }

  return createIntent(normalizedInput, "show_output", {
    target: output.key,
    confidence: scoreToConfidence(outcome.candidates?.[0]?.score ?? 0),
    matchedNodeIds: [output.id],
    context: {
      output: output.key,
      contextId: output.contextId,
    },
    steps: [{ type: "show_output", target: output.key }],
  }, runtimeContext);
}
