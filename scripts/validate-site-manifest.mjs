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

  runtime.registerSiteManifest({
    id: 'docs-site-manifest',
    routes: [
      {
        key: 'docs-home',
        path: '/docs',
        title: 'Documentation Home',
        aliases: ['docs', 'documentation'],
      },
      {
        key: 'docs-quick-start',
        path: '/docs/quick-start',
        title: 'Quick Start',
        aliases: ['quick start', 'getting started'],
        nodes: [
          {
            type: 'context',
            key: 'page',
            label: 'Quick Start Page',
            children: [
              {
                type: 'output',
                key: 'first-win',
                label: 'First Win',
                aliases: ['first win'],
                metadata: {
                  routePath: '/docs/quick-start#first-win',
                },
              },
            ],
          },
        ],
      },
    ],
    groups: [
      {
        key: 'getting-started-group',
        title: 'Getting Started',
        routeKey: 'docs-home',
        memberRouteKeys: ['docs-home', 'docs-quick-start'],
      },
    ],
  });

  const manifests = runtime.getSiteManifests();
  assert(manifests.length === 1, 'Expected one registered site manifest.');

  const graph = runtime.graph();
  const routeNode = graph.nodes.find((node) => node.type === 'route' && node.key === 'docs-quick-start');
  const pageContext = graph.nodes.find((node) => node.type === 'context' && node.key === 'page' && node.routeId === routeNode?.id);
  const firstWinOutput = graph.nodes.find((node) => node.type === 'output' && node.key === 'first-win');

  assert(routeNode, 'Expected site manifest route to become a cold graph route node.');
  assert(pageContext, 'Expected site manifest context to be created under its route.');
  assert(firstWinOutput?.contextId === pageContext?.id, 'Expected nested site manifest output to remain scoped to the page context.');
  assert(graph.meta.hybrid?.coldCatalogCount === 1, 'Expected diagnostics to count the manifest-derived cold catalog.');

  const navResult = await runtime.run('open quick start', dom.window.document);
  assert(navResult.intent.intent === 'navigate', 'Expected quick start route to resolve from the site manifest graph.');
  assert(navResult.dispatch.handled, 'Expected site manifest route to dispatch by path.');
  assert(dom.window.location.pathname === '/docs/quick-start', 'Expected path navigation to update location from the site manifest route.');

  runtime.unregisterSiteManifest('docs-site-manifest');
  assert(runtime.getSiteManifests().length === 0, 'Expected site manifest to unregister cleanly.');

  runtime.destroy();

  console.log(JSON.stringify({
    ok: true,
    summary: {
      manifestCount: manifests.length,
      routeKey: routeNode?.key,
      activePath: dom.window.location.pathname,
      coldCatalogCount: graph.meta.hybrid?.coldCatalogCount,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-site-manifest] failed:', error);
  process.exitCode = 1;
});
