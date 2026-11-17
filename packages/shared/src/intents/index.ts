// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import type { CinderGraphNode } from "../graph/index.js";

export interface CinderNormalizedInput {
  raw: string;
  normalized: string;
  tokens: string[];
}

export interface CinderGraphQueryCandidate {
  node: CinderGraphNode;
  score: number;
  matchType:
    | "key-exact"
    | "alias-exact"
    | "key-includes"
    | "alias-includes"
    | "key-token-overlap"
    | "alias-token-overlap"
    | "key-fuzzy-overlap"
    | "alias-fuzzy-overlap";
}

export interface CinderResolutionStep {
  type:
    | "navigate"
    | "trigger_action"
    | "set_field"
    | "set_filter"
    | "show_output"
    | "search";
  target?: string;
  value?: unknown;
}

export interface CinderResolvedIntent {
  intent: string;
  target?: string;
  value?: unknown;
  steps?: CinderResolutionStep[];
  confidence: number;
  /**
   * "embedding" is a client-side small-model match (tier 2: @usecinder/embeddings) - distinct
   * from "local" (the deterministic graph engine, tier 1) and "cloud" (a real network LLM
   * call, tier 3), since it's neither a graph match nor a network round-trip.
   *
   * "cache" marks a result replayed from the semantic cache
   * (@usecinder/embeddings' createSemanticCachingLlmCore) rather than freshly resolved - a
   * previous tier-3 (or other fallback) answer reused because the current input embedded
   * close enough to one already resolved for the same graph state. Kept distinct from
   * "cloud"/"embedding" so callers can tell a replayed answer from a freshly-computed one
   * (e.g. for cost/latency metrics).
   */
  source: "local" | "cloud" | "hybrid" | "embedding" | "cache";
  context?: Record<string, unknown>;
  matchedNodeIds?: string[];
  normalizedInput: CinderNormalizedInput;
  reason?: string;
}

export type CinderBindingType = "route" | "action" | "field" | "filter" | "output";

export interface CinderDispatchContext {
  intent: CinderResolvedIntent;
  step: CinderResolutionStep;
  snapshot: import("../graph/index.js").CinderGraphSnapshot;
  node?: CinderGraphNode;
  root?: ParentNode | Document;
}

export type CinderBindingHandler = (
  context: CinderDispatchContext,
) => void | Promise<void>;

export interface CinderDispatchResult {
  ok: boolean;
  handled: boolean;
  mode: "binding" | "dom" | "composite" | "none";
  executedSteps: CinderResolutionStep[];
  errors: string[];
  /**
   * Non-fatal issues surfaced alongside a successful dispatch - e.g. a composite command
   * executing its steps out of a declared data-cinder-depends-on order. Unlike `errors`, a
   * non-empty `warnings` array does NOT affect `ok`: the command still ran, this is
   * informational for the caller (or a future AI fallback) to act on if it chooses to.
   */
  warnings?: string[];
}

export type CinderReflexKind = "success" | "error" | "clarification" | "info";

export interface CinderReflexOptions {
  speak?: boolean;
}

export interface CinderReflexResult {
  ok: boolean;
  kind: CinderReflexKind;
  message: string;
  spoken: boolean;
  intent: CinderResolvedIntent;
  dispatch?: CinderDispatchResult;
}

export type CinderReflexHandler = (
  result: CinderReflexResult,
) => void | Promise<void>;

export interface CinderRunResult {
  intent: CinderResolvedIntent;
  dispatch: CinderDispatchResult;
  reflex: CinderReflexResult;
}
