import type { CinderResolvedIntent } from "../../../types.js";
import {
  createHotGraphQueryOptionsFromNode,
  createIntent,
  findBestCandidateOutcome,
  findBestCandidateOutcomeWithFallback,
  findNodeInActiveContext,
  getRuntimeContextString,
  type CinderPlannerContext,
} from "./shared.js";

export function matchSearchFlowPlanner({ cge, snapshot, normalizedInput, runtimeContext }: CinderPlannerContext): CinderResolvedIntent | undefined {
  const hasPriceWord = /\bprice\b|\bprices\b/.test(normalizedInput.normalized);
  const hasInPattern = /\bin\s+([a-z0-9\s-]+)$/.exec(normalizedInput.normalized);

  if (!hasPriceWord) {
    return undefined;
  }

  const priceOutput =
    findNodeInActiveContext(snapshot, "output", "price", { hotOnly: true }) ??
    findBestCandidateOutcome(cge, snapshot, "price", ["output"], {
      graphPreference: "hot-only",
    }).node;

  const coherentOptions = createHotGraphQueryOptionsFromNode(priceOutput);
  const cropFilter =
    findNodeInActiveContext(snapshot, "filter", "crop", { hotOnly: true }) ??
    findBestCandidateOutcomeWithFallback(cge, snapshot, "crop", ["filter"], coherentOptions, {
      graphPreference: "hot-only",
    }).node;
  const stateFilter =
    findNodeInActiveContext(snapshot, "filter", "state", { hotOnly: true }) ??
    findBestCandidateOutcomeWithFallback(cge, snapshot, "state", ["filter"], coherentOptions, {
      graphPreference: "hot-only",
    }).node;
  const districtFilter =
    findNodeInActiveContext(snapshot, "filter", "district", { hotOnly: true }) ??
    findBestCandidateOutcomeWithFallback(cge, snapshot, "district", ["filter"], coherentOptions, {
      graphPreference: "hot-only",
    }).node;
  const searchAction =
    findNodeInActiveContext(snapshot, "action", "search", { hotOnly: true }) ??
    findBestCandidateOutcomeWithFallback(cge, snapshot, "search", ["action"], coherentOptions, {
      graphPreference: "hot-only",
    }).node;

  if (!priceOutput) {
    return undefined;
  }

  const steps = [] as Array<{
    type: "set_filter" | "trigger_action" | "show_output";
    target?: string;
    value?: unknown;
  }>;
  const matchedNodeIds = [priceOutput.id];
  const context: Record<string, unknown> = {
    output: priceOutput.key,
    contextId: priceOutput.contextId,
  };

  const beforePrice = normalizedInput.normalized.split(/\bprices?\b/)[0]?.trim();
  const derivedCropValue = beforePrice?.replace(/^(show|find|lookup)\s+/, "").trim();
  const cropValue =
    derivedCropValue && !["show", "find", "lookup"].includes(derivedCropValue)
      ? derivedCropValue
      : getRuntimeContextString(runtimeContext, ["crop"]);

  if (cropFilter && cropValue) {
    steps.push({ type: "set_filter", target: cropFilter.key, value: cropValue });
    matchedNodeIds.push(cropFilter.id);
    context.crop = cropValue;
  }

  const stateValue =
    hasInPattern?.[1]?.trim() ||
    getRuntimeContextString(runtimeContext, ["state", "location"]);
  const districtValue = getRuntimeContextString(runtimeContext, ["district"]);
  const hasCompositeSignal = Boolean(cropValue || stateValue || districtValue) || /\b(find|lookup|search|market|cheapest)\b/.test(normalizedInput.normalized);

  if (!hasCompositeSignal) {
    return undefined;
  }

  if (stateFilter && stateValue) {
    steps.push({ type: "set_filter", target: stateFilter.key, value: stateValue });
    matchedNodeIds.push(stateFilter.id);
    context.state = stateValue;
  } else if (districtFilter && districtValue) {
    steps.push({ type: "set_filter", target: districtFilter.key, value: districtValue });
    matchedNodeIds.push(districtFilter.id);
    context.district = districtValue;
  }

  if (searchAction) {
    steps.push({ type: "trigger_action", target: searchAction.key });
    matchedNodeIds.push(searchAction.id);
  }

  steps.push({ type: "show_output", target: priceOutput.key });

  return createIntent(normalizedInput, "composite_flow", {
    target: priceOutput.key,
    confidence: 0.84,
    matchedNodeIds,
    context,
    steps,
  }, runtimeContext);
}
