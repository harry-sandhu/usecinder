// Coverage for createSemanticCachingLlmCore (packages/cinder-embeddings/src/semanticCache.ts) -
// the "tier 3 teaches tier 1/2" feature: once any inner CinderLlmCore (tier 2's embedding core,
// a real tier-3 cloud core, or a chain of both) resolves an input, a future input that embeds
// close enough to it, against the SAME graph state, is served from the cache instead of calling
// the inner core again. Uses a fake, deterministic bag-of-words embedder injected via
// `embedFn` - no real model download, no network - consistent with keeping this in the fast CI
// loop (unlike validate:embeddings, which intentionally downloads a real model and is excluded).
import { createSemanticCachingLlmCore } from '../packages/cinder-embeddings/dist/index.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// A tiny fake embedder: bag-of-words presence vector over a FIXED vocabulary (every word used
// across a scenario's test inputs, known upfront), L2-normalized. Fixed-length vectors avoid
// any positional-comparison mismatch in the module's cosine similarity. Paraphrases sharing
// most words land close to 1; unrelated sentences land close to 0. Deterministic and
// network-free, standing in for the real @cinder/embeddings model.
function createFakeEmbedder(vocabWords) {
  const vocab = new Map(vocabWords.map((word, index) => [word, index]));

  return async function embed(text) {
    const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    const vec = new Float32Array(vocab.size);

    for (const word of words) {
      const index = vocab.get(word);

      if (index !== undefined) {
        vec[index] = 1;
      }
    }

    let magnitude = 0;
    for (let index = 0; index < vec.length; index += 1) {
      magnitude += vec[index] * vec[index];
    }
    magnitude = Math.sqrt(magnitude) || 1;

    for (let index = 0; index < vec.length; index += 1) {
      vec[index] /= magnitude;
    }

    return vec;
  };
}

function vocabFrom(sentences) {
  const words = new Set();

  for (const sentence of sentences) {
    for (const word of sentence.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      words.add(word);
    }
  }

  return Array.from(words);
}

function snapshotWith(nodeIds) {
  return { nodes: nodeIds.map((id) => ({ id, type: 'route', key: id })) };
}

function localIntentFor(input) {
  return {
    intent: 'unknown',
    confidence: 0.1,
    source: 'local',
    normalizedInput: { raw: input, tokens: input.split(' ') },
  };
}

function fakeInnerCore(responses) {
  let callCount = 0;

  const core = {
    async infer(input) {
      callCount += 1;
      const response = responses[input];

      if (!response) {
        return { meta: { endpoint: '', provider: 'fake', authMode: 'none', timeoutMs: 0, reason: 'unknown_intent', latencyMs: 1, normalized: false, used: false } };
      }

      return {
        intent: { ...response, normalizedInput: { raw: input, tokens: input.split(' ') } },
        meta: { endpoint: '', provider: 'fake', authMode: 'none', timeoutMs: 0, reason: 'unknown_intent', latencyMs: 1, normalized: true, used: true },
      };
    },
  };

  return { core, getCallCount: () => callCount };
}

const config = {};

async function main() {
  const snapshotA = snapshotWith(['loans-overdue', 'loans-active', 'dashboard']);
  const snapshotB = snapshotWith(['loans-overdue', 'loans-active', 'dashboard', 'leads-all']);

  // 1 + 2: a cache miss followed by a near-paraphrase hit against the same graph state.
  {
    const embedFn = createFakeEmbedder(vocabFrom(['open the overdue loans page', 'could you open overdue loans page']));
    const { core, getCallCount } = fakeInnerCore({
      'open the overdue loans page': { intent: 'navigate', target: 'loans-overdue', confidence: 0.8, source: 'embedding', matchedNodeIds: ['loans-overdue'] },
    });
    const cached = createSemanticCachingLlmCore(core, { storageKey: false, embedFn, similarityThreshold: 0.6, verify: false });

    const first = await cached.infer('open the overdue loans page', localIntentFor('open the overdue loans page'), snapshotA, config);
    assert(first?.intent?.target === 'loans-overdue' && first.intent.source === 'embedding', 'Expected the first call to pass through to the inner core untouched.');
    assert(getCallCount() === 1, 'Expected the inner core to be called exactly once on a cache miss.');

    const second = await cached.infer('could you open overdue loans page', localIntentFor('could you open overdue loans page'), snapshotA, config);
    assert(second?.intent?.target === 'loans-overdue', 'Expected the paraphrase to resolve to the same target via cache.');
    assert(second?.intent?.source === 'cache', 'Expected a cache hit to be tagged with source "cache".');
    assert(getCallCount() === 1, 'Expected the inner core NOT to be called again on a cache hit.');
    assert(second?.intent?.reason?.includes('semantic cache'), 'Expected the cache-hit reason to say it was served from cache.');
  }

  // 3: an unrelated input against the same graph must NOT hit the cache.
  {
    const embedFn = createFakeEmbedder(vocabFrom(['open the overdue loans page', 'export this report as csv']));
    const { core, getCallCount } = fakeInnerCore({
      'open the overdue loans page': { intent: 'navigate', target: 'loans-overdue', confidence: 0.8, source: 'embedding', matchedNodeIds: ['loans-overdue'] },
      'export this report as csv': { intent: 'trigger_action', target: 'export-csv', confidence: 0.75, source: 'embedding', matchedNodeIds: ['export-csv'] },
    });
    const cached = createSemanticCachingLlmCore(core, { storageKey: false, embedFn, similarityThreshold: 0.6, verify: false });

    await cached.infer('open the overdue loans page', localIntentFor('open the overdue loans page'), snapshotA, config);
    const unrelated = await cached.infer('export this report as csv', localIntentFor('export this report as csv'), snapshotA, config);
    assert(unrelated?.intent?.target === 'export-csv', 'Expected an unrelated input to resolve via the inner core, not a stale cache hit.');
    assert(unrelated?.intent?.source !== 'cache', 'Expected an unrelated input not to be served from cache.');
    assert(getCallCount() === 2, 'Expected the inner core to be called for both unrelated inputs.');
  }

  // 4: the exact same paraphrase against a DIFFERENT graph state must not reuse the first graph's entry.
  {
    const embedFn = createFakeEmbedder(vocabFrom(['open the overdue loans page']));
    const { core, getCallCount } = fakeInnerCore({
      'open the overdue loans page': { intent: 'navigate', target: 'loans-overdue', confidence: 0.8, source: 'embedding', matchedNodeIds: ['loans-overdue'] },
    });
    const cached = createSemanticCachingLlmCore(core, { storageKey: false, embedFn, similarityThreshold: 0.6, verify: false });

    await cached.infer('open the overdue loans page', localIntentFor('open the overdue loans page'), snapshotA, config);
    await cached.infer('open the overdue loans page', localIntentFor('open the overdue loans page'), snapshotB, config);
    assert(getCallCount() === 2, 'Expected a different graph signature to bypass the cache entirely, even for an identical input.');
  }

  // 5: when the inner core honestly declines (no intent), nothing should be cached.
  {
    const embedFn = createFakeEmbedder(vocabFrom(['can you save for me']));
    const { core, getCallCount } = fakeInnerCore({});
    const cached = createSemanticCachingLlmCore(core, { storageKey: false, embedFn, similarityThreshold: 0.6, verify: false });

    const first = await cached.infer('can you save for me', localIntentFor('can you save for me'), snapshotA, config);
    assert(!first?.intent, 'Expected an honest decline to have no intent.');
    const second = await cached.infer('can you save for me', localIntentFor('can you save for me'), snapshotA, config);
    assert(!second?.intent, 'Expected a repeated decline to still have no intent.');
    assert(getCallCount() === 2, 'Expected a decline never to be cached - the inner core must be asked again.');
  }

  // 6: LRU eviction - with a cap of 2, a third distinct entry evicts the oldest.
  {
    const embedFn = createFakeEmbedder(vocabFrom(['alpha one two three', 'bravo four five six', 'charlie seven eight nine']));
    const { core, getCallCount } = fakeInnerCore({
      'alpha one two three': { intent: 'navigate', target: 'alpha', confidence: 0.8, source: 'embedding' },
      'bravo four five six': { intent: 'navigate', target: 'bravo', confidence: 0.8, source: 'embedding' },
      'charlie seven eight nine': { intent: 'navigate', target: 'charlie', confidence: 0.8, source: 'embedding' },
    });
    const cached = createSemanticCachingLlmCore(core, { storageKey: false, embedFn, similarityThreshold: 0.99, maxEntries: 2, verify: false });

    await cached.infer('alpha one two three', localIntentFor('alpha one two three'), snapshotA, config);
    await cached.infer('bravo four five six', localIntentFor('bravo four five six'), snapshotA, config);
    await cached.infer('charlie seven eight nine', localIntentFor('charlie seven eight nine'), snapshotA, config);
    assert(getCallCount() === 3, 'Expected all three distinct inputs to miss the cache and reach the inner core.');

    // "alpha" should have been evicted (oldest) - asking for it again must call the inner core.
    const replay = await cached.infer('alpha one two three', localIntentFor('alpha one two three'), snapshotA, config);
    assert(replay?.intent?.target === 'alpha', 'Expected the evicted entry to still resolve correctly via the inner core.');
    assert(getCallCount() === 4, 'Expected the evicted entry to miss the cache and call the inner core again.');
  }

  // 7: a near-tie between two cached entries for DIFFERENT targets must decline the cache
  // (call the inner core again) rather than confidently returning whichever happens to sort
  // first - found via real testing against real app data (docs/known-limitations.md): a
  // general-purpose sentence embedding can score two short phrases that differ only by one
  // closed-class word (e.g. "...on reflex" vs "...off reflex") almost identically, so a lone
  // top-score check is not safe. Constructed here so both cached entries score EXACTLY the
  // same against the query (gap = 0), which must fall below any minScoreGap > 0.
  {
    const embedFn = createFakeEmbedder(vocabFrom(['red apple fruit snack', 'blue car vehicle transport', 'green orange fruit transport']));
    const { core, getCallCount } = fakeInnerCore({
      'red apple fruit snack': { intent: 'navigate', target: 'fruit-page', confidence: 0.8, source: 'embedding' },
      'blue car vehicle transport': { intent: 'navigate', target: 'transport-page', confidence: 0.8, source: 'embedding' },
      'green orange fruit transport': { intent: 'navigate', target: 'mixed-page', confidence: 0.8, source: 'embedding' },
    });
    // Deliberately low threshold: the two seed entries share zero words with each other (safe to
    // populate independently), but the third query shares exactly one word with EACH of them,
    // producing an identical (tied) similarity score against both - the scenario to test.
    const cached = createSemanticCachingLlmCore(core, { storageKey: false, embedFn, similarityThreshold: 0.2, verify: false });

    await cached.infer('red apple fruit snack', localIntentFor('red apple fruit snack'), snapshotA, config);
    await cached.infer('blue car vehicle transport', localIntentFor('blue car vehicle transport'), snapshotA, config);
    assert(getCallCount() === 2, 'Expected both distinct entries to miss the cache and populate it.');

    const tied = await cached.infer('green orange fruit transport', localIntentFor('green orange fruit transport'), snapshotA, config);
    assert(tied?.intent?.target === 'mixed-page', 'Expected the tied query to fall through to the inner core rather than reuse either tied cache entry.');
    assert(tied?.intent?.source !== 'cache', 'Expected a genuine near-tie between two different-target cache entries not to be served from cache.');
    assert(getCallCount() === 3, 'Expected the near-tie to call the inner core instead of guessing.');
  }

  // 8: the cross-encoder verification pass (`verify`, default true) catches a case the
  // embedding stage alone gets confidently WRONG - the real failure mode found via live
  // testing (docs/known-limitations.md): a fake embedder is rigged to score the WRONG cached
  // entry ("widget off panel") higher than the correct one ("widget on panel") for the query
  // "widget on panel switch", clearing both `similarityThreshold` and `minScoreGap` - exactly
  // the real "on reflex"/"off reflex" bug. A fake cross-encoder that correctly reads "on" vs
  // "off" must override the embedding stage's wrong pick and fall through to the inner core.
  {
    const vectors = {
      'widget on panel': [1, 0],
      'widget off panel': [0.9, 0.5],
      'widget on panel switch': [0.95, 0.45],
    };
    const embedFn = async (text) => new Float32Array(vectors[text] ?? [0, 0]);
    const verifyFn = async (input, candidateText) => {
      if (input !== 'widget on panel switch') return 0;
      if (candidateText === 'widget on panel') return 5;
      if (candidateText === 'widget off panel') return -5;
      return 0;
    };
    const { core, getCallCount } = fakeInnerCore({
      'widget on panel': { intent: 'navigate', target: 'panel-on', confidence: 0.8, source: 'embedding' },
      'widget off panel': { intent: 'navigate', target: 'panel-off', confidence: 0.8, source: 'embedding' },
      'widget on panel switch': { intent: 'navigate', target: 'panel-on', confidence: 0.8, source: 'embedding' },
    });
    const cached = createSemanticCachingLlmCore(core, { storageKey: false, embedFn, verifyFn, similarityThreshold: 0.9, minScoreGap: 0.05 });

    await cached.infer('widget on panel', localIntentFor('widget on panel'), snapshotA, config);
    await cached.infer('widget off panel', localIntentFor('widget off panel'), snapshotA, config);
    assert(getCallCount() === 2, 'Expected both seed entries to populate the cache.');

    // Confirm the embedding stage really would pick the wrong entry on its own (sanity check
    // on the rigged vectors), then confirm `verify` catches it.
    const dotWrong = 0.95 * 0.9 + 0.45 * 0.5;
    const dotRight = 0.95 * 1 + 0.45 * 0;
    assert(dotWrong > dotRight, 'Expected the rigged embeddings to favor the wrong entry, to actually exercise the verification override.');

    const result = await cached.infer('widget on panel switch', localIntentFor('widget on panel switch'), snapshotA, config);
    assert(result?.intent?.target === 'panel-on', 'Expected cross-encoder verification to override the embedding stage\'s wrong pick and fall through to the correct inner-core answer.');
    assert(result?.intent?.source !== 'cache', 'Expected the overridden case to NOT be served from cache (the embedding-approved entry was rejected).');
    assert(getCallCount() === 3, 'Expected the inner core to be called after verification rejected the embedding stage\'s pick.');
  }

  console.log('All semantic cache validations passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
