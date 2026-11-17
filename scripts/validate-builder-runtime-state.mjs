import { JSDOM } from 'jsdom';
import {
  buildGraphFromScanResult,
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
  globalThis.HTMLInputElement = dom.window.HTMLInputElement;
  globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
  globalThis.Event = dom.window.Event;
  globalThis.CSS = dom.window.CSS ?? {
    escape(value) {
      return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    },
  };

  if (!dom.window.HTMLElement.prototype.focus) {
    dom.window.HTMLElement.prototype.focus = function focus() {};
  }
}

function createMarkup() {
  return `
    <main>
      <section id="reports-page" cinder-route="reports" data-cinder-path="/reports">
        <div id="reports-context" cinder-context="reports-context">
          <button id="reports-search" cinder-action="search">Search</button>
        </div>
      </section>

      <section id="farmers-page" cinder-route="farmers" data-cinder-path="/farmers">
        <div id="farmers-context" cinder-context="farmers-context">
          <button id="farmers-save" cinder-action="save">Save</button>
        </div>
      </section>
    </main>
  `;
}

async function main() {
  const dom = new JSDOM(createMarkup(), {
    url: 'http://localhost/farmers',
  });
  installDomGlobals(dom);

  const scanResult = scanSemanticTree(dom.window.document);
  const builtSnapshot = buildGraphFromScanResult(scanResult);

  assert(typeof builtSnapshot.runtime.activeRouteId === 'undefined', 'Expected raw graph builder output not to guess an active route.');
  assert(typeof builtSnapshot.runtime.activeContextId === 'undefined', 'Expected raw graph builder output not to guess an active context.');

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

  await runtime.scan(dom.window.document);
  const runtimeSnapshot = runtime.graph();
  const farmersRoute = runtimeSnapshot.nodes.find((node) => node.type === 'route' && node.key === 'farmers');

  assert(runtimeSnapshot.runtime.activeRouteId === farmersRoute?.id, 'Expected runtime scan to apply real active-route resolution from location.');
  assert(typeof runtimeSnapshot.runtime.activeContextId === 'string', 'Expected runtime scan to resolve an active context.');

  runtime.destroy();

  console.log(JSON.stringify({
    ok: true,
    summary: {
      builtActiveRouteId: builtSnapshot.runtime.activeRouteId ?? null,
      builtActiveContextId: builtSnapshot.runtime.activeContextId ?? null,
      runtimeActiveRouteId: runtimeSnapshot.runtime.activeRouteId,
      runtimeActiveContextId: runtimeSnapshot.runtime.activeContextId,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-builder-runtime-state] failed:', error);
  process.exitCode = 1;
});
