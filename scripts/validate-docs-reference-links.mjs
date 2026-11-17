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
      <article id="bind-page" cinder-route="docs-api-bind" data-cinder-path="/docs/api/bind">
        <div cinder-context="bind-page">
          <p>
            Use <a id="unbind-method-link" href="/docs/api/unbind"><code>Cinder.unbind()</code></a>
            when a binding should no longer be active.
          </p>
          <p>
            See <a href="/docs/api/run">Cinder.run()</a> for the full pipeline.
          </p>
        </div>
      </article>
    </main>
  `, {
    url: 'http://localhost/docs/api/bind',
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
  const graph = runtime.graph();
  const harvestedRoute = graph.nodes.find((node) => node.type === 'route' && node.metadata?.routePath === '/docs/api/unbind');

  assert(harvestedRoute, 'Expected an untagged internal docs link to become a route reference node.');
  assert(Array.isArray(harvestedRoute.aliases) && harvestedRoute.aliases.includes('unbind-method'), 'Expected harvested route aliases to include method-style lookup.');

  const result = await runtime.run('open unbind method', dom.window.document);
  assert(result.intent.intent === 'navigate', 'Expected navigate intent for harvested docs method reference.');
  assert(result.dispatch.handled, 'Expected harvested docs method reference to dispatch successfully.');
  assert(dom.window.location.pathname === '/docs/api/unbind', `Expected pathname /docs/api/unbind, got ${dom.window.location.pathname}.`);

  runtime.destroy();

  console.log(JSON.stringify({
    ok: true,
    summary: {
      target: result.intent.target,
      path: dom.window.location.pathname,
      aliases: harvestedRoute.aliases,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-docs-reference-links] failed:', error);
  process.exitCode = 1;
});
