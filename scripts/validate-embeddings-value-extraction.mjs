// Coverage for @cinder/embeddings' value-extraction stage (valueExtraction.ts +
// qaValueExtraction.ts): recovers set_field/set_filter commands that have a filler word
// before the verb ("could you please set X to Y"), which core's matchSetValuePlanner /
// matchFilterByValuePlanner can't - both require the verb as the sentence's literal first
// word. Downloads real models on first run - same reasoning as validate-embeddings.mjs,
// not part of the fast CI chain.
import { JSDOM } from 'jsdom';
import { CinderSemanticRuntime, classifyRunResult } from '../packages/cinder/dist/index.js';
import { createEmbeddingLlmCore, resetEmbedderForTests, resetRerankerForTests, resetQaPipelineForTests } from '../packages/cinder-embeddings/dist/index.js';

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
  globalThis.CSS = dom.window.CSS ?? {
    escape(value) {
      return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    },
  };
}

function createMarkup() {
  return `
    <main>
      <select cinder-filter="loan-status" aria-label="Status">
        <option>Active</option>
        <option>Overdue</option>
        <option>Closed</option>
      </select>
      <input cinder-field="shipping-address" aria-label="Shipping address" />
      <input cinder-field="customer-search" aria-label="Search customers" />
      <select cinder-filter="who-filling" aria-label="Who is filling it in">
        <option>Self-serve and staff</option>
        <option>Self-serve only</option>
        <option>Staff only</option>
      </select>
    </main>
  `;
}

async function main() {
  const dom = new JSDOM(createMarkup(), { url: 'http://localhost/' });
  installDomGlobals(dom);

  resetEmbedderForTests();
  resetRerankerForTests();
  resetQaPipelineForTests();

  const runtime = new CinderSemanticRuntime();
  await runtime.init({
    semantic: { scanOnInit: false, observeMutations: false },
    ai: { enabled: true, mode: 'local', endpoint: '', apiKey: '' },
  });
  await runtime.scan(dom.window.document);
  runtime.setLlmCore(createEmbeddingLlmCore({ enableTiebreaker: true }), { requiresNetwork: false });

  // 1. Filler-prefixed "set X to Y" - exactly what tier 1 alone scores 0% on.
  const setFiller = await runtime.run('could you please update the loan status over to overdue for me', dom.window.document);
  assert(setFiller.intent.intent === 'set_filter', `Expected filler-prefixed set command to resolve, got "${setFiller.intent.intent}".`);
  assert(setFiller.intent.target === 'loan-status' && setFiller.intent.value === 'Overdue', 'Expected the correct filter and the real option label.');
  assert(setFiller.intent.confidence < 0.85, 'Expected resolved_fuzzy, not resolved_exact - this is a best-guess tier, never full certainty.');

  // 2. Filler-prefixed free-text field (no enumerated options).
  const fieldFiller = await runtime.run('please go ahead and set my shipping address to 221b baker street', dom.window.document);
  assert(fieldFiller.intent.intent === 'set_field' && fieldFiller.intent.target === 'shipping-address' && fieldFiller.intent.value === '221b baker street', 'Expected the free-text field to be set correctly.');

  // 3. Filler-prefixed "filter by X" (value-only, no field named).
  const filterByFiller = await runtime.run('can you filter this by closed', dom.window.document);
  assert(filterByFiller.intent.intent === 'set_filter' && filterByFiller.intent.target === 'loan-status' && filterByFiller.intent.value === 'Closed', 'Expected "filter this by closed" to resolve via the value-only shape.');

  // 4. A value/field combination that doesn't exist on the page must fail cleanly, not
  // guess at the nearest-sounding real field (the QA model's known weak spot - see
  // qaValueExtraction.ts's doc comment - is exactly this: confidently pointing at a real
  // span for a question that doesn't actually apply).
  const noMatch = await runtime.run('change the priority level to extremely high immediately', dom.window.document);
  assert(noMatch.intent.intent === 'unknown', `Expected a field that doesn't exist on the page to fail to resolve, got "${noMatch.intent.intent}".`);

  // 5. An unrelated distractor sentence that happens to contain "to" must not false-positive.
  const distractor = await runtime.run('hey, I want to go to the store later', dom.window.document);
  assert(distractor.intent.intent === 'unknown', 'Expected an unrelated sentence to stay unresolved.');

  // 6. Exact tier-1 grammar (verb first) must still work unchanged - this is additive, not a
  // replacement for the fast, zero-model path.
  const exact = await runtime.run('set status to active', dom.window.document);
  assert(exact.intent.intent === 'set_filter' && exact.intent.source === 'local', 'Expected exact tier-1 grammar to still resolve locally, without ever reaching tier 2.');

  // 7. Filler-prefixed search command - found missing entirely in an earlier version of this
  // feature (a real live-browser test caught it: this shape had no handling at all).
  const searchFiller = await runtime.run('could you search for ramesh kumar please', dom.window.document);
  assert(searchFiller.intent.intent === 'set_field' && searchFiller.intent.target === 'customer-search' && searchFiller.intent.value === 'ramesh kumar', 'Expected a filler-prefixed search command to resolve to the real search field.');

  // 8. A value phrase with a generic trailing noun the option itself doesn't have ("overdue
  // LOANS" vs. the option "Overdue") - found missing via a real live-browser test.
  const genericNoun = await runtime.run('could you please filter this list by overdue loans', dom.window.document);
  assert(genericNoun.intent.intent === 'set_filter' && genericNoun.intent.target === 'loan-status' && genericNoun.intent.value === 'Overdue', 'Expected "filter by overdue loans" to match the real option "Overdue".');

  // 9. Reduced-passive / past-participle phrasing ("I need X changed to Y", "have X updated
  // to Y") - the field precedes the verb here, the opposite order from every other shape.
  // compromise.js tags a TRUE passive ("has been changed") reliably but not this reduced
  // form (tags it plain past tense) - this is matched directly, not via compromise's tags.
  const reducedPassive = await runtime.run('I need the status changed to closed, could you do that', dom.window.document);
  assert(reducedPassive.intent.intent === 'set_filter' && reducedPassive.intent.target === 'loan-status' && reducedPassive.intent.value === 'Closed', 'Expected reduced-passive phrasing to resolve correctly.');

  // 10. Two different real options sharing a text prefix ("Self-serve and staff" / "Self-serve
  // only") must not make the generic-trailing-noun or substring matching collide between them -
  // an exact match to one specific option must still win cleanly.
  const sharedPrefix = await runtime.run('please set who is filling it in to staff only', dom.window.document);
  assert(sharedPrefix.intent.intent === 'set_filter' && sharedPrefix.intent.target === 'who-filling' && sharedPrefix.intent.value === 'Staff only', 'Expected an exact option match to win over its shared-prefix sibling.');

  // 11. A sentence with NO structural signal at all (no "to", no filter/search/set keyword)
  // must never even reach the QA model - found as a real false positive without this gate:
  // "hey, what time is it" was confidently (and wrongly) matched to the search field.
  const noSignal = await runtime.run('hey, what time is it', dom.window.document);
  assert(noSignal.intent.intent === 'unknown', `Expected a sentence with no command-like signal to stay unresolved, got target "${noSignal.intent.target}".`);

  // 12. The QA model found the right FIELD but fabricated a value that isn't a real option -
  // found via a real adversarial multi-candidate test: asked "What is Status set to?" against
  // a sentence with no real status value in it at all, it still confidently answered with
  // whatever text was nearby ("nobody"). Must decline, never pass through an unvalidated value.
  const qaFabricatedValue = await runtime.run('show me the ones assigned to nobody', dom.window.document);
  assert(qaFabricatedValue.intent.intent === 'unknown', `Expected a fabricated, non-real-option value to be declined, got target "${qaFabricatedValue.intent.target}" value "${qaFabricatedValue.intent.value}".`);

  runtime.destroy();

  console.log(JSON.stringify({
    ok: true,
    summary: {
      fillerPrefixedSetFilter: { target: setFiller.intent.target, value: setFiller.intent.value, confidence: setFiller.intent.confidence },
      fillerPrefixedSetField: { target: fieldFiller.intent.target, value: fieldFiller.intent.value },
      fillerPrefixedFilterByValue: { target: filterByFiller.intent.target, value: filterByFiller.intent.value },
      nonExistentFieldOutcome: noMatch.intent.intent,
      distractorOutcome: distractor.intent.intent,
      exactGrammarStillLocal: exact.intent.source,
      fillerPrefixedSearch: { target: searchFiller.intent.target, value: searchFiller.intent.value },
      genericTrailingNounMatch: { target: genericNoun.intent.target, value: genericNoun.intent.value },
      reducedPassiveMatch: { target: reducedPassive.intent.target, value: reducedPassive.intent.value },
      sharedPrefixDisambiguation: sharedPrefix.intent.value,
      noSignalOutcome: noSignal.intent.intent,
      qaFabricatedValueOutcome: qaFabricatedValue.intent.intent,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-embeddings-value-extraction] failed:', error);
  process.exitCode = 1;
});
