// Systematic coverage for narrow reference carryover (core/cie/referenceCarryover.ts) - NOT
// general anaphora resolution. See the module's own doc comment and
// docs/local-engine-fully-fledged-plan.md §11 for why this is deliberately scoped to "one
// step back, a fixed set of reference words" rather than a general pronoun-resolution system
// (every credible source on that problem shows rule-based approaches losing to trained
// models - this is the narrow slice that's safely buildable zero-dependency).
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
  globalThis.HTMLInputElement = dom.window.HTMLInputElement;
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
        <input cinder-field="crop" />
        <input cinder-field="state" />
        <div cinder-output="price">Price</div>
        <button cinder-action="search">Search</button>
      </div>
    </main>
  `;
}

async function main() {
  const dom = new JSDOM(createMarkup(), { url: 'http://localhost/' });
  installDomGlobals(dom);

  const runtime = new CinderSemanticRuntime();
  await runtime.init({
    semantic: { scanOnInit: false, observeMutations: false },
    ai: { enabled: false, mode: 'local', endpoint: '', apiKey: '' },
  });
  await runtime.scan(dom.window.document);

  // 1. Repeat phrases re-run the exact last resolved command.
  const first = await runtime.run('set crop to soybean', dom.window.document);
  assert(first.intent.intent === 'set_field' && first.intent.value === 'soybean', 'Expected baseline command to resolve.');

  for (const phrase of ['do that again', 'again', 'once more', 'repeat that', 'same again']) {
    const repeated = await runtime.run(phrase, dom.window.document);
    assert(repeated.intent.intent === 'set_field', `Expected "${phrase}" to repeat the last command, got "${repeated.intent.intent}".`);
    assert(repeated.intent.target === 'crop' && repeated.intent.value === 'soybean', `Expected "${phrase}" to repeat set_field crop=soybean exactly.`);
  }

  // 2. Trailing reference word substitution, same verb.
  await runtime.run('show price', dom.window.document);
  const sameVerbRef = await runtime.run('show that', dom.window.document);
  assert(sameVerbRef.intent.intent === 'show_output' && sameVerbRef.intent.target === 'price', 'Expected "show that" to resolve to show_output price.');
  assert(sameVerbRef.intent.normalizedInput.raw === 'show that', 'Expected the reported input to be what the user actually typed, not the substituted text.');

  // 3. Cross-verb substitution that doesn't make sense must fail cleanly (not_resolved),
  // never guess wrong - there are no routes in this fixture, so "open" + any key can't match.
  const crossVerbRef = await runtime.run('open that', dom.window.document);
  assert(crossVerbRef.intent.intent === 'unknown', 'Expected a cross-verb reference that doesn\'t apply to fail cleanly, not guess.');

  // 4. No prior command at all - a fresh runtime - reference words must not accidentally
  // resolve to anything.
  const freshRuntime = new CinderSemanticRuntime();
  await freshRuntime.init({
    semantic: { scanOnInit: false, observeMutations: false },
    ai: { enabled: false, mode: 'local', endpoint: '', apiKey: '' },
  });
  await freshRuntime.scan(dom.window.document);
  const freshRef = await freshRuntime.run('show that', dom.window.document);
  assert(freshRef.intent.intent === 'unknown', 'Expected a reference word with no prior command to fail to resolve.');
  const freshRepeat = await freshRuntime.run('again', dom.window.document);
  assert(freshRepeat.intent.intent === 'unknown', 'Expected a repeat phrase with no prior command to fail to resolve.');
  freshRuntime.destroy();

  // 5. A long, unrelated sentence that merely ENDS in "it"/"that" must not be substituted -
  // found via a real stress test (rupeey91repl-cinder): after "export csv" resolved, an
  // unrelated "what time is it" got rewritten to "what time is export-csv" and matched with
  // full confidence, purely because the engine's own key happened to appear as a literal
  // token. The feature is scoped to short "single-object command" phrasing only.
  await runtime.run('search', dom.window.document);
  const unrelatedLongSentence = await runtime.run('what time is it', dom.window.document);
  assert(unrelatedLongSentence.intent.intent === 'unknown', 'Expected an unrelated long sentence ending in "it" not to be substituted.');
  const unrelatedIdiom = await runtime.run(
    "I could really use a laugh after the day I've had, so would you mind telling me a joke or something funny like that",
    dom.window.document,
  );
  assert(unrelatedIdiom.intent.intent === 'unknown', 'Expected an unrelated long sentence ending in "that" not to be substituted.');

  // 6. The one deliberately-excluded case: a reference word in the VALUE position of a
  // set_field/set_filter command must NOT be substituted - "the same node" and "the same
  // value" are both plausible readings, so this shape is left alone rather than guessing.
  await runtime.run('set state to soybean', dom.window.document);
  const valuePositionRef = await runtime.run('set crop to that', dom.window.document);
  assert(valuePositionRef.intent.value === 'that', `Expected "set crop to that" to leave the value as literal "that" (unsupported shape), got "${valuePositionRef.intent.value}".`);

  runtime.destroy();

  console.log(JSON.stringify({
    ok: true,
    summary: {
      repeatPhrasesChecked: 5,
      sameVerbSubstitution: 'show_output price',
      crossVerbOutcome: crossVerbRef.intent.intent,
      freshSessionOutcome: freshRef.intent.intent,
      valuePositionExcluded: valuePositionRef.intent.value,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-reference-carryover] failed:', error);
  process.exitCode = 1;
});
