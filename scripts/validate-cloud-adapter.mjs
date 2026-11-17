// Coverage for the real tier-3 cloud adapter (packages/server/src/adapters/cloudAdapter.ts +
// cloud/promptBuilder.ts + cloud/responseParser.ts), which replaces heuristicAdapter.ts (a
// fake adapter hardcoded for one crop-pricing demo, never a real model). Uses a test-double
// CompletionProvider throughout - no real network call, no API key needed, consistent with
// "build + unit-test the adapter logic only" for now. See docs/local-engine-fully-fledged-plan.md
// for why a real tier-3 adapter was the single most important remaining gap.
import {
  createCloudAdapter,
  createAdapter,
  CompletionProviderError,
} from '../packages/server/dist/adapters/index.js';
import { resolveServerConfig } from '../packages/server/dist/core/config.js';
import { normalizeInferIntentResponse } from '../packages/shared/dist/index.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function fakeProvider(name, completeFn) {
  return { name, complete: completeFn };
}

const sampleRequest = {
  text: 'open the overdue loans page',
  graph: {
    activeRoute: 'dashboard',
    routes: ['dashboard', 'loans-overdue', 'loans-active', 'leads-all'],
    actions: ['refresh-data', 'export-csv'],
    fields: ['lead-search'],
    filters: ['loan-status'],
    outputs: ['outstanding-balance'],
  },
  app: { name: 'Test App', version: '1.0.0' },
};

async function main() {
  // 1. A well-formed grounded navigate response - the normal case.
  const navigateProvider = fakeProvider('fake-a', async () =>
    JSON.stringify({ intent: 'navigate', target: 'loans-overdue', confidence: 0.91 }),
  );
  const navigateResult = await createCloudAdapter(navigateProvider).infer(sampleRequest);
  assert(navigateResult.intent === 'navigate' && navigateResult.target === 'loans-overdue', 'Expected a clean navigate response to parse correctly.');
  assert(normalizeInferIntentResponse(navigateResult), 'Expected the response to pass the shared normalizer the real server/client both use.');

  // 2. set_filter with a value - value must land in entities.value, not a top-level field
  // (InferIntentResponse has no such field; the client's own reader only checks entities/context).
  const setFilterProvider = fakeProvider('fake-b', async () =>
    JSON.stringify({ intent: 'set_filter', target: 'loan-status', entities: { value: 'Overdue' }, confidence: 0.85 }),
  );
  const setFilterResult = await createCloudAdapter(setFilterProvider).infer(sampleRequest);
  assert(setFilterResult.intent === 'set_filter' && setFilterResult.target === 'loan-status' && setFilterResult.entities?.value === 'Overdue', 'Expected set_filter value to land in entities.value.');

  // 3. A composite_flow with multiple steps.
  const compositeProvider = fakeProvider('fake-c', async () =>
    JSON.stringify({
      intent: 'composite_flow',
      confidence: 0.8,
      steps: [
        { type: 'set_filter', target: 'loan-status', value: 'Overdue' },
        { type: 'navigate', target: 'loans-overdue' },
      ],
    }),
  );
  const compositeResult = await createCloudAdapter(compositeProvider).infer(sampleRequest);
  assert(compositeResult.intent === 'composite_flow' && Array.isArray(compositeResult.steps) && compositeResult.steps.length === 2, 'Expected a composite_flow response with its steps intact.');

  // 4. Malformed/non-JSON text must be an honest miss, never a crash or a guessed intent.
  const garbageProvider = fakeProvider('fake-d', async () => 'Sorry, I cannot help with that right now.');
  const garbageResult = await createCloudAdapter(garbageProvider).infer(sampleRequest);
  assert(garbageResult.intent === null && garbageResult.confidence === 0, 'Expected unparseable model output to be an honest miss, not a crash.');

  // 5. JSON wrapped in a markdown fence plus surrounding prose - models say they'll skip
  // this but don't always; the parser has to cope anyway.
  const fencedProvider = fakeProvider('fake-e', async () =>
    'Sure, here you go:\n```json\n{"intent": "trigger_action", "target": "refresh-data", "confidence": 0.7}\n```\nLet me know if that helps!',
  );
  const fencedResult = await createCloudAdapter(fencedProvider).infer(sampleRequest);
  assert(fencedResult.intent === 'trigger_action' && fencedResult.target === 'refresh-data', 'Expected JSON wrapped in prose/markdown to still be extracted correctly.');

  // 6. The model explicitly declining (the prompt's own instructed behavior when nothing in
  // the real candidate lists fits) must pass through as an honest miss.
  const declineProvider = fakeProvider('fake-f', async () => JSON.stringify({ intent: null, confidence: 0 }));
  const declineResult = await createCloudAdapter(declineProvider).infer(sampleRequest);
  assert(declineResult.intent === null, 'Expected an explicit model decline to pass through as intent: null.');

  // 7. A provider failure (network/API error) must propagate as a real error, not get
  // silently swallowed into a false "the model found nothing" result - those are different
  // situations and the caller (the server route) needs to tell them apart.
  const failingProvider = fakeProvider('fake-g', async () => {
    throw new CompletionProviderError('simulated network failure', 'fake-g');
  });
  let threw = false;
  try {
    await createCloudAdapter(failingProvider).infer(sampleRequest);
  } catch (error) {
    threw = error instanceof CompletionProviderError;
  }
  assert(threw, 'Expected a provider failure to propagate as a real error, not an honest-miss response.');

  // 8. Provider-agnostic by construction: two differently-named fake providers both work
  // through the exact same adapter logic - proves the abstraction, not just one happy path.
  const providerNamesSeen = [];
  for (const name of ['anthropic-shaped', 'openai-shaped']) {
    const provider = fakeProvider(name, async () => {
      providerNamesSeen.push(name);
      return JSON.stringify({ intent: 'navigate', target: 'dashboard', confidence: 0.6 });
    });
    const result = await createCloudAdapter(provider).infer(sampleRequest);
    assert(result.intent === 'navigate' && result.target === 'dashboard', `Expected provider "${name}" to work identically through the same adapter.`);
  }
  assert(providerNamesSeen.length === 2, 'Expected both differently-named providers to actually be invoked.');

  // 9. Config: requesting a real provider with no API key must fail fast and clearly at
  // startup, never silently fall back to the fake heuristic adapter (that would be a much
  // more confusing failure mode to debug than an immediate, explicit error).
  let configThrew = false;
  try {
    createAdapter(resolveServerConfig({ provider: 'anthropic', providerApiKey: '' }));
  } catch (error) {
    configThrew = error instanceof Error && error.message.includes('anthropic');
  }
  assert(configThrew, 'Expected requesting the anthropic provider with no API key to fail fast with a clear error.');

  // 10. The heuristic adapter must still work unchanged (not removed, still the safe default
  // when no provider is configured at all).
  const heuristicAdapter = createAdapter(resolveServerConfig({ provider: 'heuristic' }));
  const heuristicResult = await heuristicAdapter.infer({ text: 'open dashboard', graph: { routes: ['dashboard'] } });
  assert(heuristicResult.source === 'cloud', 'Expected the heuristic adapter to still work as the default fallback.');

  // 11. graph.nodeDetails (real labels + page-section breadcrumbs) must actually reach the
  // prompt text, and in a way that lets a model disambiguate what bare keys alone could not -
  // the real case found via live testing (docs/known-limitations.md): "dashboard-tile-
  // disbursed-count" vs. "dashboard-tile-disbursed-amount" are indistinguishable by key alone,
  // but their real labels ("Loans disbursed: open the list" vs. "Amount disbursed: open the
  // list") make it obvious. This fake provider answers purely by reading the prompt text it
  // was actually given, standing in for what a real model would do with the same information.
  const disbursedRequest = {
    text: 'show me the amount disbursed',
    graph: {
      activeRoute: 'dashboard',
      outputs: ['dashboard-tile-disbursed-count', 'dashboard-tile-disbursed-amount'],
      nodeDetails: [
        { key: 'dashboard-tile-disbursed-count', type: 'output', label: 'Loans disbursed: open the list', routeKey: 'dashboard', contextPath: ['dashboard-summary'] },
        { key: 'dashboard-tile-disbursed-amount', type: 'output', label: 'Amount disbursed: open the list', routeKey: 'dashboard', contextPath: ['dashboard-summary'] },
      ],
    },
    app: { name: 'Test App' },
  };
  let promptSeenByFakeModel = '';
  const disbursedProvider = fakeProvider('fake-labels', async ({ user }) => {
    promptSeenByFakeModel = user;
    // Answers purely from the real labels visible in the prompt, not from any hardcoded key
    // knowledge - proving the disambiguating text actually arrived, not just assuming it did.
    const target = user.includes('"Amount disbursed: open the list"') ? 'dashboard-tile-disbursed-amount' : 'dashboard-tile-disbursed-count';
    return JSON.stringify({ intent: 'show_output', target, confidence: 0.9 });
  });
  const disbursedResult = await createCloudAdapter(disbursedProvider).infer(disbursedRequest);
  assert(promptSeenByFakeModel.includes('dashboard-tile-disbursed-count') && promptSeenByFakeModel.includes('Loans disbursed: open the list'), 'Expected the rich prompt to include both candidates\' real keys and labels.');
  assert(promptSeenByFakeModel.includes('page: dashboard') && promptSeenByFakeModel.includes('section: dashboard-summary'), 'Expected the rich prompt to include page/section context from nodeDetails.');
  assert(disbursedResult.target === 'dashboard-tile-disbursed-amount', `Expected the real-label-aware prompt to resolve to the correct tile, got "${disbursedResult.target}".`);

  // 12. Without nodeDetails, the prompt must fall back to the original bare-key-list format
  // unchanged - older clients that don't send the richer shape must keep working exactly as
  // before.
  let fallbackPromptSeen = '';
  const fallbackProvider = fakeProvider('fake-fallback', async ({ user }) => {
    fallbackPromptSeen = user;
    return JSON.stringify({ intent: 'navigate', target: 'loans-overdue', confidence: 0.9 });
  });
  await createCloudAdapter(fallbackProvider).infer(sampleRequest);
  assert(fallbackPromptSeen.includes('Real candidate keys available right now'), 'Expected the original bare-key-list heading to still be used when nodeDetails is absent.');
  assert(!fallbackPromptSeen.includes('page:') && !fallbackPromptSeen.includes('section:'), 'Expected no page/section annotations when nodeDetails was never sent.');

  // 13. navigatesTo (docs/known-limitations.md #2's new navigates_to edge) must also reach the
  // prompt text - tells the model what an action actually DOES, not just its bare label, which
  // disambiguates two similarly-worded actions that lead to different places.
  const navigatesToRequest = {
    text: 'open the loan detail page',
    graph: {
      activeRoute: 'loans-list',
      actions: ['view-loan-detail', 'view-loan-history'],
      nodeDetails: [
        { key: 'view-loan-detail', type: 'action', label: 'View', routeKey: 'loans-list', navigatesTo: 'loan-detail' },
        { key: 'view-loan-history', type: 'action', label: 'View', routeKey: 'loans-list', navigatesTo: 'loan-history' },
      ],
    },
    app: { name: 'Test App' },
  };
  let navigatesToPromptSeen = '';
  const navigatesToProvider = fakeProvider('fake-navigates-to', async ({ user }) => {
    navigatesToPromptSeen = user;
    const target = user.includes('navigates to: loan-detail') ? 'view-loan-detail' : 'view-loan-history';
    return JSON.stringify({ intent: 'trigger_action', target, confidence: 0.85 });
  });
  const navigatesToResult = await createCloudAdapter(navigatesToProvider).infer(navigatesToRequest);
  assert(navigatesToPromptSeen.includes('navigates to: loan-detail') && navigatesToPromptSeen.includes('navigates to: loan-history'), 'Expected the rich prompt to include each action\'s real navigates_to target.');
  assert(navigatesToResult.target === 'view-loan-detail', `Expected the navigatesTo-aware prompt to resolve to the correct action, got "${navigatesToResult.target}".`);

  // 14. A provider returning the richer { text, usage } shape (real token counts, needed for
  // @cinder/relay's cost metering) must flow through identically to a provider returning a
  // bare string - this is an additive widening of CompletionProvider's contract, not a
  // breaking change, and every existing fake provider above (returning bare strings) proves
  // the old shape still works unchanged.
  const usageProvider = fakeProvider('fake-usage', async () => ({
    text: JSON.stringify({ intent: 'navigate', target: 'loans-overdue', confidence: 0.9 }),
    usage: { inputTokens: 123, outputTokens: 45 },
  }));
  const usageResult = await createCloudAdapter(usageProvider).infer(sampleRequest);
  assert(usageResult.target === 'loans-overdue', 'Expected a provider returning the richer {text, usage} shape to still resolve correctly.');

  console.log(JSON.stringify({
    ok: true,
    summary: {
      navigateResolved: navigateResult.target,
      setFilterValue: setFilterResult.entities?.value,
      compositeStepCount: compositeResult.steps?.length,
      garbageHandledAsHonestMiss: garbageResult.intent === null,
      fencedJsonExtracted: fencedResult.target,
      explicitDeclinePassedThrough: declineResult.intent === null,
      providerFailurePropagated: threw,
      bothFakeProvidersWorked: providerNamesSeen,
      missingApiKeyFailsFast: configThrew,
      heuristicStillWorks: heuristicResult.intent,
      richPromptDisambiguatedCorrectly: disbursedResult.target,
      fallbackPromptUnchangedWithoutNodeDetails: fallbackPromptSeen.includes('Real candidate keys available right now'),
      navigatesToDisambiguatedCorrectly: navigatesToResult.target,
      richCompletionResultShapeWorked: usageResult.target,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-cloud-adapter] failed:', error);
  process.exitCode = 1;
});
