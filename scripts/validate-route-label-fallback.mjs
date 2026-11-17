// Coverage for CinderRouteDefinition.label (packages/cinder/src/types.ts +
// core/cag/hybridGraph.ts) - the fix for a real gap found via live testing: a route only ever
// reachable through a JS callback (no real cinder-route-tagged DOM element at all, e.g. a CRM's
// "My profile" page opened from a menu item's onSelect, not a real link) had no way to get a
// real label - the synthetic node's label was hardcoded to the bare key, with nothing a
// developer could set to fix it short of adding a whole new tagged element just for this. This
// also covers the second real case: a route that DOES have a real tagged element, but that
// element itself has no accessible name (no aria-label, no associated <label>) - same fix,
// same field, used as a fallback rather than an override.
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
  globalThis.Event = dom.window.Event;
  globalThis.CSS = dom.window.CSS ?? {
    escape(value) {
      return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    },
  };
}

async function main() {
  const dom = new JSDOM(`
    <main>
      <a cinder-route="billing" href="/billing">Billing</a>
      <a cinder-route="support" aria-label="Open Support Center" href="/support">Support</a>
    </main>
  `, { url: 'http://localhost/' });

  installDomGlobals(dom);

  const runtime = new CinderSemanticRuntime();

  // 1. No tagged DOM element at all (like the real "My profile" case) - the label must come
  // from the route definition, not fall back to the bare key.
  runtime.registerRoute({ key: 'profile', path: '/profile', label: 'My profile', aliases: ['my profile', 'account settings'] });

  // 2. A real tagged element exists but has no accessible name of its own ("billing" has no
  // aria-label and JSDOM doesn't compute an accessible name from text content for `label`) -
  // the route definition's label must fill in as a fallback.
  runtime.registerRoute({ key: 'billing', path: '/billing', label: 'Billing settings' });

  // 3. A real tagged element has ITS OWN real accessible name - that must win over the route
  // definition's label, never be silently overridden.
  runtime.registerRoute({ key: 'support', path: '/support', label: 'This should never be used' });

  await runtime.init({
    semantic: { scanOnInit: false, observeMutations: false },
    ai: { enabled: false, mode: 'local', endpoint: '', apiKey: '' },
  });
  await runtime.scan(dom.window.document);

  const snapshot = runtime.graph();
  const profile = snapshot.nodes.find((n) => n.key === 'profile');
  const billing = snapshot.nodes.find((n) => n.key === 'billing');
  const support = snapshot.nodes.find((n) => n.key === 'support');

  assert(profile?.label === 'My profile', `Expected the untagged route's label to come from the route definition, got "${profile?.label}".`);
  assert(billing?.label === 'Billing settings', `Expected the tagged-but-unlabeled element's label to fall back to the route definition, got "${billing?.label}".`);
  assert(support?.label === 'Open Support Center', `Expected the real tagged element's own accessible name to win over the route definition's label, got "${support?.label}".`);

  console.log('All route label fallback validations passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
