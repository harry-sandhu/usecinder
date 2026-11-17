import { JSDOM } from 'jsdom';
import { CinderSemanticRuntime } from '../packages/cinder/dist/index.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function installDomGlobals(dom) {
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLAnchorElement = dom.window.HTMLAnchorElement;
  globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
  globalThis.HTMLFormElement = dom.window.HTMLFormElement;
  globalThis.HTMLInputElement = dom.window.HTMLInputElement;
  globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
  globalThis.Event = dom.window.Event;
  globalThis.CSS = dom.window.CSS ?? {
    escape(value) {
      return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    },
  };
}

class FakeSpeechRecognition {
  constructor() {
    this.continuous = false;
    this.interimResults = false;
    this.lang = 'en-US';
    this.onstart = null;
    this.onend = null;
    this.onerror = null;
    this.onresult = null;
  }

  start() {
    this.onstart?.();
    this.onresult?.({
      resultIndex: 0,
      results: [
        {
          isFinal: true,
          0: { transcript: 'open quick start' },
        },
      ],
    });
  }

  stop() {
    this.onend?.();
  }
}

async function main() {
  const hostDom = new JSDOM('<main>host</main>', { url: 'http://localhost/' });
  installDomGlobals(hostDom);

  const appDom = new JSDOM('<main>app</main>', { url: 'http://localhost/' });
  appDom.window.webkitSpeechRecognition = FakeSpeechRecognition;

  const runtime = new CinderSemanticRuntime();
  const transcripts = [];

  runtime.onTranscript((event) => {
    transcripts.push(event.transcript);
  });

  await runtime.init({
    semantic: {
      scanOnInit: false,
      observeMutations: false,
    },
    ai: {
      enabled: false,
      mode: 'local',
      endpoint: '',
      apiKey: '',
    },
  });

  const result = await runtime.listen({
    root: appDom.window.document,
    autoRun: false,
    interimResults: true,
  });

  assert(result.ok, 'Expected speech listen to succeed when webkitSpeechRecognition exists on the root realm window.');
  assert(result.status === 'listening', 'Expected speech status to become listening.');
  assert(transcripts.includes('open quick start'), 'Expected speech transcript to be emitted from the root realm constructor.');

  runtime.stopListening();
  runtime.destroy();

  console.log(JSON.stringify({
    ok: true,
    summary: {
      status: result.status,
      transcriptCount: transcripts.length,
      transcript: transcripts[0],
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-speech-root-realm] failed:', error);
  process.exitCode = 1;
});
