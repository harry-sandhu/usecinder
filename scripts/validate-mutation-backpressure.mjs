import { JSDOM } from 'jsdom';
import { CinderSemanticRuntime } from '../packages/cinder/dist/index.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function installDomGlobals(dom) {
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLAnchorElement = dom.window.HTMLAnchorElement;
  globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
  globalThis.HTMLInputElement = dom.window.HTMLInputElement;
  globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
  globalThis.Event = dom.window.Event;
  globalThis.CSS = dom.window.CSS ?? {
    escape(value) {
      return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    },
  };

  if (!dom.window.HTMLElement.prototype.scrollIntoView) {
    dom.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
  }

  if (!dom.window.HTMLElement.prototype.focus) {
    dom.window.HTMLElement.prototype.focus = function focus() {};
  }
}

function createMarkup() {
  return `
    <main>
      <section id="reports-page" cinder-route="reports" data-cinder-path="/reports">
        <div id="results-context" cinder-context="results">
          <button id="search-btn" cinder-action="search">Search</button>
          <div id="results-panel" cinder-output="results">Results</div>
        </div>
      </section>
    </main>
  `;
}

async function main() {
  const dom = new JSDOM(createMarkup(), {
    url: 'http://localhost/reports',
  });
  installDomGlobals(dom);

  const runtime = new CinderSemanticRuntime();
  const mutationScanEvents = [];
  const allScanEvents = [];
  const resultsPanel = dom.window.document.getElementById('results-panel');
  const searchButton = dom.window.document.getElementById('search-btn');

  runtime.on('scan:end', (payload) => {
    allScanEvents.push(payload);
    if (payload.reason === 'mutation') {
      mutationScanEvents.push(payload);
    }
  });

  searchButton?.addEventListener('click', () => {
    for (let index = 0; index < 20; index += 1) {
      resultsPanel?.setAttribute('aria-hidden', index % 2 === 0 ? 'false' : 'true');
      const item = dom.window.document.createElement('div');
      item.textContent = `row-${index}`;
      resultsPanel?.appendChild(item);
    }
  });

  await runtime.init({
    semantic: {
      scanOnInit: false,
      observeMutations: true,
    },
    ai: {
      enabled: false,
      mode: 'local',
      endpoint: '',
      apiKey: '',
    },
  });

  await runtime.scan(dom.window.document);

  const dispatchResult = await runtime.run('search', dom.window.document);
  assert(dispatchResult.intent.intent === 'trigger_action', 'Expected search command to resolve locally.');
  assert(dispatchResult.dispatch.handled, 'Expected search command to dispatch successfully.');

  await delay(700);

  for (let index = 0; index < 25; index += 1) {
    resultsPanel?.setAttribute('aria-hidden', index % 2 === 0 ? 'true' : 'false');
  }

  await delay(700);

  assert(mutationScanEvents.length >= 1, 'Expected at least one mutation-driven rescan after DOM churn.');
  assert(mutationScanEvents.length <= 3, `Expected mutation rescans to be coalesced instead of storming, got ${mutationScanEvents.length}.`);
  assert(mutationScanEvents.every((event) => typeof event.durationMs === 'number' && event.durationMs >= 0), 'Expected mutation scan timing to be exposed on scan:end events.');

  const graph = runtime.graph();
  assert(typeof graph.meta.lastScanDurationMs === 'number', 'Expected graph snapshot meta to expose last scan duration.');
  assert(typeof graph.meta.mutationRescanCount === 'number' && graph.meta.mutationRescanCount >= 1, 'Expected graph snapshot meta to track mutation rescan count.');

  runtime.destroy();

  console.log(JSON.stringify({
    ok: true,
    summary: {
      totalScanEvents: allScanEvents.length,
      mutationScanCount: mutationScanEvents.length,
      lastScanDurationMs: graph.meta.lastScanDurationMs,
      mutationRescanCount: graph.meta.mutationRescanCount,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-mutation-backpressure] failed:', error);
  process.exitCode = 1;
});
