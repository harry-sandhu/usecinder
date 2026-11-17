import type { LLMAdapter } from "@cinder/shared";
import type { CinderServerConfig } from "../core/config.js";
import { createAnthropicProvider } from "./cloud/anthropicProvider.js";
import { createOpenAiProvider } from "./cloud/openaiProvider.js";
import { createCloudAdapter } from "./cloudAdapter.js";
import { createHeuristicAdapter } from "./heuristicAdapter.js";

export function createAdapter(config: Required<CinderServerConfig>): LLMAdapter {
  if (config.provider === "anthropic") {
    if (!config.providerApiKey) {
      throw new Error(
        "provider is set to \"anthropic\" but no API key was given (set ANTHROPIC_API_KEY, or pass providerApiKey).",
      );
    }

    return createCloudAdapter(
      createAnthropicProvider({
        apiKey: config.providerApiKey,
        model: config.providerModel || undefined,
        baseUrl: config.providerBaseUrl || undefined,
      }),
    );
  }

  if (config.provider === "openai") {
    if (!config.providerApiKey) {
      throw new Error(
        "provider is set to \"openai\" but no API key was given (set OPENAI_API_KEY, or pass providerApiKey).",
      );
    }

    return createCloudAdapter(
      createOpenAiProvider({
        apiKey: config.providerApiKey,
        model: config.providerModel || undefined,
        baseUrl: config.providerBaseUrl || undefined,
      }),
    );
  }

  return createHeuristicAdapter();
}

export { createAnthropicProvider, ANTHROPIC_DEFAULT_MODEL } from "./cloud/anthropicProvider.js";
export { createOpenAiProvider, OPENAI_DEFAULT_MODEL } from "./cloud/openaiProvider.js";
export {
  CompletionProviderError,
  getCompletionText,
  getCompletionUsage,
  type CompletionProvider,
  type CompletionRequest,
  type CompletionResult,
  type CompletionUsage,
} from "./cloud/completionProvider.js";
export { createCloudAdapter } from "./cloudAdapter.js";
export { createHeuristicAdapter } from "./heuristicAdapter.js";
