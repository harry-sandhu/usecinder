// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
// Frozen benchmark set for the local-engine hardening plan (docs/local-engine-fully-fledged-plan.md, §5).
//
// This is NOT a pass/fail gate (yet) - it's a measurement. Run it before and after a local-engine
// change and compare the "resolved_exact" count: that delta is the actual evidence of improvement,
// not a vibe check. Each case's expectedOutcome is this benchmark's current honest read of what the
// engine does today; when a fix changes that, update the expectation deliberately (git diff on this
// file IS the changelog of "what got better").
import { JSDOM } from 'jsdom';
import { CinderSemanticRuntime, classifyRunResult } from '../packages/cinder/dist/index.js';

function installDomGlobals(dom) {
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLAnchorElement = dom.window.HTMLAnchorElement;
  globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
  globalThis.HTMLFormElement = dom.window.HTMLFormElement;
  globalThis.HTMLInputElement = dom.window.HTMLInputElement;
  globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
  globalThis.Event = dom.window.Event;
  globalThis.SpeechSynthesisUtterance = dom.window.SpeechSynthesisUtterance ?? class {
    constructor(text) {
      this.text = text;
    }
  };
  globalThis.CSS = dom.window.CSS ?? {
    escape(value) {
      return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    },
  };

  if (!dom.window.HTMLElement.prototype.scrollIntoView) {
    dom.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
  }
  if (!dom.window.HTMLElement.prototype.focus) {
    dom.window.HTMLElement.prototype.focus = function focus() {};
  }
}

// A plain (non-React) tagged fixture, deliberately not agriculture-flavored - this benchmark is
// specifically meant to exercise the GENERIC local engine, not the agri searchFlow preset. The
// React-controlled-input-specific question (3.1) is answered separately in
// apps/react-formtest (that check needs a real browser; see the plan's §3.1 for why jsdom
// gives a false negative there) and isn't re-litigated by this benchmark.
function createMarkup() {
  return `
    <main>
      <section cinder-route="catalog" data-cinder-path="/catalog">
        <div cinder-context="catalog-browser">
          <input id="crop-field" cinder-field="crop" />
          <input id="quantity-field" cinder-field="quantity" />
          <input id="search-field" cinder-field="search-query" />
          <select id="state-filter" cinder-filter="state" data-cinder-affects="price">
            <option value="">choose</option>
            <option value="punjab">punjab</option>
            <option value="haryana">haryana</option>
          </select>
          <button id="search-action" cinder-action="search" data-cinder-depends-on="state">Search</button>
          <div id="price-output" cinder-output="price">Price</div>
        </div>
      </section>
      <section cinder-route="settings" data-cinder-path="/settings">
        <div cinder-context="settings-page">Settings</div>
      </section>
    </main>
  `;
}

const cases = [
  { input: 'open settings', expectedOutcome: 'resolved_exact', note: 'navigation' },
  { input: 'set crop to soybean', expectedOutcome: 'resolved_exact', note: 'set_field, canonical verb' },
  { input: 'choose crop to soybean', expectedOutcome: 'resolved_exact', note: 'set_field, synonym verb' },
  { input: 'pick crop to wheat', expectedOutcome: 'resolved_exact', note: 'set_field, synonym verb' },
  { input: 'select state to punjab', expectedOutcome: 'resolved_exact', note: 'set_filter, synonym verb' },
  { input: 'change crop to maize', expectedOutcome: 'resolved_exact', note: 'set_field, synonym verb' },
  { input: 'show price', expectedOutcome: 'resolved_exact', note: 'show_output, canonical verb' },
  { input: 'view price', expectedOutcome: 'resolved_exact', note: 'show_output, synonym verb' },
  { input: 'check price', expectedOutcome: 'resolved_exact', note: 'show_output, synonym verb' },
  { input: 'search', expectedOutcome: 'resolved_exact', note: 'trigger_action via fuzzy graph match' },
  { input: 'set crop to soybean and set state to punjab', expectedOutcome: 'resolved_exact', note: 'generic composite split' },
  { input: 'set crop to soybean then show price', expectedOutcome: 'resolved_exact', note: 'generic composite split, "then"' },
  { input: 'set crop to soybean and wheat', expectedOutcome: 'resolved_exact', note: 'value containing "and" must NOT be split' },
  { input: 'set crop to soybean, set state to punjab', expectedOutcome: 'resolved_exact', note: 'comma-separated composite split' },
  { input: 'set crop to soybean, and set state to punjab', expectedOutcome: 'resolved_exact', note: 'comma + "and" composite split' },
  { input: 'set crop to wheat, set crop to maize, set state to punjab', expectedOutcome: 'resolved_exact', note: '3-clause composite split' },
  { input: 'flibbertigibbet wobble nonsense', expectedOutcome: 'not_resolved', note: 'genuinely unresolvable' },
  { input: 'set nonexistentfield to value', expectedOutcome: 'not_resolved', note: 'no matching field/filter at all' },
  // Note: this benchmark shares one runtime across all cases (cheaper, matches how a real
  // session behaves), so by this point "catalog-browser" is already the active context from
  // earlier cases - the query engine legitimately adds a context-match score bonus, so this
  // specific weak substring match clears the exact threshold here. Confirmed standalone, in
  // a fresh session with no active context, the identical "set cro to soybean" scores 60 -
  // confidence 0.8 - and correctly comes back resolved_fuzzy, not resolved_exact (that's the
  // actual fix this case is meant to demonstrate; see the commit introducing scoreToConfidence).
  { input: 'set cro to soybean', expectedOutcome: 'resolved_exact', note: 'weak substring match, but boosted by active-context bonus from earlier cases in this shared session' },
  { input: '', expectedOutcome: 'not_resolved', note: 'empty input' },
  {
    input: 'search and set state to haryana',
    expectedOutcome: 'resolved_exact',
    expectWarning: true,
    note: 'depends_on: action declared before its dependency - should warn but still execute (not block)',
  },
  {
    input: 'set state to haryana and search',
    expectedOutcome: 'resolved_exact',
    expectWarning: false,
    note: 'depends_on: dependency satisfied in order - no warning',
  },
  { input: 'search for soybean prices', expectedOutcome: 'resolved_fuzzy', note: 'natural search phrasing, no explicit field name - matchSearchFieldPlanner' },
  { input: 'look up punjab', expectedOutcome: 'resolved_fuzzy', note: 'natural search phrasing, synonym verb' },
  { input: 'find maize', expectedOutcome: 'resolved_fuzzy', note: 'natural search phrasing, synonym verb' },
  { input: 'set quantity to twenty two', expectedOutcome: 'resolved_exact', note: 'number-word parsing: value should become "22", not the literal text' },
];

async function main() {
  const dom = new JSDOM(createMarkup(), { url: 'http://localhost/' });
  installDomGlobals(dom);

  const runtime = new CinderSemanticRuntime();
  await runtime.init({
    semantic: { scanOnInit: false, observeMutations: false },
    ai: { enabled: false, mode: 'local', endpoint: '', apiKey: '' },
  });
  await runtime.scan(dom.window.document);

  const results = [];
  for (const testCase of cases) {
    const runResult = await runtime.run(testCase.input, dom.window.document);
    const outcome = classifyRunResult(runResult);
    const hasWarning = Boolean(runResult.dispatch.warnings && runResult.dispatch.warnings.length > 0);
    const outcomeMatches = outcome === testCase.expectedOutcome;
    const warningMatches = testCase.expectWarning === undefined || hasWarning === testCase.expectWarning;
    results.push({
      input: testCase.input,
      note: testCase.note,
      expectedOutcome: testCase.expectedOutcome,
      actualOutcome: outcome,
      ...(testCase.expectWarning !== undefined ? { expectWarning: testCase.expectWarning, hasWarning } : {}),
      match: outcomeMatches && warningMatches,
    });
  }

  const resolvedExactCount = results.filter((r) => r.actualOutcome === 'resolved_exact').length;
  const matchingExpectationCount = results.filter((r) => r.match).length;
  const mismatches = results.filter((r) => !r.match);

  const summary = {
    totalCases: results.length,
    resolvedExactCount,
    matchingExpectationCount,
    mismatchCount: mismatches.length,
    results,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (mismatches.length > 0) {
    console.error(
      `[benchmark-local-engine] ${mismatches.length} case(s) didn't match their expected outcome - ` +
        `either a regression, or this benchmark's expectations are stale and should be updated deliberately.`,
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[benchmark-local-engine] failed:', error);
  process.exitCode = 1;
});
