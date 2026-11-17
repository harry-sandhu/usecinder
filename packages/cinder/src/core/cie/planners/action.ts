// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import type { CinderResolvedIntent } from "../../../types.js";
import { isPlausibleCommand } from "../linguistics.js";
import {
  buildAmbiguityReason,
  createIntent,
  createUnknownIntent,
  findBestCandidateOutcome,
  scoreToConfidence,
  type CinderPlannerContext,
} from "./shared.js";

function findMatchedKeywordIndex(tokens: string[], nodeKey: string): number {
  const exactIndex = tokens.indexOf(nodeKey);

  if (exactIndex !== -1) {
    return exactIndex;
  }

  // The match may have been a substring/token-overlap match (key-includes, alias-includes,
  // key-token-overlap, ...) rather than a whole-token match, so no single token equals the
  // node key exactly. There's no reliable single token position to anchor on in that case -
  // fall back to tokens.length so hasNegationBefore scans the WHOLE sentence (it only checks
  // indices BEFORE the given position, so the fallback must be the end of the token array,
  // not 0 - 0 would scan zero tokens, the opposite of "check everything," and is exactly how
  // a real bug slipped through here: two real-site test sentences, "never open menu" and "do
  // not open menu," kept firing because this returned 0 and hasNegationBefore(tokens, 0)
  // trivially found nothing to check).
  return tokens.length;
}

export function matchActionPlanner({ cge, snapshot, normalizedInput, runtimeContext }: CinderPlannerContext): CinderResolvedIntent | undefined {
  const outcome = findBestCandidateOutcome(cge, snapshot, normalizedInput.normalized, ["action"], {
    graphPreference: "hot-only",
  });

  if (outcome.candidates && !outcome.node) {
    return createUnknownIntent(
      normalizedInput,
      buildAmbiguityReason("action", outcome.candidates),
      runtimeContext,
    );
  }

  const action = outcome.node;

  if (!action) {
    return undefined;
  }

  // Unlike navigate/output/set-value - which all require their verb to be the FIRST word of
  // the input, making them structurally immune to this - action matching is an unanchored
  // fuzzy match against the whole sentence (there's no single fixed leading verb to anchor
  // on: "search", "save", "click save" are all valid). That means a sentence merely
  // MENTIONING the action's name ("I don't want to search", "why would I search") would
  // otherwise match just as confidently as an actual command. isPlausibleCommand rejects the
  // negated/descriptive/question cases it can reliably detect - see linguistics.ts for what
  // it does and does not cover.
  if (!isPlausibleCommand(normalizedInput.tokens, findMatchedKeywordIndex(normalizedInput.tokens, action.key))) {
    return undefined;
  }

  return createIntent(normalizedInput, "trigger_action", {
    target: action.key,
    confidence: scoreToConfidence(outcome.candidates?.[0]?.score ?? 0),
    matchedNodeIds: [action.id],
    context: {
      action: action.key,
      contextId: action.contextId,
    },
    steps: [{ type: "trigger_action", target: action.key }],
  }, runtimeContext);
}
