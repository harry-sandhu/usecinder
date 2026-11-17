// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
// Coverage for createAliasLearningLlmCore (packages/cinder-embeddings/src/aliasLearning.ts) -
// "tier 3 teaches tier 2": once a cloud/tier-3 core resolves something, the input text is taught
// back as a new REAL alias on the resolved node, so a future similar input is recognized
// natively by tier 2's own existing ranking (source: "embedding"), not by a side-channel cache.
// Uses a fake embeddingCore injected via `embeddingCore` to verify the orchestration (enrich the
// snapshot -> try the embedding core -> teach on fallback) without the real model - no download,
// no network, consistent with keeping this in the fast CI loop unlike validate:embeddings.
// See scripts/validate-alias-learning-real.mjs for the real-model end-to-end proof.
import { createAliasLearningLlmCore } from '../packages/cinder-embeddings/dist/index.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function localIntentFor(input) {
  return { intent: 'unknown', confidence: 0.1, source: 'local', normalizedInput: { raw: input, tokens: input.split(' ') } };
}

const config = {};

// A fake "tier 2" that only succeeds if the snapshot's node for `expectedTarget` has `requiredAlias`
// in its (possibly learned-and-enriched) aliases list - lets a test assert the enrichment actually
// reached the embedding stage, without needing the real model to judge similarity.
function fakeEmbeddingCoreThatNeedsAlias(expectedTarget, requiredAlias) {
  let callCount = 0;

  const core = {
    async infer(input, localIntent, snapshot) {
      callCount += 1;
      const node = snapshot.nodes.find((n) => n.key === expectedTarget);
      const hasAlias = node?.aliases?.includes(requiredAlias);

      if (!hasAlias) {
        return { meta: { endpoint: '', provider: 'fake-tier2', authMode: 'none', timeoutMs: 0, reason: 'unknown_intent', latencyMs: 1, normalized: false, used: false } };
      }

      return {
        intent: { intent: 'navigate', target: expectedTarget, confidence: 0.8, source: 'embedding', normalizedInput: localIntent.normalizedInput, matchedNodeIds: [], reason: 'fake tier 2 matched the learned alias' },
        meta: { endpoint: '', provider: 'fake-tier2', authMode: 'none', timeoutMs: 0, reason: 'unknown_intent', latencyMs: 1, normalized: true, used: true },
      };
    },
  };

  return { core, getCallCount: () => callCount };
}

function fakeInnerCore(responses) {
  let callCount = 0;

  const core = {
    async infer(input, localIntent) {
      callCount += 1;
      const response = responses[input];

      if (!response) {
        return { meta: { endpoint: '', provider: 'fake-tier3', authMode: 'none', timeoutMs: 0, reason: 'unknown_intent', latencyMs: 1, normalized: false, used: false } };
      }

      return {
        intent: { ...response, normalizedInput: localIntent.normalizedInput, matchedNodeIds: [] },
        meta: { endpoint: '', provider: 'fake-tier3', authMode: 'none', timeoutMs: 0, reason: 'unknown_intent', latencyMs: 1, normalized: true, used: true },
      };
    },
  };

  return { core, getCallCount: () => callCount };
}

function snapshotWith(entries) {
  return { nodes: entries.map(([type, key]) => ({ id: `${type}:${key}`, type, key, aliases: [key] })) };
}

async function main() {
  // 1: a tier-3 resolution teaches an alias, and a LATER call reaches the embedding stage with
  // that alias already present on the right node (proving the enrichment is real, not assumed).
  {
    const snapshot = snapshotWith([['route', 'loans-overdue'], ['route', 'loans-active']]);
    const { core: embeddingCore, getCallCount: embeddingCalls } = fakeEmbeddingCoreThatNeedsAlias('loans-overdue', 'late payments');
    const { core: inner, getCallCount: innerCalls } = fakeInnerCore({
      'late payments': { intent: 'navigate', target: 'loans-overdue', confidence: 0.75, source: 'cloud' },
    });
    // Both the teach-time check (verifyBeforeTeaching, against the native "loans-overdue" text)
    // and the use-time check (verifyLearnedMatches, against the enriched "loans-overdue late
    // payments" text) must approve - fake it deterministically for both, so this stays a fast,
    // no-real-model test rather than quietly depending on whatever the real cross-encoder
    // happens to be cached as from an earlier run.
    const verifyFn = async (_input, candidateText) => (candidateText.includes('loans-overdue') ? 5 : -5);
    const learning = createAliasLearningLlmCore(inner, { storageKey: false, embeddingCore, verifyFn });

    const first = await learning.infer('late payments', localIntentFor('late payments'), snapshot, config);
    assert(first?.intent?.target === 'loans-overdue' && first.intent.source === 'cloud', 'Expected the first call to fall through to tier 3 and resolve correctly.');
    assert(innerCalls() === 1, 'Expected tier 3 to be called once for the teaching call.');

    const second = await learning.infer('late payments', localIntentFor('late payments'), snapshot, config);
    assert(second?.intent?.target === 'loans-overdue' && second.intent.source === 'embedding', 'Expected the second call to be resolved by the embedding stage using the taught alias.');
    assert(innerCalls() === 1, 'Expected tier 3 NOT to be called again once tier 2 could resolve it via the learned alias.');
    assert(embeddingCalls() === 2, 'Expected the embedding stage to be tried on both calls.');
  }

  // 2: a decline (tier 3 itself has no answer) must never teach a bogus alias.
  {
    const snapshot = snapshotWith([['route', 'loans-overdue']]);
    const { core: embeddingCore } = fakeEmbeddingCoreThatNeedsAlias('loans-overdue', 'never matches');
    const { core: inner, getCallCount: innerCalls } = fakeInnerCore({});
    const learning = createAliasLearningLlmCore(inner, { storageKey: false, embeddingCore });

    const first = await learning.infer('can you save for me', localIntentFor('can you save for me'), snapshot, config);
    assert(!first?.intent, 'Expected an honest decline to have no intent.');
    const second = await learning.infer('can you save for me', localIntentFor('can you save for me'), snapshot, config);
    assert(!second?.intent, 'Expected a repeated decline to still have no intent - nothing should have been taught.');
    assert(innerCalls() === 2, 'Expected tier 3 to be asked again both times - a decline teaches nothing.');
  }

  // 3: a resolution on a field/filter target must NOT be taught - tier 2's embedding ranking
  // never reads field/filter aliases (similarity.ts's CANDIDATE_TYPES), so teaching one would be
  // silently inert at best, and the scope should match that explicitly, not by accident.
  {
    const snapshot = snapshotWith([['field', 'global-search']]);
    let embeddingCallCount = 0;
    const embeddingCore = { async infer() { embeddingCallCount += 1; return { meta: { endpoint: '', provider: 'fake', authMode: 'none', timeoutMs: 0, reason: 'unknown_intent', latencyMs: 1, normalized: false, used: false } }; } };
    const { core: inner, getCallCount: innerCalls } = fakeInnerCore({
      'search for ramesh kumar': { intent: 'set_field', target: 'global-search', value: 'ramesh kumar', confidence: 0.7, source: 'cloud' },
    });
    const learning = createAliasLearningLlmCore(inner, { storageKey: false, embeddingCore });

    await learning.infer('search for ramesh kumar', localIntentFor('search for ramesh kumar'), snapshot, config);
    const second = await learning.infer('search for ramesh kumar', localIntentFor('search for ramesh kumar'), snapshot, config);
    assert(second?.intent?.source === 'cloud', 'Expected the field resolution to still come from tier 3 again - teaching a field alias is out of scope and must not silently "succeed" via some other path.');
    assert(innerCalls() === 2, 'Expected tier 3 to be asked again - nothing should have been taught for an out-of-scope node type.');
  }

  // 4: `verifyLearnedMatches` (default true) must override a WRONG learned-alias resolution -
  // the real failure mode found via live testing (docs/known-limitations.md): tier 2's own
  // built-in gap-check alone was measured 51-62% wrong once a freshly-taught alias was in the
  // mix. A fake embeddingCore here mimics that - it confidently (but wrongly) resolves to
  // 'routeB' once 'routeB' has a learned alias - and a fake verifyFn, scoring against each real
  // candidate's own label, must correctly override it back to tier 3.
  {
    const snapshot = snapshotWith([['route', 'routeA'], ['route', 'routeB']]);
    snapshot.nodes[0].label = 'Route A Real Label';
    snapshot.nodes[1].label = 'Route B Real Label';

    const embeddingCore = {
      async infer(input, localIntent, enrichedSnapshot) {
        const routeB = enrichedSnapshot.nodes.find((n) => n.key === 'routeB');
        if (!routeB.aliases.includes(input) && !(routeB.label ?? '').includes(input)) {
          return { meta: { endpoint: '', provider: 'fake', authMode: 'none', timeoutMs: 0, reason: 'unknown_intent', latencyMs: 1, normalized: false, used: false } };
        }
        // Rigged to confidently (and wrongly) pick routeB whenever its learned alias is present.
        return {
          intent: { intent: 'navigate', target: 'routeB', confidence: 0.8, source: 'embedding', normalizedInput: localIntent.normalizedInput, matchedNodeIds: [], reason: 'fake tier 2 (wrong)' },
          meta: { endpoint: '', provider: 'fake', authMode: 'none', timeoutMs: 0, reason: 'unknown_intent', latencyMs: 1, normalized: true, used: true },
        };
      },
    };

    const { core: inner, getCallCount: innerCalls } = fakeInnerCore({
      'open the real thing': { intent: 'navigate', target: 'routeB', confidence: 0.75, source: 'cloud' },
      'go to the real thing please': { intent: 'navigate', target: 'routeA', confidence: 0.75, source: 'cloud' },
    });

    // A fake cross-encoder that correctly reads the REAL labels (unlike the rigged embedding
    // stage, which was fooled by the learned alias text alone) - input-aware so it also
    // correctly APPROVES the first call's teach-time check (teaching routeB from "open the real
    // thing" is genuinely fine on its own), and only overrides the SECOND, different sentence.
    const verifyScores = {
      'open the real thing': { 'Route A Real Label': -5, 'Route B Real Label': 5 },
      'go to the real thing please': { 'Route A Real Label': 5, 'Route B Real Label': -5 },
    };
    const verifyFn = async (input, candidateText) => verifyScores[input]?.[candidateText] ?? 0;

    const learning = createAliasLearningLlmCore(inner, { storageKey: false, embeddingCore, verifyFn });

    // Teach 'routeB' a learned alias via the first call.
    await learning.infer('open the real thing', localIntentFor('open the real thing'), snapshot, config);
    assert(innerCalls() === 1, 'Expected the teaching call to go through tier 3.');

    // A second, different sentence - the rigged embedding stage now wrongly matches routeB
    // because of the learned alias, but verification must catch it and route correctly to tier 3.
    const second = await learning.infer('go to the real thing please', localIntentFor('go to the real thing please'), snapshot, config);
    assert(second?.intent?.target === 'routeA', `Expected verification to override the wrong learned-alias match and resolve correctly via tier 3, got "${second?.intent?.target}".`);
    assert(second?.intent?.source === 'cloud', 'Expected the overridden case to come from tier 3, not a trusted (wrong) embedding match.');
    assert(innerCalls() === 2, 'Expected tier 3 to be called again after verification rejected the embedding stage\'s wrong pick.');
  }

  // 5: `verifyBeforeTeaching` (default true) must refuse to teach a GENERIC phrase that doesn't
  // clearly and uniquely point to one target - the real cascading bug found via live testing
  // (docs/known-limitations.md): tier 3 resolved a vague phrase ("app collections workspace")
  // to ONE dashboard tile among several, and teaching it verbatim turned that phrase into a
  // magnet that wrongly captured later, unrelated questions about the OTHER tiles too. A fake
  // verifyFn here mimics a genuinely ambiguous phrase (near-equal score against both siblings)
  // and the teach must be refused, so a later unrelated question is never wrongly captured.
  {
    const snapshot = snapshotWith([['output', 'tileCollected'], ['output', 'tileDue']]);
    snapshot.nodes[0].label = 'Collected';
    snapshot.nodes[1].label = 'Due';

    let embeddingCallCount = 0;
    const embeddingCore = { async infer() { embeddingCallCount += 1; return { meta: { endpoint: '', provider: 'fake', authMode: 'none', timeoutMs: 0, reason: 'unknown_intent', latencyMs: 1, normalized: false, used: false } }; } };

    const { core: inner, getCallCount: innerCalls } = fakeInnerCore({
      'app collections workspace': { intent: 'show_output', target: 'tileCollected', confidence: 0.6, source: 'cloud' },
      'what about the due one': { intent: 'show_output', target: 'tileDue', confidence: 0.75, source: 'cloud' },
    });

    // Genuinely ambiguous: scores both siblings almost identically for the vague phrase - too
    // close to safely teach either way.
    const verifyFn = async (input, candidateText) => {
      if (input === 'app collections workspace') return candidateText === 'Collected' ? 1.0 : 0.95;
      if (input === 'what about the due one') return candidateText === 'Due' ? 5 : -5;
      return 0;
    };

    const learning = createAliasLearningLlmCore(inner, { storageKey: false, embeddingCore, verifyFn });

    await learning.infer('app collections workspace', localIntentFor('app collections workspace'), snapshot, config);
    assert(innerCalls() === 1, 'Expected the vague phrase to still be answered by tier 3 this one time.');

    // Nothing should have been taught - a later, unrelated question about the OTHER tile must
    // not be magnetized toward 'tileCollected' and must resolve correctly via tier 3.
    const second = await learning.infer('what about the due one', localIntentFor('what about the due one'), snapshot, config);
    assert(second?.intent?.target === 'tileDue', `Expected the unrelated question to resolve correctly via tier 3, got "${second?.intent?.target}" - a bad teach would wrongly pull this toward 'tileCollected'.`);
    assert(innerCalls() === 2, 'Expected tier 3 to be asked for the second question too - the vague phrase must never have been taught.');
  }

  console.log('All alias learning validations passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
