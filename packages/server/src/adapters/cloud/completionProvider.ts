/**
 * The one thing every tier-3 cloud provider has to do: take a system prompt and a user
 * message, return the model's raw text reply. Deliberately this narrow - everything
 * provider-specific (auth headers, request/response shape, model naming) lives inside each
 * provider's own file, never leaking into promptBuilder.ts/responseParser.ts/cloudAdapter.ts,
 * so swapping providers (the explicit requirement this was built to satisfy - "any can be
 * swapped in") never touches prompt construction or response handling.
 *
 * No SDK dependency for either provider below: both Anthropic's Messages API and OpenAI's
 * Chat Completions API are plain HTTPS + JSON, callable with the runtime's own `fetch` - one
 * less dependency, and trivially mockable for tests (inject a fake CompletionProvider, no
 * need to mock an SDK's internals).
 */
export interface CompletionRequest {
  system: string;
  user: string;
  maxTokens?: number;
}

export interface CompletionUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompletionResult {
  text: string;
  /** Real token counts from the provider's own response, when it reports them (both
   * Anthropic and OpenAI do). Absent for a provider that doesn't report usage - callers that
   * need to meter cost should treat a missing usage as "fall back to an estimate," never as
   * zero cost. */
  usage?: CompletionUsage;
}

export interface CompletionProvider {
  readonly name: string;
  /**
   * A plain string is still a fully valid return value - this is the original, narrower
   * contract every existing fake/test provider already returns, and it still works unchanged.
   * The richer `CompletionResult` shape is additive: a provider that can report real token
   * usage (for cost metering - see @cinder/relay) returns that instead, nothing else about
   * this interface changes for it.
   */
  complete(request: CompletionRequest): Promise<string | CompletionResult>;
}

/** Unwraps either valid return shape down to just the text - every existing caller
 * (responseParser.ts via cloudAdapter.ts) only ever needed the text anyway. */
export function getCompletionText(result: string | CompletionResult): string {
  return typeof result === "string" ? result : result.text;
}

/** Unwraps either valid return shape down to its usage, if any - undefined for a plain string
 * result or a CompletionResult that didn't include usage. */
export function getCompletionUsage(result: string | CompletionResult): CompletionUsage | undefined {
  return typeof result === "string" ? undefined : result.usage;
}

export class CompletionProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CompletionProviderError";
  }
}
