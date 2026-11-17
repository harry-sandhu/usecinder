// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
// Coverage for the two bounded tier-1 additions decided in docs/known-limitations.md #1:
// clearFilter.ts (negation's one free-to-special-case shape - undoing a filter) and
// numericComparison.ts ("amount over 100" phrasing without "set...to"). Both reuse existing
// dispatch (literal value assignment) rather than inventing range-filter semantics Cinder's
// DOM dispatch can't actually deliver.
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

function createDom() {
  const dom = new JSDOM(`
    <main>
      <section id="orders-page" cinder-route="orders">
        <div id="orders-list" cinder-context="orders-list">
          <label for="status-filter">Status</label>
          <select id="status-filter" cinder-filter="status">
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>

          <label for="amount-field">Amount</label>
          <input id="amount-field" type="number" cinder-field="amount" />

          <label for="note-field">Note</label>
          <input id="note-field" type="text" cinder-field="note" />

          <label for="report-period-filter">Report period</label>
          <select id="report-period-filter" cinder-filter="report-period">
            <option value="daily">Day</option>
            <option value="weekly">Week</option>
            <option value="monthly">Month</option>
          </select>
        </div>
      </section>
    </main>
  `, { url: 'http://localhost/' });

  installDomGlobals(dom);
  return dom;
}

async function main() {
  const dom = createDom();
  const runtime = new CinderSemanticRuntime();

  await runtime.init({
    semantic: { scanOnInit: false, observeMutations: false },
    ai: { enabled: false, mode: 'local', endpoint: '', apiKey: '' },
  });

  await runtime.scan(dom.window.document);

  // 1. Setting a filter works as a baseline before testing clearing it.
  const setResult = await runtime.run('set status to open', dom.window.document);
  assert(setResult.intent.intent === 'set_filter', 'Expected set_filter for the baseline set.');
  assert(dom.window.document.getElementById('status-filter').value === 'open', 'Expected status filter set to open.');

  // 2. Clearing a named filter lands on the filter's own real "All" option, not an arbitrary empty string.
  const clearResult = await runtime.run('clear the status filter', dom.window.document);
  assert(clearResult.intent.intent === 'set_filter', 'Expected clearing a filter to resolve as set_filter.');
  assert(clearResult.intent.context?.cleared === true, 'Expected the cleared context flag to be set.');
  assert(dom.window.document.getElementById('status-filter').value === '', 'Expected status filter reset to its All option.');

  // 3. "clear filters" (no name) clears every real filter in the hot graph via a composite flow.
  await runtime.run('set status to closed', dom.window.document);
  const clearAllResult = await runtime.run('clear filters', dom.window.document);
  assert(clearAllResult.intent.intent === 'composite_flow', 'Expected clearing all filters to resolve as a composite flow.');
  assert(dom.window.document.getElementById('status-filter').value === '', 'Expected status filter reset by clear-all.');

  // 4. A numeric comparison without "set...to" phrasing resolves and assigns the bare number -
  // the comparison word routes the phrase, it doesn't invent a real ">" semantic the DOM lacks.
  const overResult = await runtime.run('amount over 100', dom.window.document);
  assert(overResult.intent.intent === 'set_field', 'Expected set_field for a numeric-comparison phrase.');
  assert(overResult.intent.context?.comparison === 'gte', 'Expected the gte comparison to be recorded.');
  assert(dom.window.document.getElementById('amount-field').value === '100', 'Expected amount field set to 100.');

  const underResult = await runtime.run('amount under 50', dom.window.document);
  assert(underResult.intent.context?.comparison === 'lte', 'Expected the lte comparison to be recorded.');
  assert(dom.window.document.getElementById('amount-field').value === '50', 'Expected amount field set to 50.');

  // 5. A comparison-shaped phrase against a non-numeric field must NOT fire - matching by name
  // alone isn't enough; real numeric metadata (type="number") is required.
  const nonNumericResult = await runtime.resolve('note over the limit');
  assert(nonNumericResult.intent !== 'set_field', 'Expected a comparison phrase against a text field to decline, not guess.');

  // 6. A comparison word used literally as a value ("set note to over the limit") must still work -
  // the comparison planner should never shadow the existing, more specific "set X to Y" planner.
  const literalValueResult = await runtime.run('set note to over the limit', dom.window.document);
  assert(literalValueResult.intent.intent === 'set_field', 'Expected the literal set...to phrasing to still win.');
  assert(dom.window.document.getElementById('note-field').value === 'over the limit', 'Expected the literal value to be stored as-is.');

  // 7. A real bug found via live testing against the rupeey CRM: a select-backed filter with
  // NO "All"/"Any" option (Day/Week/Month only) must decline to clear, not silently reset to
  // its first option while claiming "cleared: true" - that's standard HTMLSelectElement
  // behavior (assigning an unmatched value falls back to selecting the first option), and
  // claiming success there would be a lie about what actually happened.
  await runtime.run('set report period to month', dom.window.document);
  const reportPeriodBefore = dom.window.document.getElementById('report-period-filter').value;
  const undeclinedClear = await runtime.resolve('clear the report period filter');
  assert(undeclinedClear.intent === 'unknown', 'Expected clearing a filter with no All/Any option to decline honestly.');
  assert(dom.window.document.getElementById('report-period-filter').value === reportPeriodBefore, 'Expected the undeclined filter to be left completely untouched.');

  // 8. "clear filters" with a MIX of clearable and non-clearable filters must clear only what
  // it honestly can (status), and leave the non-clearable one (report-period) untouched -
  // partial success, not an all-or-nothing claim.
  await runtime.run('set status to closed', dom.window.document);
  const mixedClearAll = await runtime.run('clear filters', dom.window.document);
  assert(mixedClearAll.intent.intent === 'composite_flow', 'Expected the mixed clear-all to still resolve as a composite flow for the clearable subset.');
  assert(dom.window.document.getElementById('status-filter').value === '', 'Expected the clearable status filter to be cleared by clear-all.');
  assert(dom.window.document.getElementById('report-period-filter').value === 'monthly', 'Expected the non-clearable report-period filter to be left untouched by clear-all.');
  assert(!mixedClearAll.intent.context?.clearedFilters.includes('report-period'), 'Expected report-period to be excluded from the clear-all\'s own clearedFilters list.');

  console.log('All tier-1 extension (negation + numeric comparison) validations passed.');
}

main();
