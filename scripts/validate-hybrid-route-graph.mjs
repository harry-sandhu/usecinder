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

  if (!dom.window.HTMLElement.prototype.scrollIntoView) {
    dom.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
  }
}

async function main() {
  const dom = new JSDOM(`
    <main>
      <section cinder-route="home" data-cinder-path="/">
        <div cinder-context="hero">
          <button cinder-action="open-docs">Open Docs</button>
        </div>
      </section>
    </main>
  `, {
    url: 'http://localhost/',
  });

  installDomGlobals(dom);

  const runtime = new CinderSemanticRuntime();
  let navigatedTo;

  runtime.registerRoute({
    key: 'home',
    path: '/',
    aliases: ['homepage'],
    navigate: () => {
      navigatedTo = '/';
    },
    isActive: () => dom.window.location.pathname === '/',
  });

  runtime.registerRoute({
    key: 'docs-quick-start',
    path: '/docs/quick-start',
    aliases: ['quick start', 'docs quick start', 'getting started'],
    navigate: () => {
      navigatedTo = '/docs/quick-start';
      dom.window.history.pushState({}, '', '/docs/quick-start');
    },
    isActive: () => dom.window.location.pathname === '/docs/quick-start',
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
  const quickStartRoute = graph.nodes.find((node) => node.type === 'route' && node.key === 'docs-quick-start');
  assert(quickStartRoute, 'Expected registered quick-start route to appear in the graph even without a DOM tag.');
  assert(quickStartRoute.metadata?.graphTemperature === 'cold', 'Expected non-rendered registered route to be marked as cold graph state.');
  assert(quickStartRoute.metadata?.routePath === '/docs/quick-start', 'Expected registered route metadata to preserve route path.');

  const result = await runtime.run('open quick start', dom.window.document);
  assert(result.intent.intent === 'navigate', 'Expected open quick start to resolve as navigate from the hybrid route graph.');
  assert(result.intent.target === 'docs-quick-start', 'Expected navigation target to use the registered quick-start route key.');
  assert(result.dispatch.handled, 'Expected registered route navigation to dispatch successfully.');
  assert(navigatedTo === '/docs/quick-start', 'Expected registered route navigate() callback to run.');

  const updatedGraph = runtime.graph();
  const activeRoute = updatedGraph.nodes.find((node) => node.id === updatedGraph.runtime.activeRouteId);
  assert(activeRoute?.key === 'docs-quick-start', 'Expected cold quick-start route to become active after navigation.');

  runtime.destroy();

  console.log(JSON.stringify({
    ok: true,
    summary: {
      routeCount: graph.nodes.filter((node) => node.type === 'route').length,
      quickStartTemperature: quickStartRoute.metadata?.graphTemperature,
      navigatedTo,
      activeRoute: activeRoute?.key,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-hybrid-route-graph] failed:', error);
  process.exitCode = 1;
});
