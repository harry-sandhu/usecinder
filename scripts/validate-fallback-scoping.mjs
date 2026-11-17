// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { JSDOM } from 'jsdom';
import {
  CinderSemanticRuntime,
  createLlmCore,
  mergeConfig,
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
}

function createMarkup() {
  return `
    <main>
      <section id="reports-page" cinder-route="reports" data-cinder-path="/reports">
        <div id="reports-filters" cinder-context="filters">
          <button id="reports-search" cinder-action="search">Search</button>
          <div id="reports-price" cinder-output="price">Reports Price</div>
        </div>
      </section>

      <section id="farmers-page" cinder-route="farmers" data-cinder-path="/farmers">
        <div id="farmers-filters" cinder-context="filters">
          <button id="farmers-search" cinder-action="search">Search</button>
          <div id="farmers-price" cinder-output="price">Farmers Price</div>
        </div>
      </section>
    </main>
  `;
}

function createDom() {
  const dom = new JSDOM(createMarkup(), {
    url: 'http://localhost/reports',
  });
  installDomGlobals(dom);
  return dom;
}

async function main() {
  const dom = createDom();
  const runtime = new CinderSemanticRuntime();
  const llm = createLlmCore();

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

  const snapshot = runtime.graph();
  const unknownIntent = runtime.resolve('tell me something unsupported');
  const config = mergeConfig({
    ai: {
      enabled: true,
      mode: 'hybrid',
      endpoint: 'https://fallback.test/v1/llm/infer',
      apiKey: '',
    },
  });

  const reportsRoute = snapshot.nodes.find((node) => node.type === 'route' && node.key === 'reports');
  const farmersRoute = snapshot.nodes.find((node) => node.type === 'route' && node.key === 'farmers');
  const reportsSearch = snapshot.nodes.find((node) => node.type === 'action' && node.key === 'search' && node.routeId === reportsRoute?.id);
  const farmersSearch = snapshot.nodes.find((node) => node.type === 'action' && node.key === 'search' && node.routeId === farmersRoute?.id);
  const reportsPrice = snapshot.nodes.find((node) => node.type === 'output' && node.key === 'price' && node.routeId === reportsRoute?.id);

  assert(reportsRoute && farmersRoute && reportsSearch && farmersSearch && reportsPrice, 'Expected duplicated routes/actions/outputs for fallback scoping validation.');

  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);

      if (body.text === 'cloud search active route') {
        return {
          ok: true,
          async json() {
            return {
              intent: 'trigger_action',
              target: 'search',
              source: 'cloud',
            };
          },
        };
      }

      if (body.text === 'cloud search farmers hint') {
        return {
          ok: true,
          async json() {
            return {
              intent: 'trigger_action',
              target: 'search',
              context: {
                route: 'farmers',
              },
              source: 'cloud',
            };
          },
        };
      }

      if (body.text === 'cloud output active route') {
        return {
          ok: true,
          async json() {
            return {
              intent: 'show_output',
              target: 'price',
              source: 'cloud',
            };
          },
        };
      }

      if (body.text === 'cloud search ambiguous') {
        return {
          ok: true,
          async json() {
            return {
              intent: 'trigger_action',
              target: 'search',
              source: 'cloud',
            };
          },
        };
      }

      return {
        ok: false,
        async json() {
          return {};
        },
      };
    };

    const activeRouteSearchResult = await llm.infer(
      'cloud search active route',
      unknownIntent,
      snapshot,
      config,
    );
    assert(activeRouteSearchResult.intent?.intent === 'trigger_action', 'Expected cloud search with active route to normalize into trigger_action.');
    assert(activeRouteSearchResult.intent?.matchedNodeIds?.[0] === reportsSearch.id, 'Expected active route bias to pick the reports search action.');
    assert(activeRouteSearchResult.meta.used === true, 'Expected active route cloud result to remain usable after normalization.');

    const farmersHintResult = await llm.infer(
      'cloud search farmers hint',
      unknownIntent,
      snapshot,
      config,
    );
    assert(farmersHintResult.intent?.matchedNodeIds?.[0] === farmersSearch.id, 'Expected explicit route hint to select the farmers search action.');
    assert(farmersHintResult.meta.used === true, 'Expected explicit route hint result to remain usable after normalization.');

    const outputResult = await llm.infer(
      'cloud output active route',
      unknownIntent,
      snapshot,
      config,
    );
    assert(outputResult.intent?.intent === 'show_output', 'Expected cloud output intent to normalize into show_output.');
    assert(outputResult.intent?.matchedNodeIds?.[0] === reportsPrice.id, 'Expected active route bias to pick the reports price output.');

    snapshot.runtime.activeRouteId = undefined;
    snapshot.runtime.activeContextId = undefined;

    const ambiguousResult = await llm.infer(
      'cloud search ambiguous',
      unknownIntent,
      snapshot,
      config,
    );
    assert(typeof ambiguousResult.intent === 'undefined', 'Expected ambiguous duplicate cloud target to be rejected instead of silently picking first.');
    assert(ambiguousResult.meta.errorCode === 'normalization_failed', 'Expected ambiguous duplicate cloud target to classify as normalization_failed.');
  } finally {
    globalThis.fetch = originalFetch;
    runtime.destroy();
  }

  console.log(JSON.stringify({
    ok: true,
    summary: {
      reportsSearchId: reportsSearch.id,
      farmersSearchId: farmersSearch.id,
      reportsPriceId: reportsPrice.id,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-fallback-scoping] failed:', error);
  process.exitCode = 1;
});
