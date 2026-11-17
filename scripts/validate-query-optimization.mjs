import { JSDOM } from 'jsdom';
import {
  CinderSemanticRuntime,
  createGraphQueryEngine,
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

function createMarkup(routeCount = 60) {
  const routes = [];

  for (let index = 1; index <= routeCount; index += 1) {
    const routeKey = `route-${String(index).padStart(2, '0')}`;
    routes.push(`
      <section id="${routeKey}" cinder-route="${routeKey}" data-cinder-path="/${routeKey}">
        <div id="${routeKey}-filters" cinder-context="filters">
          <label for="${routeKey}-field">Mobile ${index}</label>
          <input id="${routeKey}-field" cinder-field="mobile-${routeKey}" />
          <button id="${routeKey}-search" cinder-action="search-${routeKey}">Search ${routeKey}</button>
          <div id="${routeKey}-weather" cinder-output="weather-${routeKey}">Weather ${routeKey}</div>
        </div>

        <div id="${routeKey}-details" cinder-context="details">
          <button id="${routeKey}-save" cinder-action="save-${routeKey}">Save ${routeKey}</button>
          <div id="${routeKey}-price" cinder-output="price-${routeKey}">Price ${routeKey}</div>
        </div>
      </section>
    `);
  }

  return `<main>${routes.join('\n')}</main>`;
}

async function main() {
  const dom = new JSDOM(createMarkup(), {
    url: 'http://localhost/route-28',
  });
  installDomGlobals(dom);

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
  const snapshot = runtime.graph();
  const cge = createGraphQueryEngine();

  const activeRouteNode = snapshot.nodes.find((node) => node.type === 'route' && node.key === 'route-28');
  const activeSearchNode = snapshot.nodes.find(
    (node) => node.type === 'action' && node.key === 'search-route-28',
  );
  const offRouteSearchNode = snapshot.nodes.find(
    (node) => node.type === 'action' && node.key === 'search-route-05',
  );
  const aliasTargetNode = snapshot.nodes.find(
    (node) => node.type === 'output' && node.key === 'weather-route-28',
  );

  assert(snapshot.nodes.length >= 400, 'Expected a larger graph for RT11 validation.');
  assert(snapshot.runtime.activeRouteId === activeRouteNode?.id, 'Expected active route state to resolve for route-28.');
  assert(activeSearchNode, 'Expected active route search node to exist.');
  assert(offRouteSearchNode, 'Expected off-route search node to exist.');
  assert(aliasTargetNode, 'Expected alias target node to exist.');

  aliasTargetNode.aliases = [...(aliasTargetNode.aliases ?? []), 'special-weather-alias'];

  const exactFirst = cge.findCandidates(snapshot, 'special-weather-alias', ['output']);
  const diagnosticsAfterExactFirst = cge.getDiagnostics(snapshot);
  const exactSecond = cge.findCandidates(snapshot, 'special-weather-alias', ['output']);
  const diagnosticsAfterExactSecond = cge.getDiagnostics(snapshot);

  assert(exactFirst[0]?.node.id === aliasTargetNode.id, 'Expected alias exact query to resolve through the normalized alias index.');
  assert(exactSecond[0]?.node.id === aliasTargetNode.id, 'Expected repeated alias exact query to stay stable.');
  assert(diagnosticsAfterExactFirst.snapshotCacheBuilds === 1, `Expected a single snapshot cache build, got ${diagnosticsAfterExactFirst.snapshotCacheBuilds}.`);
  assert(diagnosticsAfterExactSecond.exactCacheHits >= 1, 'Expected repeated exact query to hit the exact-match cache.');
  assert((diagnosticsAfterExactSecond.snapshot?.indexedAliasCount ?? 0) >= 1, 'Expected alias index entries to be built for the snapshot.');

  const activeFirst = cge.findCandidates(snapshot, 'search-route-28-now', ['action']);
  const diagnosticsAfterActive = cge.getDiagnostics(snapshot);

  assert(activeFirst[0]?.node.id === activeSearchNode.id, 'Expected active-subgraph query to prefer the active route action candidate.');
  assert(diagnosticsAfterActive.lastQuery?.mode === 'active', `Expected active-subgraph narrowing mode, got ${diagnosticsAfterActive.lastQuery?.mode}.`);
  assert(
    (diagnosticsAfterActive.lastQuery?.candidatePoolSize ?? 0) < (diagnosticsAfterActive.lastQuery?.totalTypeNodeCount ?? 0),
    'Expected active-subgraph candidate pool to be narrower than the total type node count.',
  );

  const globalFirst = cge.findCandidates(snapshot, 'search-route-05-now', ['action']);
  const diagnosticsAfterGlobalFirst = cge.getDiagnostics(snapshot);
  const globalSecond = cge.findCandidates(snapshot, 'search-route-05-now', ['action']);
  const diagnosticsAfterGlobalSecond = cge.getDiagnostics(snapshot);

  assert(globalFirst[0]?.node.id === offRouteSearchNode.id, 'Expected global fuzzy query to find the off-route candidate when active narrowing misses.');
  assert(globalSecond[0]?.node.id === offRouteSearchNode.id, 'Expected repeated global fuzzy query to stay stable.');
  assert(diagnosticsAfterGlobalFirst.lastQuery?.mode === 'global', `Expected global fallback mode, got ${diagnosticsAfterGlobalFirst.lastQuery?.mode}.`);
  assert(diagnosticsAfterGlobalFirst.globalFuzzyScans >= 1, 'Expected at least one global fuzzy scan for off-route lookup.');
  assert(diagnosticsAfterGlobalSecond.globalFuzzyCacheHits >= 1, 'Expected repeated global fuzzy query to hit the cached candidate map.');

  runtime.destroy();

  console.log(JSON.stringify({
    ok: true,
    summary: {
      nodeCount: snapshot.nodes.length,
      activeRouteId: snapshot.runtime.activeRouteId,
      exactCacheHits: diagnosticsAfterExactSecond.exactCacheHits,
      globalFuzzyScans: diagnosticsAfterGlobalSecond.globalFuzzyScans,
      globalFuzzyCacheHits: diagnosticsAfterGlobalSecond.globalFuzzyCacheHits,
      activeCandidatePoolSize: diagnosticsAfterActive.lastQuery?.candidatePoolSize ?? null,
      totalActionNodes: diagnosticsAfterActive.lastQuery?.totalTypeNodeCount ?? null,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-query-optimization] failed:', error);
  process.exitCode = 1;
});
