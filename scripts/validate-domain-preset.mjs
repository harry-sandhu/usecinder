import { JSDOM } from 'jsdom';
import {
  CinderSemanticRuntime,
  createAgriculturePriceFlowIntentMatcher,
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
        <div id="crop-prices" cinder-context="crop-prices">
          <select id="crop-filter" cinder-filter="crop">
            <option value="">Select crop</option>
            <option value="soybean">Soybean</option>
          </select>
          <select id="state-filter" cinder-filter="state">
            <option value="">Select state</option>
            <option value="punjab">Punjab</option>
          </select>
          <button id="search-btn" cinder-action="search">Search</button>
          <div id="price-output" tabindex="0" cinder-output="price">Price</div>
        </div>
      </section>
    </main>
  `;
}

async function createRuntime(registerPreset) {
  const dom = new JSDOM(createMarkup(), {
    url: 'http://localhost/reports',
  });
  installDomGlobals(dom);

  const runtime = new CinderSemanticRuntime();
  if (registerPreset) {
    runtime.registerIntent(createAgriculturePriceFlowIntentMatcher());
  }

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
  return { dom, runtime };
}

async function main() {
  const withoutPreset = await createRuntime(false);
  const withoutPresetIntent = withoutPreset.runtime.resolve('show soybean prices in punjab');
  assert(withoutPresetIntent.intent !== 'composite_flow', 'Expected generic core resolution not to provide the agriculture composite flow by default.');
  withoutPreset.runtime.destroy();

  const withPreset = await createRuntime(true);
  const withPresetIntent = withPreset.runtime.resolve('show soybean prices in punjab');
  assert(withPresetIntent.intent === 'composite_flow', 'Expected explicit agriculture preset registration to enable the domain-specific composite flow.');
  withPreset.runtime.destroy();

  console.log(JSON.stringify({
    ok: true,
    summary: {
      withoutPresetIntent: withoutPresetIntent.intent,
      withPresetIntent: withPresetIntent.intent,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-domain-preset] failed:', error);
  process.exitCode = 1;
});
