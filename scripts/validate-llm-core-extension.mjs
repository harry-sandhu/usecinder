// Coverage for the swappable llm-core extension point (Cinder.setLlmCore/resetLlmCore,
// core/csr/csrRuntime.ts) - the hook tier 2 (a client-side embedding model) and, eventually,
// a real tier 3 cloud fallback are meant to plug into. This is the architecture decision
// from docs/local-engine-fully-fledged-plan.md: reuse the existing fallback-escalation
// decision (ai.enabled + resolution weakness) and dispatch/respond pipeline rather than
// building a separate, duplicate "try tier 2" wrapper around Cinder.run().
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
  globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
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
      <div cinder-context="c">
        <button cinder-action="search">Search</button>
      </div>
    </main>
  `;
}

async function createRuntime(dom) {
  const runtime = new CinderSemanticRuntime();
  await runtime.init({
    semantic: { scanOnInit: false, observeMutations: false },
    ai: { enabled: true, mode: 'local', endpoint: '', apiKey: '' },
  });
  await runtime.scan(dom.window.document);
  return runtime;
}

function createStubLocalCore() {
  const state = { called: false };
  const core = {
    async infer(_input, localIntent, snapshot) {
      state.called = true;
      const searchNode = snapshot.nodes.find((node) => node.type === 'action' && node.key === 'search');

      return {
        intent: {
          intent: 'trigger_action',
          source: 'cloud',
          normalizedInput: localIntent.normalizedInput,
          target: 'search',
          confidence: 0.9,
          matchedNodeIds: searchNode ? [searchNode.id] : [],
          steps: [{ type: 'trigger_action', target: 'search' }],
        },
        meta: {
          endpoint: '',
          provider: 'local-embedding-stub',
          authMode: 'none',
          timeoutMs: 0,
          reason: 'unknown_intent',
          latencyMs: 1,
          used: true,
          normalized: true,
        },
      };
    },
  };

  return { core, state };
}

async function main() {
  const dom = new JSDOM(createMarkup(), { url: 'http://localhost/' });
  installDomGlobals(dom);

  // 1. Default behavior, mode "local", no custom core - fallback must never fire. This is
  // the existing guarantee ("local mode never touches the network") and must hold unchanged.
  {
    const runtime = await createRuntime(dom);
    const result = await runtime.run('gibberish nonsense', dom.window.document);
    assert(result.intent.intent === 'unknown', 'Expected mode=local with no custom core to never escalate.');
    runtime.destroy();
  }

  // 2. A custom core explicitly marked requiresNetwork:false DOES run in mode "local" and
  // its result is dispatched through the normal pipeline.
  {
    const runtime = await createRuntime(dom);
    const { core, state } = createStubLocalCore();
    runtime.setLlmCore(core, { requiresNetwork: false });
    const result = await runtime.run('gibberish nonsense', dom.window.document);
    assert(state.called, 'Expected the local-safe custom core to be called.');
    assert(result.intent.intent === 'trigger_action' && result.intent.target === 'search', 'Expected the custom core\'s result to be used.');
    assert(result.dispatch.handled === true, 'Expected the custom core\'s result to actually dispatch.');
    runtime.destroy();
  }

  // 3. The safe default: a custom core installed WITHOUT requiresNetwork:false must NOT run
  // in mode "local" - installing an unmarked custom core can't silently make local mode
  // start reaching the network.
  {
    const runtime = await createRuntime(dom);
    let called = false;
    runtime.setLlmCore({ async infer() { called = true; return undefined; } });
    const result = await runtime.run('gibberish nonsense', dom.window.document);
    assert(!called, 'Expected an unmarked custom core to NOT be called in mode=local (safe default).');
    assert(result.intent.intent === 'unknown', 'Expected resolution to stay unknown when the unmarked core correctly did not run.');
    runtime.destroy();
  }

  // 4. resetLlmCore() restores the default (no fallback in local mode).
  {
    const runtime = await createRuntime(dom);
    const { core } = createStubLocalCore();
    runtime.setLlmCore(core, { requiresNetwork: false });
    runtime.resetLlmCore();
    const result = await runtime.run('gibberish nonsense', dom.window.document);
    assert(result.intent.intent === 'unknown', 'Expected resetLlmCore() to restore the no-fallback-in-local-mode default.');
    runtime.destroy();
  }

  console.log(JSON.stringify({
    ok: true,
    summary: {
      scenariosChecked: 4,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-llm-core-extension] failed:', error);
  process.exitCode = 1;
});
