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
  const dom = new JSDOM('<main><h1>Docs shell</h1></main>', {
    url: 'http://localhost/',
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

  runtime.registerColdGraph({
    id: 'docs-catalog',
    nodes: [
      {
        type: 'route',
        key: 'docs-quick-start',
        label: 'Quick Start',
        aliases: ['quick start', 'getting started'],
        metadata: {
          routePath: '/docs/quick-start',
        },
      },
      {
        type: 'context',
        key: 'quick-start-page',
        routeKey: 'docs-quick-start',
        label: 'Quick Start Page',
      },
      {
        type: 'action',
        key: 'open-installation',
        routeKey: 'docs-quick-start',
        contextPath: ['quick-start-page'],
        label: 'Open Installation',
      },
      {
        type: 'output',
        key: 'first-win',
        routeKey: 'docs-quick-start',
        contextPath: ['quick-start-page'],
        label: 'First Win',
      },
    ],
    edges: [
      {
        type: 'navigates_to',
        from: {
          type: 'action',
          key: 'open-installation',
          routeKey: 'docs-quick-start',
          contextPath: ['quick-start-page'],
        },
        to: {
          type: 'route',
          key: 'docs-quick-start',
        },
      },
    ],
  });

  const graph = runtime.graph();
  const routeNode = graph.nodes.find((node) => node.type === 'route' && node.key === 'docs-quick-start');
  const contextNode = graph.nodes.find((node) => node.type === 'context' && node.key === 'quick-start-page');
  const actionNode = graph.nodes.find((node) => node.type === 'action' && node.key === 'open-installation');
  const outputNode = graph.nodes.find((node) => node.type === 'output' && node.key === 'first-win');

  assert(routeNode, 'Expected cold route node to exist after registerColdGraph().');
  assert(contextNode?.parentId === routeNode?.id, 'Expected cold context to be attached to its route.');
  assert(actionNode?.contextId === contextNode?.id, 'Expected cold action to stay scoped to its context.');
  assert(outputNode?.contextId === contextNode?.id, 'Expected cold output to stay scoped to its context.');
  assert(graph.meta.coldNodeCount >= 4, 'Expected cold node count metadata to include catalog nodes.');
  assert(graph.meta.hotNodeCount >= 1, 'Expected app root to remain part of the hot snapshot baseline.');
  assert(graph.edges.some((edge) => edge.type === 'navigates_to'), 'Expected explicit cold catalog edge to be merged into the graph.');

  runtime.unregisterColdGraph('docs-catalog');
  const clearedGraph = runtime.graph();
  assert(!clearedGraph.nodes.some((node) => node.key === 'docs-quick-start'), 'Expected cold graph unregister to remove catalog nodes from the snapshot.');

  runtime.destroy();

  console.log(JSON.stringify({
    ok: true,
    summary: {
      coldNodeCount: graph.meta.coldNodeCount,
      hotNodeCount: graph.meta.hotNodeCount,
      coldEdgeCount: graph.meta.coldEdgeCount,
      hotEdgeCount: graph.meta.hotEdgeCount,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-cold-graph-catalog] failed:', error);
  process.exitCode = 1;
});
