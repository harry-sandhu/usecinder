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
}

function createMarkup() {
  return `
    <main>
      <section id="reports-page" cinder-route="reports" data-cinder-path="/reports">
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

      <section id="farmers-page" cinder-route="farmers" data-cinder-path="/farmers">
        <form id="farmer-registration" cinder-context="farmer-registration">
          <label for="mobile-field">Mobile</label>
          <input id="mobile-field" cinder-field="mobile" />

          <label for="crop-field">Crop</label>
          <select id="crop-field" cinder-field="crop">
            <option value="">Select crop</option>
            <option value="soybean">Soybean</option>
            <option value="paddy">Paddy</option>
          </select>

          <button id="save-btn" type="submit" cinder-action="save" data-cinder-submit="true">Save Changes</button>
        </form>
      </section>
    </main>
  `;
}

function createDom() {
  const dom = new JSDOM(createMarkup(), {
    url: 'http://localhost/farmers',
  });
  installDomGlobals(dom);
  return dom;
}

function wireNativeBehavior(dom) {
  const execution = {
    searchTriggered: 0,
    saveTriggered: 0,
  };

  const searchButton = dom.window.document.getElementById('search-btn');
  const priceOutput = dom.window.document.getElementById('price-output');
  const weatherOutput = dom.window.document.getElementById('weather-output');
  const saveForm = dom.window.document.getElementById('farmer-registration');

  searchButton?.addEventListener('click', () => {
    execution.searchTriggered += 1;
    if (priceOutput) {
      priceOutput.textContent = 'Loaded soybean prices';
      priceOutput.setAttribute('data-search-ran', 'true');
    }
  });

  weatherOutput?.addEventListener('focus', () => {
    weatherOutput.setAttribute('data-focused', 'true');
  });

  saveForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    execution.saveTriggered += 1;
  });

  return execution;
}

async function main() {
  const dom = createDom();
  const runtime = new CinderSemanticRuntime();
  const execution = wireNativeBehavior(dom);

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
  assert(scanResult.entries.length >= 10, 'Expected semantic scan entries for tag-only validation.');

  const initialGraph = runtime.graph();
  assert(initialGraph.runtime.activeRouteId, 'Expected an active route after scan.');

  const navResult = await runtime.run('open reports', dom.window.document);
  assert(navResult.intent.intent === 'navigate', 'Expected navigate intent for open reports.');
  assert(navResult.dispatch.handled, 'Expected tag-only navigation to be handled without bindings.');
  assert(dom.window.location.pathname === '/reports', 'Expected route path navigation to update location pathname.');

  const setFieldResult = await runtime.run('set mobile to 12345', dom.window.document);
  assert(setFieldResult.intent.intent === 'set_field', 'Expected set_field intent for mobile in tag-only validation.');
  assert(dom.window.document.getElementById('mobile-field').value === '12345', 'Expected mobile field to update through DOM execution only.');

  const outputResult = await runtime.run('show weather', dom.window.document);
  assert(outputResult.intent.intent === 'show_output', 'Expected show_output intent for weather in tag-only validation.');
  assert(outputResult.dispatch.handled, 'Expected weather output dispatch to be handled without bindings.');

  const flowResult = await runtime.run('show soybean prices in punjab', dom.window.document);
  assert(flowResult.intent.intent === 'composite_flow', 'Expected composite flow for tag-only local price query.');
  assert(dom.window.document.getElementById('crop-filter').value === 'soybean', 'Expected crop filter to be set by tag-only flow.');
  assert(dom.window.document.getElementById('state-filter').value === 'punjab', 'Expected state filter to be set by tag-only flow.');
  assert(execution.searchTriggered >= 1, 'Expected native search button behavior to run without Cinder bindings.');
  assert(dom.window.document.getElementById('price-output').getAttribute('data-search-ran') === 'true', 'Expected native price output update after search.');

  const saveResult = await runtime.run('save changes', dom.window.document);
  assert(saveResult.intent.intent === 'trigger_action', 'Expected trigger_action intent for save changes.');
  assert(saveResult.dispatch.handled, 'Expected save action dispatch to be handled without bindings.');
  assert(execution.saveTriggered >= 1, 'Expected native form submit behavior to run without Cinder bindings.');

  runtime.destroy();

  console.log(JSON.stringify({
    ok: true,
    summary: {
      scanEntries: scanResult.entries.length,
      locationPathname: dom.window.location.pathname,
      searchTriggered: execution.searchTriggered,
      saveTriggered: execution.saveTriggered,
      finalActiveRouteId: runtime.graph().runtime.activeRouteId,
      finalActiveContextId: runtime.graph().runtime.activeContextId,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-tag-only] failed:', error);
  process.exitCode = 1;
});
