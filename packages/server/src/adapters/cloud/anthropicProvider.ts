import { CompletionProviderError, type CompletionProvider, type CompletionRequest, type CompletionResult } from "./completionProvider.js";

export const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-5-5";
const DEFAULT_MODEL = ANTHROPIC_DEFAULT_MODEL;
const DEFAULT_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

interface AnthropicMessagesResponse {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * A small/fast model (Haiku) by default - this is a real-time, per-command fallback call, not
 * a batch job, so latency and per-call cost both matter a lot more than they would for a
 * one-off task. Overridable via the model option for anyone who wants a stronger model anyway.
 */
export function createAnthropicProvider(options: AnthropicProviderOptions): CompletionProvider {
  const model = options.model?.trim() || DEFAULT_MODEL;
  const baseUrl = (options.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");

  return {
    name: "anthropic",
    async complete({ system, user, maxTokens }: CompletionRequest): Promise<CompletionResult> {
      let response: Response;

      try {
        response = await fetch(`${baseUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": options.apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens ?? 512,
            system,
            messages: [{ role: "user", content: user }],
          }),
        });
      } catch (error) {
        throw new CompletionProviderError("Anthropic request failed to send.", "anthropic", error);
      }

      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        throw new CompletionProviderError(
          `Anthropic API returned ${response.status}: ${bodyText.slice(0, 300)}`,
          "anthropic",
        );
      }

      const payload = (await response.json()) as AnthropicMessagesResponse;
      const text = payload.content
        ?.filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("\n");

      if (!text) {
        throw new CompletionProviderError("Anthropic response had no text content.", "anthropic");
      }

      const inputTokens = payload.usage?.input_tokens;
      const outputTokens = payload.usage?.output_tokens;

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
