// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import type {
  CinderGraphNode,
  CinderIntentMatcher,
  CinderIntentMatcherContext,
} from "../../../types.js";

function getNodeContextId(node: CinderGraphNode | undefined): string | undefined {
  if (!node) {
    return undefined;
  }

  return node.type === "context" ? node.id : node.contextId;
}

function getNodeRouteId(node: CinderGraphNode | undefined): string | undefined {
  if (!node) {
    return undefined;
  }

  return node.type === "route" ? node.id : node.routeId;
}

function getRuntimeContextString(
  runtimeContext: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = runtimeContext?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function findBestNode(
  context: CinderIntentMatcherContext,
  type: CinderGraphNode["type"],
  key: string,
  options?: {
    preferredContextId?: string;
    preferredRouteId?: string;
  },
): CinderGraphNode | undefined {
  const candidates = context.snapshot.nodes.filter((node) => node.type === type && node.key === key);

  if (candidates.length === 0) {
    return undefined;
  }

  const sorted = [...candidates].sort((left, right) => {
    const leftContextId = getNodeContextId(left);
    const rightContextId = getNodeContextId(right);
    const leftRouteId = getNodeRouteId(left);
    const rightRouteId = getNodeRouteId(right);

    let leftScore = 0;
    let rightScore = 0;

    if (options?.preferredContextId) {
      if (leftContextId === options.preferredContextId) {
        leftScore += 50;
      }
      if (rightContextId === options.preferredContextId) {
        rightScore += 50;
      }
    }

    if (options?.preferredRouteId) {
      if (leftRouteId === options.preferredRouteId) {
        leftScore += 20;
      }
      if (rightRouteId === options.preferredRouteId) {
        rightScore += 20;
      }
    }

    if (context.snapshot.runtime.activeContextId) {
      if (leftContextId === context.snapshot.runtime.activeContextId) {
        leftScore += 15;
      }
      if (rightContextId === context.snapshot.runtime.activeContextId) {
        rightScore += 15;
      }
    }

    if (context.snapshot.runtime.activeRouteId) {
      if (leftRouteId === context.snapshot.runtime.activeRouteId) {
        leftScore += 8;
      }
      if (rightRouteId === context.snapshot.runtime.activeRouteId) {
        rightScore += 8;
      }
    }

    return rightScore - leftScore;
  });

  return sorted[0];
}

export interface AgriculturePriceFlowMatcherOptions {
  id?: string;
  cropFilterKey?: string;
  stateFilterKey?: string;
  districtFilterKey?: string;
  searchActionKey?: string;
  priceOutputKey?: string;
}

export function createAgriculturePriceFlowIntentMatcher(
  options?: AgriculturePriceFlowMatcherOptions,
): CinderIntentMatcher {
  const cropFilterKey = options?.cropFilterKey ?? "crop";
  const stateFilterKey = options?.stateFilterKey ?? "state";
  const districtFilterKey = options?.districtFilterKey ?? "district";
  const searchActionKey = options?.searchActionKey ?? "search";
  const priceOutputKey = options?.priceOutputKey ?? "price";

  return {
    id: options?.id ?? "preset:agriculture-price-flow",

    match(context) {
      const hasPriceWord = /\bprice\b|\bprices\b/.test(context.normalizedInput.normalized);
      const hasInPattern = /\bin\s+([a-z0-9\s-]+)$/.exec(context.normalizedInput.normalized);

      if (!hasPriceWord) {
        return undefined;
      }

      const beforePrice = context.normalizedInput.normalized.split(/\bprices?\b/)[0]?.trim();
      const derivedCropValue = beforePrice?.replace(/^(show|find|lookup)\s+/, "").trim();
      const cropValue =
        derivedCropValue && !["show", "find", "lookup"].includes(derivedCropValue)
          ? derivedCropValue
          : getRuntimeContextString(context.runtimeContext, ["crop"]);
      const stateValue =
        hasInPattern?.[1]?.trim() ||
        getRuntimeContextString(context.runtimeContext, ["state", "location"]);
      const districtValue = getRuntimeContextString(context.runtimeContext, ["district"]);
      const hasCompositeSignal = Boolean(cropValue || stateValue || districtValue) || /\b(find|lookup|search|market|cheapest)\b/.test(context.normalizedInput.normalized);

      if (!hasCompositeSignal) {
        return undefined;
      }

      const priceOutput = findBestNode(context, "output", priceOutputKey);

      if (!priceOutput) {
        return undefined;
      }

      const coherentContextId = getNodeContextId(priceOutput);
      const coherentRouteId = getNodeRouteId(priceOutput);
      const coherentOptions = {
        preferredContextId: coherentContextId,
        preferredRouteId: coherentRouteId,
      };

      const cropFilter = findBestNode(context, "filter", cropFilterKey, coherentOptions);
      const stateFilter = findBestNode(context, "filter", stateFilterKey, coherentOptions);
      const districtFilter = findBestNode(context, "filter", districtFilterKey, coherentOptions);
      const searchAction = findBestNode(context, "action", searchActionKey, coherentOptions);

      const steps = [];
      const matchedNodeIds = [priceOutput.id];
      const resultContext = {
        output: priceOutput.key,
        contextId: priceOutput.contextId,
      } as Record<string, unknown>;

      if (cropFilter && cropValue) {
        steps.push({ type: "set_filter" as const, target: cropFilter.key, value: cropValue });
        matchedNodeIds.push(cropFilter.id);
        resultContext.crop = cropValue;
      }

      if (stateFilter && stateValue) {
        steps.push({ type: "set_filter" as const, target: stateFilter.key, value: stateValue });
        matchedNodeIds.push(stateFilter.id);
        resultContext.state = stateValue;
      } else if (districtFilter && districtValue) {
        steps.push({ type: "set_filter" as const, target: districtFilter.key, value: districtValue });
        matchedNodeIds.push(districtFilter.id);
        resultContext.district = districtValue;
      }

      if (searchAction) {
        steps.push({ type: "trigger_action" as const, target: searchAction.key });
        matchedNodeIds.push(searchAction.id);
      }

      steps.push({ type: "show_output" as const, target: priceOutput.key });

      return {
        intent: "composite_flow",
        target: priceOutput.key,
        confidence: 0.84,
        source: "local",
        normalizedInput: context.normalizedInput,
        matchedNodeIds,
        context: {
          ...(context.runtimeContext ?? {}),
          ...resultContext,
        },
        steps,
      };
    },
  };
}
