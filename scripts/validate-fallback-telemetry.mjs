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

function createMarkup() {
  return `
    <main>
      <section id="reports-page" cinder-route="reports" data-cinder-path="/reports">
        <div id="crop-prices" cinder-context="crop-prices">
          <button id="search-btn" cinder-action="search">Search</button>
          <div id="price-output" tabindex="0" cinder-output="price">Price</div>
        </div>
      </section>
    </main>
  `;
}

async function runScenario(fetchImpl) {
  const dom = new JSDOM(createMarkup(), {
    url: 'http://localhost/reports',
  });
  installDomGlobals(dom);

  const runtime = new CinderSemanticRuntime();
  const events = {
    start: undefined,
    end: undefined,
  };

  runtime.on('fallback:start', (payload) => {
    events.start = payload;
  });

  runtime.on('fallback:end', (payload) => {
    events.end = payload;
  });

  await runtime.init({
    semantic: {
      scanOnInit: false,
      observeMutations: false,
    },
    ai: {
      enabled: true,
      mode: 'hybrid',
      endpoint: 'https://fallback.test/v1/llm/infer',
      apiKey: 'secret-key',
      provider: 'mock-provider',
      timeoutMs: 25,
    },
  });

  await runtime.scan(dom.window.document);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;

  try {
    const startedAt = Date.now();
    const result = await runtime.run('tell me a joke', dom.window.document);
    const elapsedMs = Date.now() - startedAt;

    return {
      result,
      events,
      elapsedMs,
      cleanup: () => {
        globalThis.fetch = originalFetch;
        runtime.destroy();
      },
    };
  } catch (error) {
    globalThis.fetch = originalFetch;
    runtime.destroy();
    throw error;
  }
}

async function main() {
  const httpScenario = await runScenario(async () => ({
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
  }));

  try {
    assert(httpScenario.events.start, 'Expected fallback:start event for HTTP error scenario.');
    assert(httpScenario.events.end, 'Expected fallback:end event for HTTP error scenario.');
    assert(httpScenario.events.start.provider === 'mock-provider', 'Expected fallback:start to include configured provider.');
    assert(httpScenario.events.start.authMode === 'bearer', 'Expected fallback:start to include bearer auth mode.');
    assert(httpScenario.events.start.timeoutMs === 25, 'Expected fallback:start to include configured timeout.');
    assert(httpScenario.events.start.reason === 'unknown_intent', 'Expected fallback:start reason to classify unknown local intent.');
    assert(httpScenario.events.end.errorCode === 'http_error', 'Expected fallback:end to classify HTTP failures.');
    assert(httpScenario.events.end.statusCode === 401, 'Expected fallback:end to include HTTP status code.');
    assert(httpScenario.events.end.used === false, 'Expected HTTP failure not to use fallback intent.');
    assert(httpScenario.result.intent.intent === 'unknown', 'Expected HTTP fallback failure to degrade back to local unknown intent.');
  } finally {
    httpScenario.cleanup();
  }

  const timeoutScenario = await runScenario(async (_url, options) => {
    return await new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => {
        const error = new Error('The operation was aborted.');
        error.name = 'AbortError';
        reject(error);
      });
    });
  });

  try {
    assert(timeoutScenario.events.end, 'Expected fallback:end event for timeout scenario.');
    assert(timeoutScenario.events.end.errorCode === 'timeout', 'Expected timeout scenario to be classified as timeout.');
    assert(timeoutScenario.events.end.used === false, 'Expected timeout not to produce a fallback intent.');
    assert(timeoutScenario.elapsedMs < 1000, 'Expected timeout handling to abort promptly instead of hanging.');
  } finally {
    timeoutScenario.cleanup();
  }

  const normalizationScenario = await runScenario(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    async json() {
      return {
        intent: 'navigate',
        target: 'missing-route',
        source: 'cloud',
      };
    },
  }));

  try {
    assert(normalizationScenario.events.end, 'Expected fallback:end event for normalization scenario.');
    assert(normalizationScenario.events.end.errorCode === 'normalization_failed', 'Expected invalid graph grounding to be classified as normalization_failed.');
    assert(normalizationScenario.events.end.normalized === true, 'Expected provider response schema normalization to succeed before graph grounding failure.');
    assert(normalizationScenario.events.end.used === false, 'Expected normalization failure not to produce a usable fallback intent.');
  } finally {
    normalizationScenario.cleanup();
  }

  console.log(JSON.stringify({
    ok: true,
    summary: {
      httpErrorCode: httpScenario.events.end?.errorCode,
      timeoutErrorCode: timeoutScenario.events.end?.errorCode,
      normalizationErrorCode: normalizationScenario.events.end?.errorCode,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-fallback-telemetry] failed:', error);
  process.exitCode = 1;
});
