import type { InferIntentResponse } from "@cinder/shared";

const HONEST_MISS: InferIntentResponse = { intent: null, confidence: 0, source: "cloud" };

/**
 * Models that are told "respond with ONLY a JSON object" still sometimes wrap it in a
 * markdown code fence, or add a sentence before/after it - this strips that without being
 * clever about it: find the first `{` and the matching last `}`, nothing more exotic. Final
 * shape validation happens in @cinder/shared's normalizeInferIntentResponse (called by both
 * the server route and the client) - this function's only job is "did the model give us
 * something JSON-shaped at all," not full schema validation.
 */
function extractJsonObject(text: string): string | undefined {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return undefined;
  }

  return text.slice(firstBrace, lastBrace + 1);
}

/**
 * Never throws - a model that returned unparseable garbage is exactly the same honest-miss
 * situation as a model that said "I don't know," not a system error. The adapter's caller
 * decides whether an actual network/API failure (a thrown CompletionProviderError, handled
 * separately in cloudAdapter.ts) should be treated differently.
 */
export function parseCloudCompletion(rawText: string): InferIntentResponse {
  const jsonText = extractJsonObject(rawText);

  if (!jsonText) {
    return HONEST_MISS;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return HONEST_MISS;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return HONEST_MISS;
  }

  const record = parsed as Record<string, unknown>;
  const context = typeof record.context === "object" && record.context !== null ? { ...(record.context as Record<string, unknown>) } : undefined;

  // InferIntentResponse has no top-level "value" field - the client's own reader
  // (getResponseValue in packages/cinder/src/core/ai/llmCore.ts) only ever looks for it
  // under entities.value or context.value, so a single-step set_field/set_filter value has
  // to be placed there, not alongside intent/target/confidence.
  const entities =
    typeof record.entities === "object" && record.entities !== null
      ? { ...(record.entities as Record<string, unknown>) }
      : "value" in record
        ? { value: record.value }
        : undefined;

  return {
    intent: record.intent === null ? null : typeof record.intent === "string" ? record.intent : null,
    target: typeof record.target === "string" ? record.target : undefined,
    confidence: typeof record.confidence === "number" ? record.confidence : undefined,
    entities,
    steps: Array.isArray(record.steps) ? (record.steps as InferIntentResponse["steps"]) : undefined,
    context,
    reply: typeof record.reply === "string" ? record.reply : undefined,
    source: "cloud",
  };
}
