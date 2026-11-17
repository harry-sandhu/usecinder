import { JSDOM } from 'jsdom';
import {
  CinderSemanticRuntime,
  scanSemanticTree,
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

function createCrossRealmMarkup() {
  return `
    <main>
      <section
        id="reports-page"
        cinder-route="reports"
        data-cinder-path="/reports"
        data-cinder-route-selector="#reports-link"
      >
        <a id="reports-link" href="/reports">Reports</a>
      </section>

      <section
        id="farmers-page"
        cinder-route="farmers"
        data-cinder-path="/farmers"
      >
        <form id="registration-form" cinder-context="registration">
          <label for="mobile-field">Mobile</label>
          <input id="mobile-field" cinder-field="mobile" placeholder="Enter mobile" />

          <div id="weather-output" tabindex="0" cinder-output="weather">Weather</div>
        </form>
      </section>
    </main>
  `;
}

async function main() {
  const globalsDom = new JSDOM('<main>global realm</main>', {
    url: 'http://localhost/reports',
  });
  installDomGlobals(globalsDom);

  const targetDom = new JSDOM(createCrossRealmMarkup(), {
    url: 'http://localhost/farmers',
  });

  if (!targetDom.window.HTMLElement.prototype.scrollIntoView) {
    targetDom.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
  }

  if (!targetDom.window.HTMLElement.prototype.focus) {
    targetDom.window.HTMLElement.prototype.focus = function focus() {};
  }

  let reportsClicks = 0;
  let outputFocused = 0;
  let outputScrolled = 0;

  const reportsLink = targetDom.window.document.getElementById('reports-link');
  const weatherOutput = targetDom.window.document.getElementById('weather-output');
  const mobileField = targetDom.window.document.getElementById('mobile-field');

  reportsLink?.addEventListener('click', (event) => {
    reportsClicks += 1;
    event.preventDefault();
  });

  Object.defineProperty(weatherOutput, 'scrollIntoView', {
    configurable: true,
    value: () => {
      outputScrolled += 1;
    },
  });
  Object.defineProperty(weatherOutput, 'focus', {
    configurable: true,
    value: () => {
      outputFocused += 1;
    },
  });

  const directScan = scanSemanticTree(targetDom.window.document);
  const mobileEntry = directScan.entries.find((entry) => entry.record.type === 'field' && entry.record.key === 'mobile');

  assert(directScan.entries.length >= 4, 'Expected cross-realm semantic scan to succeed.');
  assert(mobileEntry?.record.metadata?.placeholder === 'Enter mobile', 'Expected cross-realm scan metadata to preserve placeholder hints.');
  assert(mobileEntry?.record.metadata?.label === 'Mobile', 'Expected cross-realm scan metadata to preserve associated label text.');

  const runtime = new CinderSemanticRuntime();
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

  await runtime.scan(targetDom.window.document);
  const scannedGraph = runtime.graph();
  const farmersRoute = scannedGraph.nodes.find((node) => node.type === 'route' && node.key === 'farmers');

  assert(scannedGraph.runtime.activeRouteId === farmersRoute?.id, 'Expected active route resolution to use the target realm location, not global window state.');

  const setFieldResult = await runtime.run('set mobile to 12345', targetDom.window.document);
  assert(setFieldResult.dispatch.handled, 'Expected cross-realm field dispatch to succeed.');
  assert(mobileField?.value === '12345', 'Expected cross-realm input value update to succeed.');

  const outputResult = await runtime.run('show weather', targetDom.window.document);
  assert(outputResult.dispatch.handled, 'Expected cross-realm output reveal dispatch to succeed.');

  const navigationResult = await runtime.run('open reports', targetDom.window.document);
  assert(navigationResult.dispatch.handled, 'Expected cross-realm route dispatch to succeed.');
  assert(reportsClicks === 1, `Expected cross-realm anchor click to fire exactly once, got ${reportsClicks}.`);

  runtime.destroy();

  console.log(JSON.stringify({
    ok: true,
    summary: {
      scanEntries: directScan.entries.length,
      activeRouteId: scannedGraph.runtime.activeRouteId,
      reportsClicks,
      outputFocused,
      outputScrolled,
      mobileValue: mobileField?.value ?? null,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-cross-realm-dom] failed:', error);
  process.exitCode = 1;
});
