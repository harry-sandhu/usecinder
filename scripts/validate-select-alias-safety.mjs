// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
// Regression for a real bug found via live testing against the rupeey CRM (not anticipated in
// advance): a <select>-backed filter/field got its ENTIRE textContent (every <option>'s text,
// concatenated with no separator - real JSX output has no whitespace between sibling elements)
// added as a label/alias candidate (tagScanner.ts's getTextContent -> tagRecord.ts's
// deriveAliases). A real filter offering Day/Week/Half month/Month/Quarter/Custom ended up with
// the alias "dayweekhalf-monthmonthquartercustom" - garbled, useless, and a real correctness
// risk (it contains "custom" as a substring, which could pollute candidate matching for an
// unrelated phrase). Fixed by excluding <select> from getTextContent entirely - its real
// content is already modeled correctly via getSelectOptionLabels/metadata.options.
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
  globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
  globalThis.Event = dom.window.Event;
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
  // No whitespace between <option> tags at all - reproducing real compiled-JSX output, not
  // hand-formatted markup that would accidentally mask the bug with incidental whitespace.
  const dom = new JSDOM(
    '<main><section cinder-route="reports"><div cinder-context="reports-body">' +
    '<label for="report-period-filter">Period</label>' +
    '<select id="report-period-filter" cinder-filter="report-period">' +
    '<option value="daily">Day</option><option value="weekly">Week</option>' +
    '<option value="half-month">Half month</option><option value="monthly">Month</option>' +
    '<option value="quarterly">Quarter</option><option value="custom">Custom</option>' +
    '</select>' +
    '<button cinder-action="apply-custom">Custom</button>' +
    '<select cinder-filter="unlabeled-period">' +
    '<option value="daily">Day</option><option value="weekly">Week</option>' +
    '</select>' +
    '</div></section></main>',
    { url: 'http://localhost/' },
  );

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
  const graph = runtime.graph();
  const filter = graph.nodes.find((node) => node.type === 'filter' && node.key === 'report-period');

  // 1. No garbled concatenated-options alias anywhere on the real node.
  assert(!filter.aliases.some((alias) => alias.length > 20 && !alias.includes('-')), `Expected no garbled long alias, got: ${JSON.stringify(filter.aliases)}`);
  assert(!filter.aliases.includes('dayweekhalf-monthmonthquartercustom'), 'Expected the specific garbled alias from the real bug not to reappear.');

  // 2. The real, useful label ("Period", from the associated <label>) must still be derived
  // correctly - this fix must not have broken the normal, working case.
  assert(filter.label === 'Period', `Expected the real label to still be "Period", got "${filter.label}".`);

  // 3. The select's real options are still captured correctly via metadata.options - this fix
  // only removes the garbled textContent-based alias, not the actual option data.
  assert(Array.isArray(filter.metadata.options) && filter.metadata.options.includes('Custom'), 'Expected real option labels to still be captured in metadata.options.');

  // 4. A genuinely separate button whose own real label IS "Custom" must be completely
  // unaffected - this fix is select-specific, not a blanket "ignore the word custom" change.
  const applyCustomAction = graph.nodes.find((node) => node.type === 'action' && node.key === 'apply-custom');
  assert(applyCustomAction.label === 'Custom' && applyCustomAction.aliases.includes('custom'), 'Expected an unrelated action literally labeled "Custom" to be completely unaffected.');

  // 5. "set period to custom" must resolve to the real filter via its real option, not get
  // confused by cross-candidate pollution from the (now-removed) garbled alias.
  const result = await runtime.run('set period to custom', dom.window.document);
  assert(result.intent.intent === 'set_filter' && result.intent.target === 'report-period', 'Expected setting the filter by a real option name to resolve correctly post-fix.');

  // 6. The worse variant of the same bug: a <select> with NO associated <label>/aria-label at
  // all would previously fall through deriveLabel's priority chain all the way to the garbled
  // textContent, making it the node's actual LABEL, not just an extra alias. Must not happen.
  const unlabeled = graph.nodes.find((node) => node.type === 'filter' && node.key === 'unlabeled-period');
  assert(unlabeled.label !== 'DayWeek', `Expected no garbled concatenated label on an unlabeled select, got "${unlabeled.label}".`);
  assert(!unlabeled.aliases.some((alias) => alias.length > 10 && !alias.includes('-')), `Expected no garbled alias either, got: ${JSON.stringify(unlabeled.aliases)}`);

  console.log('All select alias safety validations passed.');
}

main();
