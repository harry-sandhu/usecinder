// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
// Coverage for the client-side half of the speech-to-text fallback (docs/known-limitations.md
// #3): createSpeechEngine's new branch in core/input/speechEngine.ts + the recording/upload
// logic in core/input/speechCloudFallback.ts. No real browser, no real microphone, no real
// network call - a fake MediaRecorder/getUserMedia stand in for the browser APIs (same
// approach validate-mvp.mjs uses JSDOM for DOM), and a fake global fetch stands in for the
// network, capturing exactly what was sent so the request shape itself is verified, not just
// the end result.
import { createSpeechEngine } from '../packages/cinder/dist/index.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

class FakeMediaRecorder {
  constructor(stream, options) {
    this.stream = stream;
    this.mimeType = options?.mimeType;
    this.state = 'inactive';
    this.ondataavailable = null;
    this.onstop = null;
    this.onerror = null;
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['fake-audio-bytes'], { type: this.mimeType }) });
    this.onstop?.();
  }
}
FakeMediaRecorder.isTypeSupported = (type) => type === 'audio/webm';

function fakeStream() {
  let stopped = false;
  return {
    getTracks() {
      return [{ stop: () => { stopped = true; } }];
    },
    get stopped() {
      return stopped;
    },
  };
}

function installFakeBrowserGlobals({ withMediaRecorder = true } = {}) {
  const stream = fakeStream();
  globalThis.window = {
    ...(withMediaRecorder ? { MediaRecorder: FakeMediaRecorder } : {}),
    navigator: {
      mediaDevices: {
        async getUserMedia() {
          return stream;
        },
      },
    },
  };
  return stream;
}

function clearFakeBrowserGlobals() {
  delete globalThis.window;
}

function waitFor(predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('Timed out waiting for condition.'));
        return;
      }
      setTimeout(tick, 5);
    };
    tick();
  });
}

async function main() {
  const endpoint = 'http://localhost:9999/v1/llm/infer';

  // 1. No browser SpeechRecognition (never installed in this Node script) and no cloudFallback
  // option at all - must honestly decline, not silently do nothing.
  clearFakeBrowserGlobals();
  const noFallbackEngine = createSpeechEngine();
  const noFallbackResult = await noFallbackEngine.start();
  assert(noFallbackResult.ok === false && noFallbackResult.status === 'unsupported', 'Expected an honest "unsupported" with no cloudFallback configured.');

  // 2. cloudFallback IS configured, but the environment has no MediaRecorder - still an
  // honest decline, never a crash.
  installFakeBrowserGlobals({ withMediaRecorder: false });
  const noRecorderEngine = createSpeechEngine();
  const noRecorderResult = await noRecorderEngine.start({ cloudFallback: { endpoint } });
  assert(noRecorderResult.ok === false && noRecorderResult.status === 'unsupported', 'Expected "unsupported" when MediaRecorder is missing even with cloudFallback configured.');
  clearFakeBrowserGlobals();

  // 3. The real success path: start() resolves immediately once recording begins, stop()
  // triggers the upload, and the transcript arrives via the normal onTranscript handler.
  installFakeBrowserGlobals();
  let capturedRequest;
  globalThis.fetch = async (url, init) => {
    capturedRequest = { url, init };
    return {
      ok: true,
      async json() {
        return { transcript: 'open the overdue loans page' };
      },
    };
  };

  const engine = createSpeechEngine();
  let receivedTranscript;
  engine.onTranscript((event) => {
    receivedTranscript = event;
  });

  const startResult = await engine.start({ cloudFallback: { endpoint, apiKey: 'secret-token' }, lang: 'en-US' });
  assert(startResult.ok === true && startResult.status === 'listening', 'Expected the cloud fallback to report "listening" once recording starts.');

  engine.stop();
  await waitFor(() => receivedTranscript !== undefined);

  assert(receivedTranscript.transcript === 'open the overdue loans page', 'Expected the uploaded transcript to reach the transcript handler.');
  assert(receivedTranscript.isFinal === true, 'Expected the cloud-fallback transcript to be reported as final (no interim results are possible for this path).');
  assert(engine.getStatus() === 'stopped', 'Expected status "stopped" after a successful cloud-fallback transcription.');

  const requestUrl = new URL(capturedRequest.url);
  assert(requestUrl.pathname === '/v1/speech/transcribe', 'Expected the transcribe URL to be derived from the configured endpoint.');
  assert(requestUrl.searchParams.get('lang') === 'en-US', 'Expected the lang to be forwarded as a query param.');
  assert(capturedRequest.init.headers['content-type'] === 'audio/webm', 'Expected the recorded mime type to be sent as the content-type.');
  assert(capturedRequest.init.headers.authorization === 'Bearer secret-token', 'Expected the configured apiKey to be sent as a bearer token.');

  // 4. A provider/network failure must surface through onError, with status "error" - never
  // silently swallowed.
  let receivedError;
  const errorEngine = createSpeechEngine();
  errorEngine.onError((error) => {
    receivedError = error;
  });
  globalThis.fetch = async () => ({
    ok: false,
    status: 502,
    async text() {
      return 'upstream provider failed';
    },
  });

  await errorEngine.start({ cloudFallback: { endpoint } });
  errorEngine.stop();
  await waitFor(() => receivedError !== undefined);
  assert(receivedError.code === 'network', 'Expected a provider failure to surface as a "network" speech error.');
  assert(errorEngine.getStatus() === 'error', 'Expected status "error" after a failed cloud-fallback transcription.');

  clearFakeBrowserGlobals();
  delete globalThis.fetch;

  console.log('All speech cloud-fallback validations passed.');
}

main();
