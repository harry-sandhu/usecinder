import type {
  CinderResolutionStep,
  InferIntentRequest,
  InferIntentResponse,
  LLMAdapter,
} from "@cinder/shared";

function normalizeRouteKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeTerm(value: string): string {
  return normalizeRouteKey(value);
}

function findBestKnownKey(term: string, candidates?: string[]): string | undefined {
  if (!candidates || candidates.length === 0) {
    return undefined;
  }

  const normalizedTerm = normalizeTerm(term);
  const normalizedCandidates = candidates.map((candidate) => ({
    raw: candidate,
    normalized: normalizeTerm(candidate),
  }));

  const exact = normalizedCandidates.find((candidate) => candidate.normalized === normalizedTerm);
  if (exact) {
    return exact.raw;
  }

  const includes = normalizedCandidates.find((candidate) => {
    return candidate.normalized.includes(normalizedTerm) || normalizedTerm.includes(candidate.normalized);
  });

  return includes?.raw;
}

function getContextString(input: InferIntentRequest, keys: string[]): string | undefined {
  for (const key of keys) {
    const contextValue = input.context?.[key];
    if (typeof contextValue === "string" && contextValue.trim()) {
      return contextValue.trim();
    }

    const selectionValue = input.graph?.selections?.[key];
    if (typeof selectionValue === "string" && selectionValue.trim()) {
      return selectionValue.trim();
    }
  }

  return undefined;
}

function findCrop(input: InferIntentRequest): string | undefined {
  const text = input.text.toLowerCase();
  const known = ["soybean", "paddy", "rice", "wheat", "corn", "maize"];
  return known.find((item) => text.includes(item)) ?? getContextString(input, ["crop"]);
}

function findLocation(input: InferIntentRequest): string | undefined {
  const text = input.text.toLowerCase();
  const fromContext = getContextString(input, ["district", "state", "location"]);

  if (fromContext) {
    return fromContext;
  }

  const match = text.match(/\bin\s+([a-z0-9\s-]+)$/i);
  return match?.[1]?.trim();
}

export function createHeuristicAdapter(): LLMAdapter {
  return {
    async infer(input: InferIntentRequest): Promise<InferIntentResponse> {
      const text = input.text.trim().toLowerCase();
      const crop = findCrop(input);
      const location = findLocation(input);

      const navigation = text.match(/^(open|go to|take me to)\s+(.+)$/);
      if (navigation?.[2]) {
        const target =
          findBestKnownKey(navigation[2], input.graph?.routes) ??
          normalizeRouteKey(navigation[2]);

        return {
          intent: "navigate",
          target,
          confidence: 0.82,
          context: {
            route: target,
          },
          source: "cloud",
        };
      }

      if (text.includes("weather")) {
        return {
          intent: "show_output",
          target: findBestKnownKey("weather", input.graph?.outputs) ?? "weather",
          confidence: 0.8,
          context: {
            location,
          },
          source: "cloud",
        };
      }

      if (
        text.includes("price") ||
        text.includes("prices") ||
        text.includes("market") ||
        text.includes("cheapest")
      ) {
        const outputTarget =
          findBestKnownKey("price", input.graph?.outputs) ??
          findBestKnownKey("prices", input.graph?.outputs) ??
          "price";
        const steps: CinderResolutionStep[] = [];

        if (crop) {
          steps.push({
            type: "set_filter",
            target: findBestKnownKey("crop", input.graph?.filters) ?? "crop",
            value: crop,
          });
        }

        if (location) {
          const locationFilter =
            findBestKnownKey("state", input.graph?.filters) ??
            findBestKnownKey("location", input.graph?.filters) ??
            findBestKnownKey("district", input.graph?.filters);

          if (locationFilter) {
            steps.push({
              type: "set_filter",
              target: locationFilter,
              value: location,
            });
          }
        }

        const searchAction = findBestKnownKey("search", input.graph?.actions);
        if (searchAction) {
          steps.push({
            type: "trigger_action",
            target: searchAction,
          });
        }

        steps.push({
          type: "show_output",
          target: outputTarget,
        });

        return {
          intent: "composite_flow",
          target: outputTarget,
          confidence: text.includes("cheapest") ? 0.9 : 0.78,
          entities: {
            crop,
            location,
            sort: text.includes("cheapest") ? "lowest_price" : undefined,
            time: text.includes("today") ? "today" : undefined,
          },
          context: {
            location,
            activeRoute: input.graph?.activeRoute,
            activeContext: input.graph?.activeContext,
          },
          steps,
          reply:
            crop && location
              ? `${crop} price information is available for ${location}.`
              : crop
                ? `${crop} price information is available.`
                : "Price information is available.",
          source: "cloud",
        };
      }

      return {
        intent: null,
        confidence: 0.2,
        reply: "I could not infer a structured intent from that request.",
        source: "cloud",
      };
    },
  };
}
