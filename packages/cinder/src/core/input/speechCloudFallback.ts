import { getDefaultView } from "../dom/realm.js";

/**
 * Server-side speech-to-text fallback for browsers with no Web Speech API at all (Firefox,
 * older Safari) - docs/known-limitations.md #3. Deliberately reuses the SAME self-hosted
 * @cinder/server an app already points its text tier-3 fallback at (config.ai.endpoint/apiKey)
 * rather than inventing a second config surface - this wires up CinderSpeechConfig.engine's
 * "auto" value, which existed in the type for a while with nothing behind it.
 *
 * Unlike browser SpeechRecognition, this can't stream interim results - it only has a
 * transcript once recording stops and the upload+transcription round-trip finishes. That's a
 * real, honest UX difference for the fallback path, not a bug to chase: there is no server-side
 * equivalent of "partial transcript while still speaking" without a streaming STT API, which
 * is a materially bigger integration than this bounded fallback is trying to be.
 */
export interface CinderSpeechCloudFallbackOptions {
  /** The SAME endpoint already used for text tier-3 fallback (config.ai.endpoint) - the full
   * URL to /v1/llm/infer. The sibling /v1/speech/transcribe route on that same server is
   * derived from it, not configured separately. */
  endpoint: string;
  apiKey?: string;
  timeoutMs?: number;
}

interface MediaRecorderErrorEventLike {
  error?: { name?: string };
}

interface MediaRecorderDataAvailableEventLike {
  data: Blob;
}

interface MediaRecorderLike {
  state: "inactive" | "recording" | "paused";
  ondataavailable: ((event: MediaRecorderDataAvailableEventLike) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: MediaRecorderErrorEventLike) => void) | null;
  start(): void;
  stop(): void;
}

interface MediaRecorderConstructorLike {
  new (stream: MediaStream, options?: { mimeType?: string }): MediaRecorderLike;
  isTypeSupported?(mimeType: string): boolean;
}

type GetUserMediaFn = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

// In rough preference order - MediaRecorder.isTypeSupported picks the first one the real
// browser can actually produce, since support varies (Chrome/Firefox default to webm, Safari
// to mp4) and the server already copes with whichever one of these actually arrives
// (openaiTranscriptionProvider.ts's extensionForMimeType).
const CANDIDATE_MIME_TYPES = ["audio/webm", "audio/mp4", "audio/ogg"];

function getMediaRecorderConstructor(
  root?: ParentNode | Document,
): MediaRecorderConstructorLike | undefined {
  const win = getDefaultView(root) as (Window & { MediaRecorder?: MediaRecorderConstructorLike }) | undefined;
  return win?.MediaRecorder;
}

function getUserMediaFn(root?: ParentNode | Document): GetUserMediaFn | undefined {
  const win = getDefaultView(root);
  const mediaDevices = win?.navigator?.mediaDevices;
  return mediaDevices ? mediaDevices.getUserMedia.bind(mediaDevices) : undefined;
}

export function isCloudFallbackSupported(root?: ParentNode | Document): boolean {
  return Boolean(getMediaRecorderConstructor(root)) && Boolean(getUserMediaFn(root));
}

function pickMimeType(Ctor: MediaRecorderConstructorLike): string {
  if (typeof Ctor.isTypeSupported === "function") {
    for (const candidate of CANDIDATE_MIME_TYPES) {
      if (Ctor.isTypeSupported(candidate)) {
        return candidate;
      }
    }
  }

  return CANDIDATE_MIME_TYPES[0]!;
}

/** The sibling transcription route on the SAME server config.ai.endpoint already points at -
 * never a separately-configured URL, so an app that works for text fallback works for speech
 * fallback with zero extra setup beyond turning speech.engine to "auto". */
function deriveTranscribeUrl(aiEndpoint: string, lang?: string): string | undefined {
  try {
    const url = new URL(aiEndpoint);
    url.pathname = "/v1/speech/transcribe";
    url.search = "";

    if (lang) {
      url.searchParams.set("lang", lang);
    }

    return url.toString();
  } catch {
    return undefined;
  }
}

export interface CloudFallbackCallbacks {
  onStart(): void;
  onResult(transcript: string): void;
  onError(code: string, message: string): void;
  onEnd(): void;
}

export interface CloudFallbackSession {
  stop(): void;
}

/**
 * Starts microphone capture immediately (so start() can resolve right away, matching browser
 * SpeechRecognition's own start() contract) and returns a session whose stop() ends recording
 * and kicks off the upload+transcription in the background - the transcript (or an error)
 * arrives later via the callbacks, same as a real transcript/error event.
 */
export async function startCloudFallbackRecording(
  root: ParentNode | Document | undefined,
  options: CinderSpeechCloudFallbackOptions,
  lang: string | undefined,
  callbacks: CloudFallbackCallbacks,
): Promise<CloudFallbackSession> {
  const getUserMedia = getUserMediaFn(root);
  const RecorderCtor = getMediaRecorderConstructor(root);

  if (!getUserMedia || !RecorderCtor) {
    throw new Error(
      "Cloud speech fallback is not supported in this environment (no MediaRecorder/getUserMedia).",
    );
  }

  const derivedTranscribeUrl = deriveTranscribeUrl(options.endpoint, lang);

  if (!derivedTranscribeUrl) {
    throw new Error(`Could not derive a /v1/speech/transcribe URL from endpoint "${options.endpoint}".`);
  }

  // Narrowed to a plain string, not "string | undefined" - the closures below capture this,
  // and a closure doesn't retain the guard-clause narrowing of the original binding above.
  const transcribeUrl: string = derivedTranscribeUrl;

  const stream = await getUserMedia({ audio: true });
  const mimeType = pickMimeType(RecorderCtor);
  const recorder = new RecorderCtor(stream, { mimeType });
  const chunks: Blob[] = [];
  let ended = false;

  const releaseStream = (): void => {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  };

  const finish = (): void => {
    if (ended) {
      return;
    }

    ended = true;
    callbacks.onEnd();
  };

  async function uploadAndTranscribe(): Promise<void> {
    const blob = new Blob(chunks, { type: mimeType });

    if (blob.size === 0) {
      callbacks.onError("no-speech", "Cloud speech fallback recorded no audio.");
      finish();
      return;
    }

    const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), options.timeoutMs ?? 15000)
      : undefined;

    try {
      const response = await fetch(transcribeUrl, {
        method: "POST",
        headers: {
          "content-type": mimeType,
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: blob,
        signal: controller?.signal,
      });

      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        callbacks.onError(
          "network",
          `Cloud speech fallback request failed (HTTP ${response.status}): ${bodyText.slice(0, 200)}`,
        );
        return;
      }

      const payload = (await response.json()) as { transcript?: unknown };
      const transcript = typeof payload.transcript === "string" ? payload.transcript.trim() : "";

      if (!transcript) {
        callbacks.onError("no-speech", "Cloud speech fallback returned no transcript.");
      } else {
        callbacks.onResult(transcript);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cloud speech fallback request failed.";
      callbacks.onError("network", message);
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }

      finish();
    }
  }

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  recorder.onerror = (event) => {
    releaseStream();
    callbacks.onError(
      "audio-capture",
      `Cloud speech fallback recording failed: ${event.error?.name ?? "unknown error"}.`,
    );
    finish();
  };

  recorder.onstop = () => {
    releaseStream();
    void uploadAndTranscribe();
  };

  try {
    recorder.start();
  } catch (error) {
    releaseStream();
    throw error;
  }

  callbacks.onStart();

  return {
    stop() {
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
    },
  };
}
