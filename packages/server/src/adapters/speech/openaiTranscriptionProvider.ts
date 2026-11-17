import {
  TranscriptionProviderError,
  type TranscriptionProvider,
  type TranscriptionRequest,
} from "./transcriptionProvider.js";

// OpenAI's transcription model lineup changes independently of this codebase - verify/override
// via the model option or CINDER_SPEECH_MODEL before relying on this default in production.
const DEFAULT_MODEL = "whisper-1";
const DEFAULT_BASE_URL = "https://api.openai.com";

export interface OpenAiTranscriptionProviderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

interface OpenAiTranscriptionResponse {
  text?: string;
}

/** Whisper wants a real file extension on the multipart part, not just a content-type header -
 * best-effort mapping from what MediaRecorder actually produced client-side. Falls back to
 * webm (the most common MediaRecorder default) rather than rejecting an unrecognized type -
 * the provider itself will reject genuinely unsupported audio, this is just a filename hint. */
function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();

  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("mp4") || normalized.includes("m4a")) return "mp4";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  return "webm";
}

/** Whisper expects ISO-639-1 ("en"), not a full BCP-47 tag ("en-US") - a wrong/too-specific
 * language hint is silently ignored by the provider, worth getting right rather than passing
 * through verbatim. */
function toIso639_1(lang: string): string {
  return lang.split("-")[0]?.toLowerCase() ?? lang.toLowerCase();
}

export function createOpenAiTranscriptionProvider(
  options: OpenAiTranscriptionProviderOptions,
): TranscriptionProvider {
  const model = options.model?.trim() || DEFAULT_MODEL;
  const baseUrl = (options.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");

  return {
    name: "openai",
    async transcribe({ audio, mimeType, lang }: TranscriptionRequest): Promise<string> {
      const form = new FormData();
      form.append(
        "file",
        // Buffer's underlying ArrayBufferLike can be a SharedArrayBuffer, which BlobPart
        // doesn't accept - a plain Uint8Array view over the same bytes satisfies both.
        new Blob([new Uint8Array(audio)], { type: mimeType }),
        `speech.${extensionForMimeType(mimeType)}`,
      );
      form.append("model", model);

      if (lang) {
        form.append("language", toIso639_1(lang));
      }

      let response: Response;

      try {
        response = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiKey}`,
          },
          body: form,
        });
      } catch (error) {
        throw new TranscriptionProviderError(
          "OpenAI transcription request failed to send.",
          "openai",
          error,
        );
      }

      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        throw new TranscriptionProviderError(
          `OpenAI transcription API returned ${response.status}: ${bodyText.slice(0, 300)}`,
          "openai",
        );
      }

      const payload = (await response.json()) as OpenAiTranscriptionResponse;
      const text = payload.text?.trim();

      if (!text) {
        throw new TranscriptionProviderError("OpenAI transcription response had no text.", "openai");
      }

      return text;
    },
  };
}
