/**
 * Server-side speech-to-text fallback for browsers without Web Speech API support (Firefox,
 * older Safari) - docs/known-limitations.md #3. Deliberately mirrors completionProvider.ts's
 * shape (a narrow provider interface, provider-specific wiring kept out of the route/adapter
 * layer) rather than inventing a different pattern for a second kind of model call.
 *
 * Only one real provider exists below (OpenAI's Whisper endpoint) because, as of this writing,
 * Anthropic's public API has no speech-to-text endpoint - this isn't an oversight to "finish
 * later," it's the real state of the two providers @cinder/server already supports for text.
 * A server can still run tier-3 text inference on Anthropic while using a separate OpenAI key
 * just for this - see core/config.ts's speechProvider/speechApiKey being independent of
 * provider/providerApiKey.
 */
export interface TranscriptionRequest {
  /** The raw recorded audio bytes - whatever MediaRecorder produced client-side. */
  audio: Buffer;
  /** The audio's real MIME type (e.g. "audio/webm", "audio/mp4") - determines the file
   * extension/content-type sent on to the provider, never assumed. */
  mimeType: string;
  /** BCP-47 language tag from the request (e.g. "en-US") - providers that accept a language
   * hint get ISO-639-1 derived from it; this is a hint, not a guarantee of correctness. */
  lang?: string;
}

export interface TranscriptionProvider {
  readonly name: string;
  transcribe(request: TranscriptionRequest): Promise<string>;
}

export class TranscriptionProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TranscriptionProviderError";
  }
}
