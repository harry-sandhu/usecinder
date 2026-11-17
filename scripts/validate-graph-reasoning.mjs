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
  globalThis.HTMLAnchorElement = dom.window.HTMLAnchorElement;
  globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
  globalThis.HTMLFormElement = dom.window.HTMLFormElement;
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
      <section id="reports-page" cinder-route="reports" data-cinder-path="/reports">
        <div id="weather-prices" cinder-context="weather-prices">
          <label for="district-filter">District</label>
          <select id="district-filter" cinder-filter="district">
            <option value="">Select district</option>
            <option value="ludhiana">Ludhiana</option>
          </select>

          <button id="weather-search" cinder-action="search">Search</button>
          <div id="weather-price-output" tabindex="0" cinder-output="price">Weather Price</div>
        </div>

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

          <button id="crop-search" cinder-action="search">Search</button>
          <div id="crop-price-output" tabindex="0" cinder-output="price">Crop Price</div>
        </div>
      </section>

      <section id="farmers-page" cinder-route="farmers" data-cinder-path="/farmers">
        <form id="farmer-registration" cinder-context="farmer-registration">
          <label for="farmer-crop-field">Crop</label>
          <select id="farmer-crop-field" cinder-field="crop">
            <option value="">Select crop</option>
            <option value="soybean">Soybean</option>
            <option value="paddy">Paddy</option>
          </select>
        </form>
      </section>
    </main>
  `;
}

function wireNativeBehavior(dom) {
  const execution = {
    cropSearchTriggered: 0,
    weatherSearchTriggered: 0,
  };

  const cropSearchButton = dom.window.document.getElementById('crop-search');
  const weatherSearchButton = dom.window.document.getElementById('weather-search');
  const cropOutput = dom.window.document.getElementById('crop-price-output');
  const weatherOutput = dom.window.document.getElementById('weather-price-output');

  cropSearchButton?.addEventListener('click', () => {
    execution.cropSearchTriggered += 1;
    cropOutput?.setAttribute('data-search-ran', 'true');
  });

  weatherSearchButton?.addEventListener('click', () => {
    execution.weatherSearchTriggered += 1;
    weatherOutput?.setAttribute('data-search-ran', 'true');
  });

  cropOutput?.addEventListener('focus', () => {
    cropOutput.setAttribute('data-focused', 'true');
  });

  weatherOutput?.addEventListener('focus', () => {
    weatherOutput.setAttribute('data-focused', 'true');
  });

  return execution;
}

async function main() {
  const dom = new JSDOM(createMarkup(), {
    url: 'http://localhost/reports',
  });
  installDomGlobals(dom);
  const execution = wireNativeBehavior(dom);

  const cropFilter = dom.window.document.getElementById('crop-filter');
  cropFilter?.focus();

  const runtime = new CinderSemanticRuntime();
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

  await runtime.scan(dom.window.document);
  const graph = runtime.graph();
  const cropPricesContext = graph.nodes.find((node) => node.type === 'context' && node.key === 'crop-prices');
  assert(graph.runtime.activeContextId === cropPricesContext?.id, 'Expected focused crop filter to make crop-prices the active context.');

  const setCropResult = await runtime.run('set crop to soybean', dom.window.document);
  assert(setCropResult.intent.intent === 'set_filter', 'Expected set crop to resolve to the in-context filter, not an unrelated field.');
  assert(dom.window.document.getElementById('crop-filter').value === 'soybean', 'Expected crop filter to update from graph-aware local resolution.');
  assert(dom.window.document.getElementById('farmer-crop-field').value === '', 'Expected unrelated farmer crop field to remain unchanged.');

  const showPriceResult = await runtime.run('show price', dom.window.document);
  assert(showPriceResult.intent.intent === 'show_output', 'Expected show price to resolve to an output.');
  assert(dom.window.document.getElementById('crop-price-output').getAttribute('data-focused') === 'true', 'Expected graph-neighborhood scoring to focus the crop price output, not the earlier weather output.');
  assert(dom.window.document.getElementById('weather-price-output').getAttribute('data-focused') !== 'true', 'Expected weather price output to stay unfocused.');

  const flowResult = await runtime.run('show soybean prices in punjab', dom.window.document);
  assert(flowResult.intent.intent === 'composite_flow', 'Expected composite flow for local graph reasoning validation.');
  assert(execution.cropSearchTriggered >= 1, 'Expected coherent composite flow to trigger crop search in the matching context.');
  assert(execution.weatherSearchTriggered === 0, 'Expected graph reasoning to avoid the earlier weather search action.');
  assert(dom.window.document.getElementById('state-filter').value === 'punjab', 'Expected crop-prices state filter to be selected.');
  assert(dom.window.document.getElementById('district-filter').value === '', 'Expected unrelated weather district filter to remain unchanged.');

  const matchedNodes = (flowResult.intent.matchedNodeIds ?? [])
    .map((id) => graph.nodes.find((node) => node.id === id))
    .filter(Boolean);
  assert(matchedNodes.every((node) => node.routeId === graph.runtime.activeRouteId), 'Expected composite flow matched nodes to stay within the active route subgraph.');
  assert(matchedNodes.some((node) => node.contextId === cropPricesContext?.id), 'Expected composite flow to anchor in the crop-prices context.');
  assert(!matchedNodes.some((node) => node.contextId && node.contextId !== cropPricesContext?.id && node.key !== 'price' && node.key !== 'search'), 'Expected composite flow not to mix unrelated context nodes.');

  runtime.destroy();

  console.log(JSON.stringify({
    ok: true,
    summary: {
      activeContextId: graph.runtime.activeContextId,
      cropSearchTriggered: execution.cropSearchTriggered,
      weatherSearchTriggered: execution.weatherSearchTriggered,
      setCropIntent: setCropResult.intent.intent,
      showPriceIntent: showPriceResult.intent.intent,
      compositeIntent: flowResult.intent.intent,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-graph-reasoning] failed:', error);
  process.exitCode = 1;
});
