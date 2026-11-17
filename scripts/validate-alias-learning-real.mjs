// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
// Real-model end-to-end proof for createAliasLearningLlmCore - downloads the real embedding
// model on first run (same reasoning as validate-embeddings.mjs), so this is NOT part of the
// fast CI chain; run it explicitly when working on aliasLearning.ts. Proves the actual claim
// ("tier 3 teaches tier 2, so next time a similar sentence is resolved BY tier 2") against the
// real model, not just the orchestration logic covered by validate-alias-learning.mjs's fakes.
import { JSDOM } from 'jsdom';
import { CinderSemanticRuntime } from '../packages/cinder/dist/index.js';
import { createAliasLearningLlmCore, resetEmbedderForTests } from '../packages/cinder-embeddings/dist/index.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function installDomGlobals(dom) {
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLInputElement = dom.window.HTMLInputElement;
  globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
  globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
  globalThis.Event = dom.window.Event;
  globalThis.CSS = dom.window.CSS ?? { escape(value) { return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&'); } };
}

function createMarkup() {
  return `
    <nav>
      <a cinder-route="billing-settings" aria-label="Billing settings" href="#">Billing settings</a>
      <a cinder-route="user-profile" aria-label="User profile" href="#">User profile</a>
    </nav>
  `;
}

async function main() {
  const dom = new JSDOM(createMarkup(), { url: 'http://localhost/' });
  installDomGlobals(dom);
  resetEmbedderForTests();

  const runtime = new CinderSemanticRuntime();
  await runtime.init({
    semantic: { scanOnInit: false, observeMutations: false },
    ai: { enabled: true, mode: 'local', endpoint: '', apiKey: '' },
  });
  await runtime.scan(dom.window.document);

  // A fake tier-3: the ONLY thing standing in for a real cloud call, so the test is honest
  // about what's actually being verified here - that the REAL embedding model, once taught,
  // resolves a later DIFFERENT phrasing of the same request on its own. Deliberately a real
  // paraphrase (shares no words with "Billing settings" but is clearly, specifically about
  // billing/payment, not the unrelated "User profile") rather than a pure wordless synonym
  // ("late payments" for "overdue loans") - `verifyBeforeTeaching`'s cross-encoder check (added
  // after a real cascading-false-teach bug was found - see docs/known-limitations.md) can only
  // confirm what it can see in the text itself, not domain knowledge a real LLM would separately
  // bring, so a teachable example needs to be specific enough for a text-only model to verify.
  let tier3CallCount = 0;
  const fakeTier3 = {
    async infer(input, localIntent) {
      tier3CallCount += 1;

      if (input !== 'where can i update my payment method') {
        return { meta: { endpoint: '', provider: 'fake-tier3', authMode: 'none', timeoutMs: 0, reason: 'unknown_intent', latencyMs: 1, normalized: false, used: false } };
      }

      return {
        intent: { intent: 'navigate', target: 'billing-settings', confidence: 0.75, source: 'cloud', normalizedInput: localIntent.normalizedInput, matchedNodeIds: [], reason: 'fake tier-3 answer' },
        meta: { endpoint: '', provider: 'fake-tier3', authMode: 'none', timeoutMs: 0, reason: 'unknown_intent', latencyMs: 1, normalized: true, used: true },
      };
    },
  };

  runtime.setLlmCore(createAliasLearningLlmCore(fakeTier3, { storageKey: false }), { requiresNetwork: false });

  // 1. A phrasing with no real alias overlap at all must fall through to tier 3.
  const first = await runtime.run('where can i update my payment method', dom.window.document);
  assert(first.intent.intent === 'navigate' && first.intent.target === 'billing-settings', 'Expected tier 3 to resolve the teaching call correctly.');
  assert(first.intent.source === 'cloud', 'Expected the first call to be sourced from tier 3, not tier 2 (nothing learned yet).');
  assert(tier3CallCount === 1, 'Expected tier 3 to be called exactly once for the teaching call.');

  // 2. A DIFFERENT, never-before-seen paraphrase of the same request - the real test. If the
  // real embedding model now resolves this via the taught alias, tier 3 must NOT be called again.
  const second = await runtime.run('i need to change how i pay', dom.window.document);
  assert(second.intent.intent === 'navigate' && second.intent.target === 'billing-settings', `Expected the real embedding model to resolve the new paraphrase correctly using the taught alias, got target "${second.intent.target}".`);
  assert(second.intent.source === 'embedding', `Expected the second call to be resolved BY tier 2 (source "embedding"), got "${second.intent.source}".`);
  assert(tier3CallCount === 1, 'Expected tier 3 NOT to be called again - the real point of this feature.');

  console.log('Real-model alias learning validation passed: tier 3 taught tier 2, and a NEW paraphrase was resolved by tier 2 alone.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
