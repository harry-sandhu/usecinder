// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { JSDOM } from 'jsdom';
import {
  CinderSemanticRuntime,
  getHybridGraphDiagnostics,
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
}

async function main() {
  const dom = new JSDOM(`
    <main>
      <section cinder-route="docs-quick-start" data-cinder-path="/docs/quick-start">
        <div cinder-context="quick-start-page">
          <button cinder-action="open-installation">Open installation</button>
        </div>
      </section>
    </main>
  `, {
    url: 'http://localhost/docs/quick-start',
  });

  installDomGlobals(dom);

  const runtime = new CinderSemanticRuntime();
  runtime.registerRoute({
    key: 'docs-quick-start',
    path: '/docs/quick-start',
    aliases: ['quick start', 'getting started'],
    isActive: () => dom.window.location.pathname === '/docs/quick-start',
  });

  runtime.registerColdGraph({
    id: 'docs-catalog',
    nodes: [
      {
        type: 'route',
        key: 'docs-quick-start',
        label: 'Quick Start',
        aliases: ['quick start guide'],
        metadata: {
          routePath: '/docs/quick-start',
          section: 'getting-started',
        },
      },
      {
        type: 'context',
        key: 'quick-start-page',
        routeKey: 'docs-quick-start',
        label: 'Quick Start Page',
      },
      {
        type: 'output',
        key: 'first-win',
        routeKey: 'docs-quick-start',
        contextPath: ['quick-start-page'],
        label: 'First Win',
      },
    ],
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

  await runtime.scan(dom.window.document);
  const graph = runtime.graph();
  const diagnostics = getHybridGraphDiagnostics(graph);
  const routeNode = graph.nodes.find((node) => node.type === 'route' && node.key === 'docs-quick-start');
  const outputNode = graph.nodes.find((node) => node.type === 'output' && node.key === 'first-win');

  assert(routeNode, 'Expected quick-start route node to exist in the hybrid graph.');
  assert(routeNode.metadata?.graphTemperature === 'hot', 'Expected rendered route node to stay hot after cold graph merge.');
  assert(Array.isArray(routeNode.metadata?.graphSources), 'Expected route node graphSources metadata.');
  assert(routeNode.metadata.graphSources.includes('scan'), 'Expected route node to record scan source.');
  assert(routeNode.metadata.graphSources.includes('route_registry'), 'Expected route node to record route registry source.');
  assert(routeNode.metadata.graphSources.includes('cold_catalog'), 'Expected route node to record cold catalog source.');
  assert(routeNode.metadata.section === 'getting-started', 'Expected cold metadata to enrich the rendered hot route node.');
  assert(outputNode?.metadata?.graphTemperature === 'cold', 'Expected catalog-only output node to remain cold.');
  assert(diagnostics.mode === 'hybrid', 'Expected diagnostics mode to be hybrid.');
  assert(diagnostics.hybridNodeCount >= 1, 'Expected at least one node with multiple graph sources.');
  assert(diagnostics.routeRegistryNodeCount >= 1, 'Expected route registry contribution to be counted.');
  assert(diagnostics.coldCatalogNodeCount >= 2, 'Expected cold catalog contribution to be counted.');
  assert(diagnostics.coldCatalogIds.includes('docs-catalog'), 'Expected cold catalog id to be reported in diagnostics.');
  assert(graph.meta.hybrid?.mode === 'hybrid', 'Expected snapshot meta to carry hybrid diagnostics.');

  runtime.destroy();

  console.log(JSON.stringify({
    ok: true,
    summary: {
      mode: diagnostics.mode,
      hotNodeCount: diagnostics.hotNodeCount,
      coldNodeCount: diagnostics.coldNodeCount,
      hybridNodeCount: diagnostics.hybridNodeCount,
      routeRegistryNodeCount: diagnostics.routeRegistryNodeCount,
      coldCatalogIds: diagnostics.coldCatalogIds,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-hybrid-graph-diagnostics] failed:', error);
  process.exitCode = 1;
});
