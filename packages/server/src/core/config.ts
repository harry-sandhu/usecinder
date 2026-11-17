export type CinderServerProvider = "heuristic" | "anthropic" | "openai";

const KNOWN_PROVIDERS: CinderServerProvider[] = ["heuristic", "anthropic", "openai"];

/**
 * Deliberately separate from CinderServerProvider above: a server's TEXT provider (tier 3)
 * and its SPEECH-FALLBACK provider are independent choices - e.g. tier 3 on Anthropic, speech
 * fallback still needs an OpenAI key, since Anthropic has no public speech-to-text endpoint
 * (see adapters/speech/transcriptionProvider.ts's doc comment). "none" is the honest default:
 * speech fallback is optional, unlike text inference.
 */
export type CinderSpeechServerProvider = "none" | "openai";

const KNOWN_SPEECH_PROVIDERS: CinderSpeechServerProvider[] = ["none", "openai"];

export interface CinderServerConfig {
  port?: number;
  host?: string;
  provider?: CinderServerProvider;
  /** The API key THIS server exposes to its own callers (the Bearer token /v1/llm/infer and /v1/speech/transcribe check) - unrelated to either provider's own key below. */
  apiKey?: string;
  /** The real LLM provider's API key - never the same value as `apiKey` above. Read from ANTHROPIC_API_KEY/OPENAI_API_KEY if not given explicitly. */
  providerApiKey?: string;
  /** Overrides the provider's default model (CINDER_ANTHROPIC_MODEL / CINDER_OPENAI_MODEL). */
  providerModel?: string;
  /** Overrides the provider's API base URL (CINDER_ANTHROPIC_BASE_URL / CINDER_OPENAI_BASE_URL) - for proxies or self-hosted gateways. */
  providerBaseUrl?: string;
  /** Which provider (if any) backs /v1/speech/transcribe. Defaults to "openai" if a usable key is resolvable (CINDER_SPEECH_API_KEY or OPENAI_API_KEY), else "none" - never required for the server to start. */
  speechProvider?: CinderSpeechServerProvider;
  /** The speech provider's own API key - independent of providerApiKey (CINDER_SPEECH_API_KEY, falling back to OPENAI_API_KEY so a server already using an OpenAI key for text doesn't need a second one). */
  speechApiKey?: string;
  /** Overrides the speech provider's default model (CINDER_SPEECH_MODEL). */
  speechModel?: string;
  /** Overrides the speech provider's API base URL (CINDER_SPEECH_BASE_URL). */
  speechBaseUrl?: string;
}

export const defaultServerConfig: Required<CinderServerConfig> = {
  port: 8080,
  host: "0.0.0.0",
  provider: "heuristic",
  apiKey: "",
  providerApiKey: "",
  providerModel: "",
  providerBaseUrl: "",
  speechProvider: "none",
  speechApiKey: "",
  speechModel: "",
  speechBaseUrl: "",
};

function resolveProviderApiKeyEnvVar(provider: CinderServerProvider): string {
  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY ?? "";
  if (provider === "openai") return process.env.OPENAI_API_KEY ?? "";
  return "";
}

function resolveProviderModelEnvVar(provider: CinderServerProvider): string {
  if (provider === "anthropic") return process.env.CINDER_ANTHROPIC_MODEL ?? "";
  if (provider === "openai") return process.env.CINDER_OPENAI_MODEL ?? "";
  return "";
}

function resolveProviderBaseUrlEnvVar(provider: CinderServerProvider): string {
  if (provider === "anthropic") return process.env.CINDER_ANTHROPIC_BASE_URL ?? "";
  if (provider === "openai") return process.env.CINDER_OPENAI_BASE_URL ?? "";
  return "";
}

function resolveSpeechApiKeyEnvVar(): string {
  return process.env.CINDER_SPEECH_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
}

export function resolveServerConfig(
  config?: CinderServerConfig,
): Required<CinderServerConfig> {
  const requestedProvider = config?.provider ?? process.env.CINDER_PROVIDER ?? defaultServerConfig.provider;
  const provider = KNOWN_PROVIDERS.includes(requestedProvider as CinderServerProvider)
    ? (requestedProvider as CinderServerProvider)
    : defaultServerConfig.provider;

  const speechApiKey = config?.speechApiKey ?? resolveSpeechApiKeyEnvVar();
  // No CINDER_SPEECH_PROVIDER/explicit speechProvider given, but a usable key IS resolvable
  // (e.g. this server already has OPENAI_API_KEY for text) - default to actually using it
  // rather than silently leaving an optional, genuinely free capability off.
  const requestedSpeechProvider =
    config?.speechProvider ??
    (process.env.CINDER_SPEECH_PROVIDER as CinderSpeechServerProvider | undefined) ??
    (speechApiKey ? "openai" : defaultServerConfig.speechProvider);
  const speechProvider = KNOWN_SPEECH_PROVIDERS.includes(requestedSpeechProvider)
    ? requestedSpeechProvider
    : defaultServerConfig.speechProvider;

  return {
    port: config?.port ?? Number(process.env.PORT || defaultServerConfig.port),
    host: config?.host ?? process.env.HOST ?? defaultServerConfig.host,
    provider,
    apiKey: config?.apiKey ?? process.env.CINDER_API_KEY ?? "",
    providerApiKey: config?.providerApiKey ?? resolveProviderApiKeyEnvVar(provider),
    providerModel: config?.providerModel ?? resolveProviderModelEnvVar(provider),
    speechProvider,
    speechApiKey,
    speechModel: config?.speechModel ?? process.env.CINDER_SPEECH_MODEL ?? "",
    speechBaseUrl: config?.speechBaseUrl ?? process.env.CINDER_SPEECH_BASE_URL ?? "",
    providerBaseUrl: config?.providerBaseUrl ?? resolveProviderBaseUrlEnvVar(provider),
  };
}
