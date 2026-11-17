// Coverage for @cinder/cli's report builder (packages/cli/src/core/report.ts) - the single
// consolidated file `cinder integrate` hands off to a coding agent. Pure string-building logic,
// no browser/network involved.
import { buildIntegrationReport } from '../packages/cli/dist/index.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  // 1. A clean page with zero findings must say so plainly, not just omit the section.
  const cleanReport = buildIntegrationReport([
    { url: 'http://localhost:5174/app/dashboard', untagged: [], weakLabels: [] },
  ]);
  assert(cleanReport.includes('No findings on this page.'), 'Expected a clean page to say so explicitly.');
  assert(cleanReport.includes('0 untagged element finding(s), 0 weak-label finding(s)'), 'Expected the header summary to reflect zero findings.');

  // 2. Real findings must include the element shape, the suggested tag (never silently dropped),
  // and the hand-off instruction to a coding agent - this report is meant to be acted on, not
  // just read.
  const findingsReport = buildIntegrationReport([
    {
      url: 'http://localhost:5174/app/loans/active',
      untagged: [
        { tagName: 'button', accessibleText: 'Sign out', selectorHint: '#sign-out', suggestedTag: 'cinder-action' },
        { tagName: 'select', accessibleText: undefined, selectorHint: '#status-select', suggestedTag: undefined },
      ],
      weakLabels: [
        { nodeId: 'route:x', key: 'some-page', type: 'route', issue: 'label_echoes_key', currentLabel: 'some-page', selectorHint: '#nav > a' },
      ],
    },
  ]);
  assert(findingsReport.includes('Sign out') && findingsReport.includes('cinder-action'), 'Expected an untagged finding\'s text and suggested tag to appear.');
  assert(findingsReport.includes('no clear suggestion'), 'Expected a finding with no suggestedTag to say so honestly, not silently omit it.');
  assert(findingsReport.includes('label_echoes_key'), 'Expected a weak-label finding\'s issue to appear.');
  assert(findingsReport.toLowerCase().includes('coding agent'), 'Expected the report to instruct the reader to hand it to a coding agent.');
  assert(findingsReport.includes('1 untagged element finding(s)') === false, 'sanity'); // 2 untagged findings, not 1
  assert(findingsReport.includes('2 untagged element finding(s), 1 weak-label finding(s)'), 'Expected the header summary counts to be correct.');

  // 3. Multiple pages each get their own clearly separated section, by URL.
  const multiPageReport = buildIntegrationReport([
    { url: 'http://localhost:5174/app/dashboard', untagged: [], weakLabels: [] },
    { url: 'http://localhost:5174/app/reports', untagged: [], weakLabels: [] },
  ]);
  assert(multiPageReport.includes('## http://localhost:5174/app/dashboard') && multiPageReport.includes('## http://localhost:5174/app/reports'), 'Expected each page to get its own section header.');

  // 4. Zero pages reachable at all (a dead starting URL) must be reported honestly, not as an
  // empty/misleadingly "clean" report.
  const emptyReport = buildIntegrationReport([]);
  assert(emptyReport.includes('No pages were reachable'), 'Expected an honest message when no pages were reachable at all.');

  // 5. A real finding from live-testing against rupeey: a page that redirected (an auth wall)
  // must say so explicitly, so the reader knows the findings below are for the REDIRECT
  // target, not the page they actually asked to audit.
  const redirectedReport = buildIntegrationReport([
    { url: 'http://localhost:5174/login', redirectedFrom: 'http://localhost:5174/app/dashboard', untagged: [], weakLabels: [] },
  ]);
  assert(redirectedReport.includes('Redirected here from `http://localhost:5174/app/dashboard`'), 'Expected a redirected page to say so explicitly, including the originally-requested URL.');
  assert(redirectedReport.includes('--storage-state'), 'Expected the redirect notice to point at the fix.');

  // 6. A real finding from live-testing against apps/web: a cold route with no live DOM
  // element has selectorHint undefined by design - the report must say so in plain language,
  // never print the literal word "undefined" as if it were an error.
  const coldNodeReport = buildIntegrationReport([
    {
      url: 'http://localhost:5174/docs/guides',
      untagged: [],
      weakLabels: [
        { nodeId: 'route:x', key: 'docs-guides', type: 'route', issue: 'label_echoes_key', currentLabel: 'docs-guides', selectorHint: undefined },
      ],
    },
  ]);
  assert(!coldNodeReport.includes('` undefined') && !coldNodeReport.includes('`undefined`'), 'Expected no literal "undefined" in the report for a cold node with no live element.');
  assert(coldNodeReport.includes('no live DOM element'), 'Expected an honest, plain-language explanation for a cold node instead.');

  console.log('All @cinder/cli report builder validations passed.');
}

main();
