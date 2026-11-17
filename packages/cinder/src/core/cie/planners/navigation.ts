// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import type { CinderResolvedIntent } from "../../../types.js";
import {
  buildAmbiguityReason,
  createIntent,
  createUnknownIntent,
  findBestCandidateOutcome,
  scoreToConfidence,
  type CandidateOutcome,
  type CinderPlannerContext,
} from "./shared.js";

const NAVIGATION_PATTERNS = [
  /^(?:please\s+)?(?:open|go to|navigate to|take me to|show|show me|display|view|read)\s+(.+)$/,
  /^(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:open|go to|navigate to|take me to|show|show me|display|view|read)\s+(.+)$/,
  /^(?:i\s+(?:want|need)\s+to|let me)\s+(?:open|go to|navigate to|see|view|read)\s+(.+)$/,
] as const;

const LEADING_FILLER_TERMS = new Set(["me", "the", "a", "an", "please"]);
const ROUTE_RESOURCE_TERMS = new Set([
  "doc",
  "docs",
  "documentation",
  "page",
  "pages",
  "screen",
  "screens",
  "section",
  "sections",
  "article",
  "articles",
  "topic",
  "topics",
  "entry",
  "entries",
  "api",
  "apis",
  "method",
  "methods",
  "function",
  "functions",
  "reference",
  "references",
  "guide",
  "guides",
  "concept",
  "concepts",
  "tutorial",
  "tutorials",
  "overview",
]);

interface ScoredRouteOutcome extends CandidateOutcome {
  score: number;
  term: string;
}

function extractNavigationTerm(input: string): string | undefined {
  for (const pattern of NAVIGATION_PATTERNS) {
    const match = input.match(pattern);
    const routeTerm = match?.[1]?.trim();

    if (routeTerm) {
      return routeTerm;
    }
  }

  return undefined;
}

function pushUniqueVariant(target: string[], seen: Set<string>, value: string): void {
  const normalized = value.trim();

  if (!normalized || seen.has(normalized)) {
    return;
  }

  seen.add(normalized);
  target.push(normalized);
}

function trimLeadingTerms(tokens: string[], terms: Set<string>): string[] {
  let start = 0;

  while (start < tokens.length && terms.has(tokens[start]!)) {
    start += 1;
  }

  return tokens.slice(start);
}

function createRouteTermVariants(routeTerm: string): string[] {
  const tokens = routeTerm.trim().split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  const variants: string[] = [];

  pushUniqueVariant(variants, seen, tokens.join(" "));

  const withoutLeadingFillers = trimLeadingTerms(tokens, LEADING_FILLER_TERMS);
  pushUniqueVariant(variants, seen, withoutLeadingFillers.join(" "));

  const withoutLeadingQualifiers = trimLeadingTerms(withoutLeadingFillers, ROUTE_RESOURCE_TERMS);
  pushUniqueVariant(variants, seen, withoutLeadingQualifiers.join(" "));

  let trailingTrimmed = [...withoutLeadingFillers];
  while (trailingTrimmed.length > 0 && ROUTE_RESOURCE_TERMS.has(trailingTrimmed[trailingTrimmed.length - 1]!)) {
    trailingTrimmed = trailingTrimmed.slice(0, -1);
    pushUniqueVariant(variants, seen, trailingTrimmed.join(" "));
  }

  let fullyTrimmed = [...withoutLeadingQualifiers];
  while (fullyTrimmed.length > 0 && ROUTE_RESOURCE_TERMS.has(fullyTrimmed[fullyTrimmed.length - 1]!)) {
    fullyTrimmed = fullyTrimmed.slice(0, -1);
    pushUniqueVariant(variants, seen, fullyTrimmed.join(" "));
  }

  return variants;
}

function chooseBestRouteOutcome(
  left: ScoredRouteOutcome | undefined,
  right: ScoredRouteOutcome,
): ScoredRouteOutcome {
  if (!left) {
    return right;
  }

  if (right.score !== left.score) {
    return right.score > left.score ? right : left;
  }

  return right.term.length > left.term.length ? right : left;
}

function resolveRouteOutcome(
  context: CinderPlannerContext,
  routeTerm: string,
): ScoredRouteOutcome | undefined {
  let bestResolved: ScoredRouteOutcome | undefined;
  let bestAmbiguous: ScoredRouteOutcome | undefined;

  for (const candidateTerm of createRouteTermVariants(routeTerm)) {
    const outcome = findBestCandidateOutcome(context.cge, context.snapshot, candidateTerm, ["route"]);
    const score = outcome.candidates?.[0]?.score ?? 0;

    if (outcome.node) {
      bestResolved = chooseBestRouteOutcome(bestResolved, {
        ...outcome,
        score,
        term: candidateTerm,
      });
      continue;
    }

    if (outcome.candidates) {
      bestAmbiguous = chooseBestRouteOutcome(bestAmbiguous, {
        ...outcome,
        score,
        term: candidateTerm,
      });
    }
  }

  return bestResolved ?? bestAmbiguous;
}

export function matchNavigationPlanner({ cge, snapshot, normalizedInput, runtimeContext }: CinderPlannerContext): CinderResolvedIntent | undefined {
  const routeTerm = extractNavigationTerm(normalizedInput.normalized);

  if (!routeTerm) {
    return undefined;
  }

  const outcome = resolveRouteOutcome({ cge, snapshot, normalizedInput, runtimeContext }, routeTerm);

  if (outcome?.candidates && !outcome.node) {
    return createUnknownIntent(
      normalizedInput,
      buildAmbiguityReason("route", outcome.candidates),
      runtimeContext,
    );
  }

  const route = outcome?.node;

  if (!route) {
    return undefined;
  }

  return createIntent(normalizedInput, "navigate", {
    target: route.key,
    confidence: scoreToConfidence(outcome?.score ?? 0),
    matchedNodeIds: [route.id],
    context: {
      route: route.key,
    },
    steps: [{ type: "navigate", target: route.key }],
  }, runtimeContext);
}
