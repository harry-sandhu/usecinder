// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import type {
  CinderSpeechError,
  CinderSpeechErrorHandler,
  CinderSpeechListenOptions,
  CinderSpeechListenResult,
  CinderSpeechStatus,
  CinderSpeechTranscriptEvent,
  CinderSpeechTranscriptHandler,
} from "../../types.js";
import { getDefaultView } from "../dom/realm.js";
import {
  isCloudFallbackSupported,
  startCloudFallbackRecording,
  type CinderSpeechCloudFallbackOptions,
  type CloudFallbackSession,
} from "./speechCloudFallback.js";

export type { CinderSpeechCloudFallbackOptions } from "./speechCloudFallback.js";

interface BrowserSpeechRecognitionAlternative {
  transcript: string;
}

interface BrowserSpeechRecognitionResultLike {
  isFinal: boolean;
  0: BrowserSpeechRecognitionAlternative;
}

interface BrowserSpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<BrowserSpeechRecognitionResultLike>;
}

interface BrowserSpeechRecognitionErrorEventLike {
  error: string;
}

interface BrowserSpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEventLike) => void) | null;
  start(): void;
  stop(): void;
}

interface BrowserSpeechRecognitionConstructorLike {
  new (): BrowserSpeechRecognitionLike;
}

function getSpeechRecognitionConstructor(
  root?: ParentNode | Document,
): BrowserSpeechRecognitionConstructorLike | undefined {
  const candidateWindows = [
    getDefaultView(root),
    typeof window !== "undefined" ? window : undefined,
    typeof globalThis !== "undefined" && "window" in globalThis
      ? (globalThis.window as Window | undefined)
      : undefined,
  ].filter((candidate): candidate is Window => Boolean(candidate));

  for (const candidateWindow of candidateWindows) {
    const speechWindow = candidateWindow as Window & {
      SpeechRecognition?: BrowserSpeechRecognitionConstructorLike;
      webkitSpeechRecognition?: BrowserSpeechRecognitionConstructorLike;
    };

    const Ctor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (Ctor) {
      return Ctor;
    }
  }

  return undefined;
}

function getSpeechErrorMessage(code: string): string {
  switch (code) {
    case "network":
      return "Browser speech recognition reported a network error. The browser found a speech-recognition engine, but its speech service could not complete the request. Try Chrome or Edge, confirm microphone permission, reload the page, and check whether browser/OS network policy is blocking the speech backend.";
    case "not-allowed":
    case "service-not-allowed":
      return "Browser speech recognition was not allowed. Check microphone permission for this site and confirm the browser allows speech input in this context.";
    case "audio-capture":
      return "Browser speech recognition could not access microphone audio. Check that a microphone is available and that the browser has permission to use it.";
    case "no-speech":
      return "Browser speech recognition started, but no speech was detected. Try speaking more clearly and closer to the microphone.";
    case "aborted":
      return "Browser speech recognition was aborted before a final transcript was produced.";
    default:
      return `Browser speech recognition failed with error: ${code || "unknown"}.`;
  }
}

function createSpeechError(code: string, message: string): CinderSpeechError {
  return { code, message };
}

export interface CinderSpeechEngine {
  kind: "speech";
  /** Browser-native support only - whether a START call would also succeed depends on
   * whether cloudFallback is given (see start()'s own options), which this can't know in
   * advance since that's caller configuration, not an environment capability. */
  isSupported(): boolean;
  getStatus(): CinderSpeechStatus;
  start(options?: CinderSpeechListenOptions): Promise<CinderSpeechListenResult>;
  stop(): void;
  onTranscript(handler: CinderSpeechTranscriptHandler): void;
  offTranscript(handler: CinderSpeechTranscriptHandler): void;
  onError(handler: CinderSpeechErrorHandler): void;
  offError(handler: CinderSpeechErrorHandler): void;
}

export function createSpeechEngine(defaultLang = "en-US"): CinderSpeechEngine {
  let recognition: BrowserSpeechRecognitionLike | undefined;
  let cloudSession: CloudFallbackSession | undefined;
  let activeRoot: ParentNode | Document | undefined;
  let status: CinderSpeechStatus = "idle";
  const transcriptHandlers = new Set<CinderSpeechTranscriptHandler>();
  const errorHandlers = new Set<CinderSpeechErrorHandler>();

  const emitTranscript = async (event: CinderSpeechTranscriptEvent): Promise<void> => {
    for (const handler of transcriptHandlers) {
      try {
        await handler(event);
      } catch {
        continue;
      }
    }
  };

  const emitError = async (error: CinderSpeechError): Promise<void> => {
    for (const handler of errorHandlers) {
      try {
        await handler(error);
      } catch {
        continue;
      }
    }
  };

  const ensureRecognition = (
    root?: ParentNode | Document,
  ): BrowserSpeechRecognitionLike | undefined => {
    if (recognition) {
      return recognition;
    }

    activeRoot = root ?? activeRoot;
    const Ctor = getSpeechRecognitionConstructor(activeRoot);

    if (!Ctor) {
      status = "unsupported";
      return undefined;
    }

    recognition = new Ctor();

    recognition.onstart = () => {
      status = "listening";
    };

    recognition.onend = () => {
      if (status !== "error") {
        status = "stopped";
      }
    };

    recognition.onerror = (event) => {
      status = "error";
      const code = event.error || "speech-error";
      void emitError(createSpeechError(code, getSpeechErrorMessage(code)));
    };

    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];

        if (!result?.[0]?.transcript) {
          continue;
        }

        void emitTranscript({
          transcript: result[0].transcript.trim(),
          isFinal: result.isFinal,
          timestamp: new Date().toISOString(),
        });
      }
    };

    return recognition;
  };

  return {
    kind: "speech",

    isSupported() {
      return Boolean(getSpeechRecognitionConstructor(activeRoot));
    },

    getStatus() {
      return status;
    },

    async start(options) {
      activeRoot = options?.root ?? activeRoot;
      const instance = ensureRecognition(activeRoot);

      if (instance) {
        instance.continuous = options?.continuous ?? false;
        instance.interimResults = options?.interimResults ?? false;
        instance.lang = options?.lang ?? defaultLang;

        try {
          instance.start();
          status = "listening";
          return {
            ok: true,
            status,
          };
        } catch (error) {
          status = "error";
          const message =
            error instanceof Error
              ? error.message
              : "Speech recognition could not be started.";
          await emitError(createSpeechError("start-failed", message));
          return {
            ok: false,
            status,
            message,
          };
        }
      }

      // No native browser recognition - try the server-side fallback, but ONLY if the caller
      // actually configured one. A browser lacking SpeechRecognition but also lacking
      // MediaRecorder/getUserMedia support, or no cloudFallback given at all, falls through
      // to the same honest "unsupported" below - this never silently does nothing.
      if (options?.cloudFallback && isCloudFallbackSupported(activeRoot)) {
        try {
          cloudSession = await startCloudFallbackRecording(
            activeRoot,
            options.cloudFallback,
            options?.lang ?? defaultLang,
            {
              onStart: () => {
                status = "listening";
              },
              onResult: (transcript) => {
                void emitTranscript({
                  transcript,
                  isFinal: true,
                  timestamp: new Date().toISOString(),
                });
              },
              onError: (code, message) => {
                status = "error";
                void emitError(createSpeechError(code, message));
              },
              onEnd: () => {
                cloudSession = undefined;
                if (status !== "error") {
                  status = "stopped";
                }
              },
            },
          );

          return {
            ok: true,
            status: "listening",
          };
        } catch (error) {
          status = "error";
          const message =
            error instanceof Error
              ? error.message
              : "Cloud speech fallback could not be started.";
          await emitError(createSpeechError("start-failed", message));
          return {
            ok: false,
            status,
            message,
          };
        }
      }

      const message =
        "Speech recognition is not supported in this environment. Check whether SpeechRecognition/webkitSpeechRecognition exists on the page window, or configure speech.engine \"auto\" with a self-hosted fallback server endpoint for the cloud fallback (MediaRecorder/getUserMedia are also required for that path).";
      status = "unsupported";
      await emitError(createSpeechError("unsupported", message));
      return {
        ok: false,
        status: "unsupported",
        message,
      };
    },

    stop() {
      if (cloudSession) {
        cloudSession.stop();
        return;
      }

      const instance = ensureRecognition(activeRoot);

      if (!instance) {
        status = "unsupported";
        return;
      }

      instance.stop();
      status = "stopped";
    },

    onTranscript(handler) {
      transcriptHandlers.add(handler);
    },

    offTranscript(handler) {
      transcriptHandlers.delete(handler);
    },

    onError(handler) {
      errorHandlers.add(handler);
    },

    offError(handler) {
      errorHandlers.delete(handler);
    },
  };
}
