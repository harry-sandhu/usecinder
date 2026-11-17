// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
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
  const dom = new JSDOM(`
    <main>
      <header>
        <a href="/docs/quick-start" cinder-route="docs-quick-start">Quick Start</a>
      </header>
      <aside>
        <a href="/docs/quick-start" cinder-route="docs-quick-start" aria-current="page">Quick Start Docs</a>
      </aside>
      <footer>
        <a href="/docs/quick-start" cinder-route="docs-quick-start">Get Started</a>
      </footer>
    </main>
  `, {
    url: 'http://localhost/',
  });

  installDomGlobals(dom);

  for (const link of dom.window.document.querySelectorAll('a[href]')) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const href = link.getAttribute('href');
      if (href) {
        dom.window.history.pushState({}, '', href);
      }
    });
  }

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

  const scan = await runtime.scan(dom.window.document);
  assert(!scan.warnings.some((warning) => warning.code === 'duplicate-key-in-context' && warning.type === 'route'), 'Expected repeated route references to avoid duplicate route warnings.');

  const graph = runtime.graph();
  const quickStartRoutes = graph.nodes.filter((node) => node.type === 'route' && node.key === 'docs-quick-start');
  assert(quickStartRoutes.length === 1, 'Expected repeated cinder-route references to merge into one logical route node.');

  const quickStartRoute = quickStartRoutes[0];
  assert(quickStartRoute.sources?.length === 3, 'Expected merged route node to preserve all DOM route references.');
  assert(quickStartRoute.metadata?.routeReferenceCount === 3, 'Expected merged route metadata to expose route reference count.');
  assert(quickStartRoute.metadata?.href === '/docs/quick-start', 'Expected merged route node to preserve route href metadata.');

  const result = await runtime.run('open quick start', dom.window.document);
  assert(result.intent.intent === 'navigate', 'Expected repeated route references to resolve as a navigate intent.');
  assert(result.dispatch.handled, 'Expected repeated route references to dispatch successfully.');
  assert(dom.window.location.pathname === '/docs/quick-start', 'Expected merged route reference navigation to update the location path.');

  const updatedGraph = runtime.graph();
  const activeRoute = updatedGraph.nodes.find((node) => node.id === updatedGraph.runtime.activeRouteId);
  assert(activeRoute?.key === 'docs-quick-start', 'Expected merged repeated route references to become the active route after navigation.');

  runtime.destroy();

  console.log(JSON.stringify({
    ok: true,
    summary: {
      routeCount: graph.nodes.filter((node) => node.type === 'route').length,
      routeReferenceCount: quickStartRoute.metadata?.routeReferenceCount,
      sourceCount: quickStartRoute.sources?.length,
      navigatedTo: dom.window.location.pathname,
      activeRoute: activeRoute?.key,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-route-reference-merge] failed:', error);
  process.exitCode = 1;
});
