import type { CinderServerConfig } from "../../core/config.js";
import { createOpenAiTranscriptionProvider } from "./openaiTranscriptionProvider.js";
import type { TranscriptionProvider } from "./transcriptionProvider.js";

/**
 * Unlike createAdapter (adapters/index.ts), this does NOT throw when unconfigured - speech
 * transcription is an optional capability (known-limitations.md #3), not the server's primary
 * job. A server with no speechApiKey should still start and serve /v1/llm/infer fine; the
 * speech route itself reports 501 at request time when this returns undefined, which is the
 * honest "not configured," not a startup crash for a feature nobody asked for yet.
 */
export function createSpeechAdapter(
  config: Required<CinderServerConfig>,
): TranscriptionProvider | undefined {
  if (config.speechProvider !== "openai" || !config.speechApiKey) {
    return undefined;
  }

  return createOpenAiTranscriptionProvider({
    apiKey: config.speechApiKey,
    model: config.speechModel || undefined,
    baseUrl: config.speechBaseUrl || undefined,
  });
}

export { createOpenAiTranscriptionProvider } from "./openaiTranscriptionProvider.js";
export {
  TranscriptionProviderError,
  type TranscriptionProvider,
  type TranscriptionRequest,
} from "./transcriptionProvider.js";
