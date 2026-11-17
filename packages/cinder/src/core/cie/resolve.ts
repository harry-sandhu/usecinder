import type {
  CinderGraphSnapshot,
  CinderIntentMatcher,
  CinderIntentMatcherContext,
  CinderNormalizedInput,
  CinderResolvedIntent,
  CinderRuntimeContext,
} from "../../types.js";
import type { CinderGraphQueryEngine } from "../cge/index.js";
import { normalizeInput } from "./normalizer.js";
import { matchActionPlanner } from "./planners/action.js";
import { matchClearFilterPlanner } from "./planners/clearFilter.js";
import { matchCompositePlanner } from "./planners/composite.js";
import { matchFilterByValuePlanner } from "./planners/filterByValue.js";
import { matchNavigationPlanner } from "./planners/navigation.js";
import { matchNumericComparisonPlanner } from "./planners/numericComparison.js";
import { matchOutputPlanner } from "./planners/output.js";
import { matchSearchFieldPlanner } from "./planners/searchField.js";
import { matchSetValuePlanner } from "./planners/setValue.js";
import { createUnknownIntent, type CinderPlannerContext } from "./planners/shared.js";
import {
  createReferenceState,
  rememberResolved,
  substituteTrailingReference,
  tryResolveRepeat,
} from "./referenceCarryover.js";

/**
 * CINDER'S LOCAL RESOLUTION ESCALATION POLICY
 *
 * Named and written down explicitly here, per tier-1 research into established local/
 * offline NLU engines (docs/local-engine-fully-fledged-plan.md §11): Mycroft AI's own
 * intent-parser stack publishes its exact resolution order
 * (Padatious High -> Adapt -> Fallback High -> ...) so it's auditable, rather than leaving
 * an escalation ladder implicit across several functions. Cinder's ladder already existed in
 * the code before this comment did - nothing below changes behavior, this just names the
 * policy in one place instead of leaving it to be reverse-engineered from five files.
 *
 * For a single resolve() call, in order:
 *
 *   1. REFERENCE CARRYOVER (referenceCarryover.ts) - a fixed, narrow set of "repeat the
 *      last command" or "re-target the last command's node" phrases, checked first so they
 *      can't be mis-parsed by a planner that happens to also match a literal word like
 *      "that". Falls through immediately (no match at all) if there's no prior command or
 *      the phrase isn't recognized - this tier either fires cleanly or doesn't exist.
 *
 *   2. REGISTERED CUSTOM MATCHERS - whatever the embedding app registered via
 *      registerIntent(), tried in registration order, each wrapped in try/catch so one
 *      throwing matcher can't break resolution for anyone else.
 *
 *   3. COMPOSITE SPLIT (composite.ts) - "do X and Y" tried as multiple clauses, each run
 *      back through this same ladder (steps 2-4) independently. Only wins if EVERY clause
 *      resolves; otherwise falls through to the ordinary whole-string attempt below, so a
 *      value that happens to contain "and" isn't wrongly split.
 *
 *   4. WHOLE-STRING PLANNERS, in this fixed order: clear-filter (clearFilter.ts, a bounded
 *      negation case - "clear/remove/reset the X filter") -> set-value (setValue.ts) ->
 *      numeric-comparison (numericComparison.ts, "amount over 100" without "set...to"
 *      phrasing) -> search-field (searchField.ts) -> navigation (navigation.ts) -> output
 *      (output.ts) -> action (action.ts). Each planner has its OWN internal match-tier ladder (see
 *      queryEngine.ts's scoreNodeMatch): exact key/alias match -> substring containment ->
 *      full-token-overlap -> length-scaled typo-tolerant fuzzy match - strongest signal
 *      first, down to the loosest tier that still refuses to guess across an ambiguous tie
 *      (shared.ts's isAmbiguous gate applies at every tier).
 *
 *   5. UNKNOWN - if nothing above matched, resolve() returns the "unknown" intent honestly
 *      rather than guessing. This is the hook classifyRunResult (core/cie/outcome.ts) and,
 *      eventually, tier 2 (a client-side embedding model) and tier 3 (a real cloud LLM
 *      fallback - not yet built) are meant to key off of.
 */
export interface CinderIntentEngine {
  kind: "CIE";
  normalize(input: string): CinderNormalizedInput;
  registerIntent(matcher: CinderIntentMatcher): void;
  unregisterIntent(id: string): void;
  getIntents(): CinderIntentMatcher[];
  resolve(
    snapshot: CinderGraphSnapshot,
    input: string,
    cge: CinderGraphQueryEngine,
    runtimeContext?: CinderRuntimeContext,
  ): CinderResolvedIntent;
}

export function createIntentEngine(): CinderIntentEngine {
  const intentMatchers = new Map<string, CinderIntentMatcher>();
  const referenceState = createReferenceState();

  return {
    kind: "CIE",

    normalize(input) {
      return normalizeInput(input);
    },

    registerIntent(matcher) {
      intentMatchers.set(matcher.id, matcher);
    },

    unregisterIntent(id) {
      intentMatchers.delete(id);
    },

    getIntents() {
      return [...intentMatchers.values()];
    },

    resolve(snapshot, input, cge, runtimeContext) {
      const normalizedInput = normalizeInput(input);

      if (!normalizedInput.normalized) {
        return createUnknownIntent(normalizedInput, "Input is empty after normalization.", runtimeContext);
      }

      // Narrow reference carryover (see referenceCarryover.ts for exactly what this does and
      // does not cover) - checked first, before anything else, so "again" or "show that"
      // never gets a chance to be mis-parsed by a planner that happens to also match the
      // literal word "that"/"it".
      const repeated = tryResolveRepeat(referenceState, normalizedInput);

      if (repeated) {
        rememberResolved(referenceState, repeated, snapshot);
        return repeated;
      }

      const referenceSubstitutedInput = substituteTrailingReference(referenceState, input);
      const effectiveInput = referenceSubstitutedInput ?? input;
      const effectiveNormalizedInput = referenceSubstitutedInput
        ? normalizeInput(referenceSubstitutedInput)
        : normalizedInput;

      const resolveSingleClause = (clauseInput: string): CinderResolvedIntent | undefined => {
        const clauseNormalizedInput = normalizeInput(clauseInput);

        if (!clauseNormalizedInput.normalized) {
          return undefined;
        }

        const matcherContext: CinderIntentMatcherContext = {
          input: clauseInput,
          normalizedInput: clauseNormalizedInput,
          snapshot,
          runtimeContext,
        };

        for (const matcher of intentMatchers.values()) {
          try {
            const matchedIntent = matcher.match(matcherContext);

            if (matchedIntent) {
              return matchedIntent;
            }
          } catch {
            continue;
          }
        }

        const clausePlannerContext: CinderPlannerContext = {
          snapshot,
          normalizedInput: clauseNormalizedInput,
          runtimeContext,
          cge,
        };

        return (
          matchClearFilterPlanner(clausePlannerContext) ??
          matchSetValuePlanner(clausePlannerContext) ??
          matchNumericComparisonPlanner(clausePlannerContext) ??
          matchSearchFieldPlanner(clausePlannerContext) ??
          matchFilterByValuePlanner(clausePlannerContext) ??
          matchNavigationPlanner(clausePlannerContext) ??
          matchOutputPlanner(clausePlannerContext) ??
          matchActionPlanner(clausePlannerContext) ??
          undefined
        );
      };

      // Composite split is tried BEFORE a whole-string single match. A greedy single-clause
      // planner (e.g. "set X to <rest of string>") can otherwise swallow a second clause as
      // part of its value and report a wrong answer with high confidence instead of
      // correctly recognizing "do X and Y" as two commands. Composite only wins when every
      // split clause independently resolves; otherwise this falls through to the ordinary
      // whole-string match, so a legitimate single value that happens to contain "and"
      // (e.g. "set team to Bonnie and Clyde") still resolves correctly as one command.
      const rawResult =
        matchCompositePlanner(effectiveInput, effectiveNormalizedInput, resolveSingleClause) ??
        resolveSingleClause(effectiveInput) ??
        createUnknownIntent(
          effectiveNormalizedInput,
          "No local graph-based planner matched the input.",
          runtimeContext,
        );

      // Matching ran against the substituted text ("show price"), but the result reported
      // back to the caller should reflect what the user actually typed ("show that") - the
      // substitution was an internal matching detail, not something to hide the real input
      // behind.
      const result: CinderResolvedIntent = referenceSubstitutedInput
        ? {
            ...rawResult,
            normalizedInput,
            ...(rawResult.intent !== "unknown"
              ? { reason: `Resolved by treating a trailing reference word as the previous command's target ("${effectiveInput}").` }
              : {}),
          }
        : rawResult;

      rememberResolved(referenceState, result, snapshot);
      return result;
    },
  };
}
