import { CompletionProviderError, type CompletionProvider, type CompletionRequest, type CompletionResult } from "./completionProvider.js";

// OpenAI's model lineup changes independently of this codebase - verify/override via the
// model option or CINDER_OPENAI_MODEL before relying on this default in production.
export const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_MODEL = OPENAI_DEFAULT_MODEL;
const DEFAULT_BASE_URL = "https://api.openai.com";

export interface OpenAiProviderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

interface OpenAiChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function createOpenAiProvider(options: OpenAiProviderOptions): CompletionProvider {
  const model = options.model?.trim() || DEFAULT_MODEL;
  const baseUrl = (options.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");

  return {
    name: "openai",
    async complete({ system, user, maxTokens }: CompletionRequest): Promise<CompletionResult> {
      let response: Response;

      try {
        response = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens ?? 512,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
        });
      } catch (error) {
        throw new CompletionProviderError("OpenAI request failed to send.", "openai", error);
      }

      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        throw new CompletionProviderError(
          `OpenAI API returned ${response.status}: ${bodyText.slice(0, 300)}`,
          "openai",
        );
      }

      const payload = (await response.json()) as OpenAiChatCompletionResponse;
      const text = payload.choices?.[0]?.message?.content;

      if (!text) {
        throw new CompletionProviderError("OpenAI response had no message content.", "openai");
      }

      const inputTokens = payload.usage?.prompt_tokens;
      const outputTokens = payload.usage?.completion_tokens;

      return {
        text,
        usage:
          typeof inputTokens === "number" && typeof outputTokens === "number"
            ? { inputTokens, outputTokens }
            : undefined,
      };
    },
  };
}
