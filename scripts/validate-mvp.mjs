// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { JSDOM } from 'jsdom';
import {
  CinderSemanticRuntime,
  createAgriculturePriceFlowIntentMatcher,
} from '../packages/cinder/dist/index.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function installDomGlobals(dom) {
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLInputElement = dom.window.HTMLInputElement;
  globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
  globalThis.Event = dom.window.Event;
  globalThis.SpeechSynthesisUtterance = dom.window.SpeechSynthesisUtterance ?? class {
    constructor(text) {
      this.text = text;
    }
  };
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
      <section id="reports-page" cinder-route="reports">
        <div id="crop-prices" cinder-context="crop-prices">
          <label for="crop-filter">Crop</label>
          <select id="crop-filter" cinder-filter="crop">
            <option value="">Select crop</option>
            <option value="soybean">Soybean</option>
            <option value="paddy">Paddy</option>
          </select>

          <label for="state-filter">State</label>
          <select id="state-filter" cinder-filter="state">
            <option value="">Select state</option>
            <option value="punjab">Punjab</option>
            <option value="gwalior">Gwalior</option>
          </select>

          <button id="search-btn" cinder-action="search">Search</button>
          <div id="price-output" tabindex="0" cinder-output="price">Price</div>
          <div id="weather-output" tabindex="0" cinder-output="weather">Weather</div>
        </div>
      </section>

      <section id="farmers-page" cinder-route="farmers">
        <form id="farmer-registration" cinder-context="farmer-registration">
          <label for="mobile-field">Mobile</label>
          <input id="mobile-field" cinder-field="mobile" />

          <label for="crop-field">Crop</label>
          <select id="crop-field" cinder-field="crop">
            <option value="">Select crop</option>
            <option value="soybean">Soybean</option>
            <option value="paddy">Paddy</option>
          </select>

          <button id="save-btn" cinder-action="save">Save Changes</button>
        </form>
      </section>
    </main>
  `;
}

function createDom() {
  const dom = new JSDOM(createMarkup(), {
    url: 'http://localhost/',
  });
  installDomGlobals(dom);
  return dom;
}

async function validateLocalRuntime() {
  const dom = createDom();
  const runtime = new CinderSemanticRuntime();
  const reflexEvents = [];
  const execution = {
    openedReports: 0,
    searchTriggered: 0,
    saveTriggered: 0,
  };

  runtime.onReflex((result) => {
    reflexEvents.push(result);
  });

  runtime.bind('route', 'reports', () => {
    execution.openedReports += 1;
  });

  runtime.bind('action', 'search', () => {
    execution.searchTriggered += 1;
  });

  runtime.bind('action', 'save', () => {
    execution.saveTriggered += 1;
  });

  runtime.registerIntent(createAgriculturePriceFlowIntentMatcher());

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

  const scanResult = await runtime.scan(dom.window.document);
  const graph = runtime.graph();

  assert(scanResult.entries.length >= 10, 'Expected semantic scan entries for the tagged application.');
  assert(graph.nodes.length >= 11, 'Expected CAG to include app root plus semantic nodes.');
  assert(graph.indexes.byType.route.length >= 2, 'Expected route nodes in the graph.');
  assert(graph.indexes.byType.context.length >= 2, 'Expected context nodes in the graph.');

  const navIntent = runtime.resolve('open reports');
  assert(navIntent.intent === 'navigate', 'Expected local navigation intent for "open reports".');
  const navDispatch = await runtime.dispatch(navIntent, dom.window.document);
  assert(navDispatch.handled, 'Expected navigation dispatch to be handled.');
  assert(execution.openedReports === 1, 'Expected bound route handler to run for reports.');

  const setFieldResult = await runtime.run('set mobile to 12345', dom.window.document);
  assert(setFieldResult.intent.intent === 'set_field', 'Expected field-setting intent for mobile.');
  assert(dom.window.document.getElementById('mobile-field').value === '12345', 'Expected mobile field value to be updated.');
  assert(setFieldResult.reflex.kind === 'success', 'Expected success reflex for field setting.');

  const outputResult = await runtime.run('show weather', dom.window.document);
  assert(outputResult.intent.intent === 'show_output', 'Expected show_output intent for weather.');
  assert(outputResult.reflex.kind === 'success', 'Expected success reflex for weather output.');

  const flowResult = await runtime.run('show soybean prices in punjab', dom.window.document);
  assert(flowResult.intent.intent === 'composite_flow', 'Expected composite flow for local price query.');
  assert(dom.window.document.getElementById('crop-filter').value === 'soybean', 'Expected crop filter to be set by local flow.');
  assert(dom.window.document.getElementById('state-filter').value === 'punjab', 'Expected state filter to be set by local flow.');
  assert(execution.searchTriggered >= 1, 'Expected search action to be triggered by local flow.');

  const unknownResult = await runtime.run('tell me a joke', dom.window.document);
  assert(unknownResult.intent.intent === 'unknown', 'Expected unknown local intent for unsupported request.');
  assert(unknownResult.reflex.kind === 'clarification', 'Expected clarification reflex for unsupported local request.');

  let speechErrors = 0;
  runtime.onSpeechError(() => {
    speechErrors += 1;
  });
  const listenResult = await runtime.listen({ root: dom.window.document, autoRun: false });
  assert(listenResult.ok === false, 'Expected speech listen to fail in unsupported validation environment.');
  assert(listenResult.status === 'unsupported', 'Expected unsupported speech status in validation environment.');
  assert(speechErrors >= 1, 'Expected speech error callback when browser speech is unavailable.');

  runtime.destroy();

  return {
    scanEntries: scanResult.entries.length,
    graphNodes: graph.nodes.length,
    graphEdges: graph.edges.length,
    reflexEvents: reflexEvents.length,
    execution,
    speechStatus: listenResult.status,
  };
}

// This public repo ships the tier 1/tier 2 browser SDK only - tier-3 AI fallback (a real
// server to normalize cloud results against the graph) is Cinder Relay's job, not something
// this repo self-hosts a reference implementation of. See the Relay docs for that path.
async function main() {
  const local = await validateLocalRuntime();

  console.log(JSON.stringify({
    ok: true,
    phase: 11,
    summary: {
      local,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate:mvp] failed:', error);
  process.exitCode = 1;
});
