import type { InferIntentRequest, InferIntentResponse, LLMAdapter } from "@cinder/shared";
import { CompletionProviderError, getCompletionText, type CompletionProvider } from "./cloud/completionProvider.js";
import { buildCloudPrompt } from "./cloud/promptBuilder.js";
import { parseCloudCompletion } from "./cloud/responseParser.js";

/**
 * The real tier-3 adapter - takes whichever CompletionProvider it's given (Anthropic, OpenAI,
 * or a test double - see validate-cloud-adapter.mjs) and turns an InferIntentRequest into an
 * InferIntentResponse via one real completion call. Replaces heuristicAdapter.ts, which was
 * hardcoded for a single crop-pricing demo scenario and never a real model at all (see
 * docs/local-engine-fully-fledged-plan.md: "the still-fake cloud tier-3 client").
 *
 * Deliberately thin: prompt construction (promptBuilder.ts) and response parsing
 * (responseParser.ts) are both separate, individually testable modules, so this file is just
 * the wiring between them and whatever provider was configured.
 */
export function createCloudAdapter(provider: CompletionProvider): LLMAdapter {
  return {
    async infer(input: InferIntentRequest): Promise<InferIntentResponse> {
      const { system, user } = buildCloudPrompt(input);

      let rawText: string;

      try {
        rawText = getCompletionText(await provider.complete({ system, user }));
      } catch (error) {
        // A network/API failure is a real error, not an honest "I don't know" - rethrow so
        // the server route's own error handling (502) reports it as a provider failure,
        // rather than silently reporting back a low-confidence miss that looks identical to
        // "the model genuinely found nothing."
        if (error instanceof CompletionProviderError) {
          throw error;
        }

        throw new CompletionProviderError(
          error instanceof Error ? error.message : "Cloud completion failed.",
          provider.name,
          error,
        );
      }

      return parseCloudCompletion(rawText);
    },
  };
}
