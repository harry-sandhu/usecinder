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

  if (!dom.window.HTMLElement.prototype.focus) {
    dom.window.HTMLElement.prototype.focus = function focus() {};
  }
}

function createMarkup() {
  return `
    <main>
      <section id="reports-page" cinder-route="reports" data-cinder-path="/reports">
        <div id="crop-prices" cinder-context="crop-prices">
          <input id="mobile-field" cinder-field="mobile" />
          <button id="save-btn" cinder-action="save">Save</button>
          <div id="price-output" tabindex="0" cinder-output="price">Price</div>
        </div>
      </section>
    </main>
  `;
}

async function main() {
  const dom = new JSDOM(createMarkup(), {
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

  await runtime.scan(dom.window.document);

  runtime.on('resolve:start', () => {
    throw new Error('event handler boom');
  });
  runtime.on('resolve:end', async () => {
    throw new Error('async event handler boom');
  });

  runtime.registerIntent({
    id: 'broken-matcher',
    match() {
      throw new Error('matcher boom');
    },
  });

  const resolved = runtime.resolve('open reports');
  assert(resolved.intent === 'navigate', 'Expected built-in resolution to continue after matcher failure.');

  runtime.registerDomAdapter({
    id: 'broken-adapter-match',
    match() {
      throw new Error('adapter match boom');
    },
    async execute() {
      return false;
    },
  });

  const adapterFailure = await runtime.run('read price', dom.window.document);
  assert(adapterFailure.dispatch.handled === false, 'Expected adapter match failure to return a safe failed dispatch result.');
  assert(adapterFailure.dispatch.errors.some((error) => error.includes('adapter match boom')), 'Expected adapter match error to be surfaced safely.');

  runtime.unregisterDomAdapter('broken-adapter-match');

  runtime.registerDomAdapter({
    id: 'broken-adapter-execute',
    match() {
      return true;
    },
    async execute() {
      throw new Error('adapter execute boom');
    },
  });

  const adapterExecuteFailure = await runtime.run('read price', dom.window.document);
  assert(adapterExecuteFailure.dispatch.handled === false, 'Expected adapter execute failure to return a safe failed dispatch result.');
  assert(adapterExecuteFailure.dispatch.errors.some((error) => error.includes('adapter execute boom')), 'Expected adapter execute error to be surfaced safely.');

  runtime.unregisterDomAdapter('broken-adapter-execute');

  runtime.bind('action', 'save', async () => {
    throw new Error('binding boom');
  });

  const bindingFailure = await runtime.run('save', dom.window.document);
  assert(bindingFailure.dispatch.handled === false, 'Expected throwing binding handler to return a safe failed dispatch result.');
  assert(bindingFailure.dispatch.errors.some((error) => error.includes('binding boom')), 'Expected binding error to be surfaced safely.');

  runtime.registerRoute({
    key: 'broken-route',
    async navigate() {
      throw new Error('route boom');
    },
  });

  const routeFailure = await runtime.dispatch({
    intent: 'navigate',
    target: 'broken-route',
    confidence: 1,
    source: 'local',
    normalizedInput: {
      raw: 'open broken route',
      normalized: 'open broken route',
      tokens: ['open', 'broken', 'route'],
    },
    steps: [{ type: 'navigate', target: 'broken-route' }],
  }, dom.window.document);
  assert(routeFailure.handled === false, 'Expected throwing route callback to fail safely instead of crashing dispatch.');
  assert(routeFailure.errors.some((error) => error.includes('route boom')), 'Expected route callback error to be surfaced safely.');

  runtime.onReflex(() => {
    throw new Error('reflex boom');
  });

  const reflexResult = await runtime.run('open reports', dom.window.document);
  assert(reflexResult.intent.intent === 'navigate', 'Expected reflex handler failure not to break runtime.run.');

  runtime.onSpeechError(() => {
    throw new Error('speech error boom');
  });

  const listenResult = await runtime.listen({ root: dom.window.document, autoRun: false });
  assert(listenResult.ok === false, 'Expected unsupported speech environment to still return a normal listen result.');
  assert(listenResult.status === 'unsupported', 'Expected unsupported speech status after throwing speech error handler.');

  runtime.destroy();

  console.log(JSON.stringify({
    ok: true,
    summary: {
      resolvedIntent: resolved.intent,
      adapterFailureErrors: adapterFailure.dispatch.errors,
      bindingFailureErrors: bindingFailure.dispatch.errors,
      routeFailureErrors: routeFailure.errors,
      listenStatus: listenResult.status,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-extension-safety] failed:', error);
  process.exitCode = 1;
});
