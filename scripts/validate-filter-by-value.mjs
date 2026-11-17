// Coverage for the "filter by X" planner (core/cie/planners/filterByValue.ts): recognizes
// value-only filter phrasing ("filter by overdue", "show only active") that matchSetValuePlanner
// can't ("set X to Y" needs the field named in the sentence). See the module's own doc comment
// for why this works by matching the VALUE against each filter's real <select> options instead.
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
      <div cinder-context="a">
        <select cinder-filter="loan-status" aria-label="Status">
          <option>Active</option>
          <option>Overdue</option>
          <option>Closed</option>
        </select>
      </div>
      <div cinder-context="b">
        <select cinder-filter="loan-source" aria-label="Source">
          <option>Website</option>
          <option>Referral</option>
        </select>
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

  // 1. Bare "filter by <value>" with no field named - must pick the ONE filter that
  // actually offers that value as a real option, among several on the page.
  for (const phrase of ['filter by overdue', 'show only overdue', 'only show overdue', 'narrow it down by overdue', 'narrow this by overdue']) {
    const r = await runtime.run(phrase, dom.window.document);
    assert(r.intent.intent === 'set_filter', `Expected "${phrase}" to resolve to set_filter, got "${r.intent.intent}".`);
    assert(r.intent.target === 'loan-status', `Expected "${phrase}" to target loan-status, got "${r.intent.target}".`);
    assert(r.intent.value === 'Overdue', `Expected "${phrase}" to set the real option label "Overdue", got "${r.intent.value}".`);
    assert(r.intent.confidence < 0.85, `Expected "${phrase}" to classify as resolved_fuzzy (confidence < 0.85), got ${r.intent.confidence}.`);
  }

  // 2. A value that belongs to the OTHER filter on the page must target that one, not the
  // first one found - proves this isn't just always picking the first filter node.
  const other = await runtime.run('filter by referral', dom.window.document);
  assert(other.intent.target === 'loan-source' && other.intent.value === 'Referral', 'Expected "filter by referral" to target loan-source.');

  // 2b. A value phrase with a generic trailing noun the real option doesn't have ("overdue
  // LOANS" vs. the option "Overdue"), and "filter THIS LIST by" (a noun between "this" and
  // "by") - both found missing via a real live-browser test.
  const genericNoun = await runtime.run('filter this list by overdue loans', dom.window.document);
  assert(genericNoun.intent.target === 'loan-status' && genericNoun.intent.value === 'Overdue', `Expected "filter this list by overdue loans" to match the real option "Overdue", got target "${genericNoun.intent.target}" value "${genericNoun.intent.value}".`);

  // 3. A value no filter on the page actually offers must fail cleanly, not guess.
  const noMatch = await runtime.run('filter by something that does not exist anywhere', dom.window.document);
  assert(noMatch.intent.intent === 'unknown', 'Expected a value with no matching option to fail to resolve.');

  // 4. Two structurally distinct filters that happen to offer the SAME option text is a
  // genuine ambiguity - must decline, never pick one arbitrarily.
  const ambiguousDom = new JSDOM(`
    <main>
      <div cinder-context="a"><select cinder-filter="widget-status" aria-label="Widget status"><option>Active</option></select></div>
      <div cinder-context="b"><select cinder-filter="gadget-status" aria-label="Gadget status"><option>Active</option></select></div>
    </main>
  `, { url: 'http://localhost/' });
  installDomGlobals(ambiguousDom);
  const ambiguousRuntime = new CinderSemanticRuntime();
  await ambiguousRuntime.init({
    semantic: { scanOnInit: false, observeMutations: false },
    ai: { enabled: false, mode: 'local', endpoint: '', apiKey: '' },
  });
  await ambiguousRuntime.scan(ambiguousDom.window.document);
  const ambiguous = await ambiguousRuntime.run('filter by active', ambiguousDom.window.document);
  assert(ambiguous.intent.intent === 'unknown', 'Expected two filters offering the same value to be a genuine ambiguity, not a guess.');
  ambiguousRuntime.destroy();

  // 5. "set X to Y" (matchSetValuePlanner) must still win when the sentence DOES name the
  // field - this planner must not shadow the existing, more specific grammar.
  const named = await runtime.run('set status to overdue', dom.window.document);
  assert(named.intent.intent === 'set_filter' && named.intent.target === 'loan-status' && named.intent.value === 'overdue', 'Expected "set status to overdue" to still work via matchSetValuePlanner.');

  runtime.destroy();

  console.log(JSON.stringify({
    ok: true,
    summary: {
      bareFilterByPhrasesChecked: 5,
      correctlyDisambiguatedSecondFilter: other.intent.target,
      noMatchOutcome: noMatch.intent.intent,
      genuineAmbiguityOutcome: ambiguous.intent.intent,
      namedFieldStillWorks: named.intent.intent,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-filter-by-value] failed:', error);
  process.exitCode = 1;
});
