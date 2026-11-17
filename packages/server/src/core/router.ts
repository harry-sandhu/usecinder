import type { FastifyInstance } from "fastify";
import type { LLMAdapter } from "@cinder/shared";
import type { TranscriptionProvider } from "../adapters/speech/transcriptionProvider.js";
import { registerHealthRoutes } from "../api/health/index.js";
import { registerLlmInferRoutes } from "../api/llm/infer.js";
import { registerSpeechTranscribeRoutes } from "../api/speech/transcribe.js";

export async function registerServerRoutes(
  app: FastifyInstance,
  options: {
    adapter: LLMAdapter;
    speechAdapter?: TranscriptionProvider;
    apiKey?: string;
  },
): Promise<void> {
  await registerHealthRoutes(app);
  await registerLlmInferRoutes(app, options);
  await registerSpeechTranscribeRoutes(app, { adapter: options.speechAdapter, apiKey: options.apiKey });
}
