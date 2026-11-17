// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
// Coverage for @cinder/embeddings (tier 2: a client-side embedding model recovering
// paraphrases/typos tier 1's deterministic graph engine can't resolve).
//
// Deliberately NOT part of validate-red-team-suite.mjs's fast chain: this downloads and
// loads a real ~23MB ONNX model on first run (cached by onnxruntime/transformers.js after
// that, but still real I/O a fast local/CI loop shouldn't pay on every run). Run it
// explicitly via `npm run validate:embeddings` when working on this package.
import { JSDOM } from 'jsdom';
import { CinderSemanticRuntime } from '../packages/cinder/dist/index.js';
import { createEmbeddingLlmCore, resetEmbedderForTests } from '../packages/cinder-embeddings/dist/index.js';

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
      <section cinder-route="pricing" data-cinder-path="/pricing">Pricing</section>
      <section cinder-route="documentation" data-cinder-path="/docs">Documentation</section>
      <div cinder-context="c">
        <div cinder-output="weather-forecast" aria-label="Weather forecast">Weather</div>
        <button cinder-action="submit-order" aria-label="Submit order">Submit Order</button>
      </div>
    </main>
  `;
}

async function main() {
  resetEmbedderForTests();

  const dom = new JSDOM(createMarkup(), { url: 'http://localhost/' });
  installDomGlobals(dom);

  const runtime = new CinderSemanticRuntime();
  await runtime.init({
    semantic: { scanOnInit: false, observeMutations: false },
    ai: { enabled: true, mode: 'local', endpoint: '', apiKey: '' },
  });
  await runtime.scan(dom.window.document);

  runtime.setLlmCore(createEmbeddingLlmCore(), { requiresNetwork: false });

  // 1. A genuine paraphrase sharing no words with the target must be recovered.
  const pricingResult = await runtime.run('how much does this cost', dom.window.document);
  assert(pricingResult.intent.intent === 'navigate' && pricingResult.intent.target === 'pricing', `Expected "how much does this cost" to resolve to pricing, got ${pricingResult.intent.target}.`);
  assert(pricingResult.intent.source === 'embedding', 'Expected the match to be attributed to the embedding tier, not local/cloud.');
  assert(pricingResult.intent.confidence < 0.85, 'Expected a tier-2 match to never classify as resolved_exact (confidence must stay below 0.85).');

  // 2. Output-type and action-type nodes are both in scope (not just routes).
  const weatherResult = await runtime.run('what is the weather going to be like', dom.window.document);
  assert(weatherResult.intent.intent === 'show_output' && weatherResult.intent.target === 'weather-forecast', 'Expected a weather paraphrase to resolve to the weather-forecast output.');

  const orderResult = await runtime.run('place my order', dom.window.document);
  assert(orderResult.intent.intent === 'trigger_action' && orderResult.intent.target === 'submit-order', 'Expected an order paraphrase to resolve to the submit-order action.');

  // 3. A genuinely unrelated query must stay unresolved - no false positives, same as
  // every other tier in this project.
  const unrelatedResult = await runtime.run('what is the capital of france', dom.window.document);
  assert(unrelatedResult.intent.intent === 'unknown', `Expected an unrelated query to stay unresolved, got "${unrelatedResult.intent.intent}" -> "${unrelatedResult.intent.target}".`);

  // 4. Tier 1 success must short-circuit tier 2 - a command tier 1 can already resolve
  // should never reach the embedding model at all.
  const tier1Result = await runtime.run('open pricing', dom.window.document);
  assert(tier1Result.intent.source === 'local', `Expected tier 1 to resolve "open pricing" directly without escalating, got source "${tier1Result.intent.source}".`);

  runtime.destroy();

  console.log(JSON.stringify({
    ok: true,
    summary: {
      pricingMatch: { target: pricingResult.intent.target, confidence: pricingResult.intent.confidence },
      weatherMatch: { target: weatherResult.intent.target, confidence: weatherResult.intent.confidence },
      orderMatch: { target: orderResult.intent.target, confidence: orderResult.intent.confidence },
      unrelatedOutcome: unrelatedResult.intent.intent,
      tier1ShortCircuit: tier1Result.intent.source,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-embeddings-fallback] failed:', error);
  process.exitCode = 1;
});
