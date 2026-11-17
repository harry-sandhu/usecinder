// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
// Coverage for @usecinder/embeddings' constrained cross-encoder tiebreak stage (reranker.ts +
// its wiring into createEmbeddingLlmCore in index.ts) - the rare second stage that only runs
// when the embedding stage itself reports a genuine near-tie ("ambiguous"), never on a clean
// win or a clean miss. See reranker.ts's doc comment for why this replaced an originally
// planned generative-model approach (real testing found that unreliable; a cross-encoder -
// the standard architecture for pairwise "does X match Y" relevance scoring - tested as both
// more reliable and far smaller).
//
// Deliberately NOT part of validate-red-team-suite.mjs's fast chain: this downloads and loads
// a real ONNX model on first run (small, ~23MB, but still real I/O a fast local/CI loop
// shouldn't pay on every run). Run it explicitly via `npm run validate:embeddings-tiebreaker`.
import { JSDOM } from 'jsdom';
import { CinderSemanticRuntime } from '../packages/cinder/dist/index.js';
import {
  createEmbeddingLlmCore,
  resetEmbedderForTests,
  resetRerankerForTests,
} from '../packages/cinder-embeddings/dist/index.js';
import { pickTiebreakCandidate } from '../packages/cinder-embeddings/dist/reranker.js';

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
      <section cinder-route="pricing" aria-label="Pricing plans">Pricing</section>
      <section cinder-route="checkout" aria-label="Checkout and payment">Checkout</section>
    </main>
  `;
}

async function testPickTiebreakCandidateWithRealModel() {
  resetRerankerForTests();

  const dom = new JSDOM(createMarkup(), { url: 'http://localhost/' });
  installDomGlobals(dom);

  const runtime = new CinderSemanticRuntime();
  await runtime.init({ semantic: { scanOnInit: false, observeMutations: false } });
  await runtime.scan(dom.window.document);

  const snapshot = runtime.graph();
  const pricingNode = snapshot.nodes.find((node) => node.key === 'pricing');
  const checkoutNode = snapshot.nodes.find((node) => node.key === 'checkout');
  assert(pricingNode && checkoutNode, 'Expected both pricing and checkout nodes to exist in the scanned snapshot.');

  const candidates = [
    { node: pricingNode, score: 0.6 },
    { node: checkoutNode, score: 0.59 },
  ];

  const paymentPick = await pickTiebreakCandidate('I want to pay for my order now', candidates);
  assert(paymentPick?.node.key === 'checkout', `Expected a clear payment-intent message to pick "checkout", got "${paymentPick?.node.key}".`);

  const pricingPick = await pickTiebreakCandidate('what are your plans and costs', candidates);
  assert(pricingPick?.node.key === 'pricing', `Expected a clear pricing-intent message to pick "pricing", got "${pricingPick?.node.key}".`);

  // A genuinely unrelated message should fail to clear the minimum gap between the two
  // (already embedding-vetted) candidates - the cross-encoder itself declines rather than
  // arbitrarily picking whichever scored a hair higher.
  const nonePick = await pickTiebreakCandidate('what is the capital of france', candidates);
  assert(nonePick === undefined, `Expected a genuinely unrelated message to make the tiebreak step decline (return undefined), got "${nonePick?.node.key}".`);

  runtime.destroy();

  return { paymentPick: paymentPick?.node.key, pricingPick: pricingPick?.node.key, noneOutcome: nonePick };
}

async function testRuntimeWiring() {
  resetEmbedderForTests();
  resetRerankerForTests();

  const dom = new JSDOM(createMarkup(), { url: 'http://localhost/' });
  installDomGlobals(dom);

  const runtime = new CinderSemanticRuntime();
  await runtime.init({
    semantic: { scanOnInit: false, observeMutations: false },
    ai: { enabled: true, mode: 'local', endpoint: '', apiKey: '' },
  });
  await runtime.scan(dom.window.document);

  // An artificially huge minGap forces classifyMatchOutcome to report "ambiguous" for
  // virtually any real score pair, without needing to hand-engineer two candidates that
  // happen to tie exactly in real embedding space. This isolates what this test actually
  // checks: the index.ts orchestration wiring (does an "ambiguous" outcome correctly reach
  // pickTiebreakCandidate, and does its pick get reported honestly), not the embedding
  // model's own scoring behavior (already covered by validate-embeddings-fallback.mjs).
  const forcedAmbiguousOptions = { minScore: 0.1, minGap: 0.99 };

  runtime.setLlmCore(
    createEmbeddingLlmCore({ ...forcedAmbiguousOptions, enableTiebreaker: true }),
    { requiresNetwork: false },
  );
  const escalatedResult = await runtime.run('I want to pay for my order now', dom.window.document);
  assert(escalatedResult.intent.intent === 'navigate' && escalatedResult.intent.target === 'checkout', `Expected tiebreak escalation to resolve a payment-intent message to "checkout", got "${escalatedResult.intent.target}".`);
  assert(escalatedResult.intent.source === 'embedding', 'Expected the escalated pick to still report source "embedding" (it is tier 2, not a new tier).');
  assert(escalatedResult.intent.confidence === 0.55, `Expected the escalated pick's fixed confidence of 0.55, got ${escalatedResult.intent.confidence}.`);

  // Escalation must be strictly opt-in: the exact same forced-ambiguous scenario, without
  // enableTiebreaker, must stay an honest miss rather than silently picking the embedding's
  // raw (untrustworthy, by construction here) top candidate.
  runtime.setLlmCore(createEmbeddingLlmCore(forcedAmbiguousOptions), { requiresNetwork: false });
  const nonEscalatedResult = await runtime.run('I want to pay for my order now', dom.window.document);
  assert(nonEscalatedResult.intent.intent === 'unknown', `Expected the same ambiguous case to stay unresolved when escalation is disabled, got "${nonEscalatedResult.intent.intent}" -> "${nonEscalatedResult.intent.target}".`);

  runtime.destroy();

  return {
    escalatedTarget: escalatedResult.intent.target,
    escalatedConfidence: escalatedResult.intent.confidence,
    nonEscalatedOutcome: nonEscalatedResult.intent.intent,
  };
}

async function main() {
  const pickSummary = await testPickTiebreakCandidateWithRealModel();
  const wiringSummary = await testRuntimeWiring();

  console.log(JSON.stringify({
    ok: true,
    summary: { pickSummary, wiringSummary },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-embeddings-tiebreaker] failed:', error);
  process.exitCode = 1;
});
