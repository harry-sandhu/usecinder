// Coverage for the server-side speech-to-text fallback (docs/known-limitations.md #3):
// adapters/speech/* (the TranscriptionProvider contract + the OpenAI Whisper implementation)
// and api/speech/transcribe.ts (the route itself: auth, the raw-audio content-type parser,
// the 501 "not configured" honest decline, and error passthrough). Uses a test-double
// TranscriptionProvider throughout, registered directly against a bare Fastify instance via
// app.inject() - no real network call, no OpenAI key needed, same philosophy as
// validate-cloud-adapter.mjs for the text side.
import Fastify from 'fastify';
import { registerSpeechTranscribeRoutes } from '../packages/server/dist/api/speech/transcribe.js';
import { TranscriptionProviderError } from '../packages/server/dist/adapters/speech/transcriptionProvider.js';
import { resolveServerConfig } from '../packages/server/dist/core/config.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function fakeAdapter(transcribeFn) {
  return { name: 'fake', transcribe: transcribeFn };
}

async function buildApp(options) {
  const app = Fastify();
  await registerSpeechTranscribeRoutes(app, options);
  await app.ready();
  return app;
}

async function main() {
  const sampleAudio = Buffer.from('fake-webm-bytes');

  // 1. No adapter configured (no speechApiKey/CINDER_SPEECH_API_KEY) - an honest 501, not a
  // crash and not a silent empty transcript.
  const unconfiguredApp = await buildApp({ adapter: undefined });
  const unconfiguredResponse = await unconfiguredApp.inject({
    method: 'POST',
    url: '/v1/speech/transcribe',
    headers: { 'content-type': 'audio/webm' },
    payload: sampleAudio,
  });
  assert(unconfiguredResponse.statusCode === 501, 'Expected 501 when no speech provider is configured.');
  await unconfiguredApp.close();

  // 2. A configured adapter with no server apiKey requirement - the normal, successful path.
  let receivedRequest;
  const okAdapter = fakeAdapter(async (request) => {
    receivedRequest = request;
    return 'open the overdue loans page';
  });
  const okApp = await buildApp({ adapter: okAdapter });
  const okResponse = await okApp.inject({
    method: 'POST',
    url: '/v1/speech/transcribe?lang=en-US',
    headers: { 'content-type': 'audio/webm' },
    payload: sampleAudio,
  });
  assert(okResponse.statusCode === 200, 'Expected 200 for a successful transcription.');
  assert(JSON.parse(okResponse.payload).transcript === 'open the overdue loans page', 'Expected the transcript to be returned.');
  assert(receivedRequest.mimeType === 'audio/webm', 'Expected the real content-type to reach the provider.');
  assert(receivedRequest.lang === 'en-US', 'Expected the lang query param to reach the provider.');
  assert(Buffer.compare(receivedRequest.audio, sampleAudio) === 0, 'Expected the raw audio bytes to reach the provider unchanged.');
  await okApp.close();

  // 3. Bearer auth, matching /v1/llm/infer's own behavior exactly - wrong/missing token is
  // rejected before the adapter is ever called.
  const securedApp = await buildApp({ adapter: okAdapter, apiKey: 'secret-token' });
  const noAuthResponse = await securedApp.inject({
    method: 'POST',
    url: '/v1/speech/transcribe',
    headers: { 'content-type': 'audio/webm' },
    payload: sampleAudio,
  });
  assert(noAuthResponse.statusCode === 401, 'Expected 401 with no Authorization header when apiKey is configured.');
  const authedResponse = await securedApp.inject({
    method: 'POST',
    url: '/v1/speech/transcribe',
    headers: { 'content-type': 'audio/webm', authorization: 'Bearer secret-token' },
    payload: sampleAudio,
  });
  assert(authedResponse.statusCode === 200, 'Expected 200 with the correct bearer token.');
  await securedApp.close();

  // 4. A non-audio content-type must be rejected, not silently misinterpreted as audio bytes.
  const wrongTypeApp = await buildApp({ adapter: okAdapter });
  const wrongTypeResponse = await wrongTypeApp.inject({
    method: 'POST',
    url: '/v1/speech/transcribe',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ not: 'audio' }),
  });
  assert(wrongTypeResponse.statusCode === 400, 'Expected 400 for a non-audio content-type.');
  await wrongTypeApp.close();

  // 5. A real provider failure (e.g. OpenAI returning a non-200) must surface as a provider
  // error, not a silent empty/ok response.
  const failingAdapter = fakeAdapter(async () => {
    throw new TranscriptionProviderError('OpenAI transcription API returned 429: rate limited', 'openai');
  });
  const failingApp = await buildApp({ adapter: failingAdapter });
  const failingResponse = await failingApp.inject({
    method: 'POST',
    url: '/v1/speech/transcribe',
    headers: { 'content-type': 'audio/webm' },
    payload: sampleAudio,
  });
  assert(failingResponse.statusCode === 502, 'Expected 502 when the provider itself fails.');
  await failingApp.close();

  // 6. Config resolution: text tier-3 on Anthropic plus a separate OpenAI key for speech must
  // resolve both independently, and speechProvider must default to "openai" automatically
  // once a usable key exists, without needing CINDER_SPEECH_PROVIDER set explicitly.
  const mixedConfig = resolveServerConfig({
    provider: 'anthropic',
    providerApiKey: 'anthropic-key',
    speechApiKey: 'openai-speech-key',
  });
  assert(mixedConfig.provider === 'anthropic' && mixedConfig.providerApiKey === 'anthropic-key', 'Expected the text provider to resolve independently of speech.');
  assert(mixedConfig.speechProvider === 'openai' && mixedConfig.speechApiKey === 'openai-speech-key', 'Expected speechProvider to default to openai once a key is resolvable.');

  // 7. No speech key anywhere - speechProvider must stay "none", never silently fail later.
  const noSpeechConfig = resolveServerConfig({ provider: 'heuristic' });
  assert(noSpeechConfig.speechProvider === 'none' && noSpeechConfig.speechApiKey === '', 'Expected speechProvider to stay "none" with no resolvable key.');

  console.log('All speech-fallback validations passed.');
}

main();
