// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
// Coverage for auditUntaggedElements (packages/cinder/src/core/tools/untaggedElementAudit.ts) -
// the other half of the tagging checklist alongside auditLabelQuality: finds real interactive
// elements that have NO cinder-* tag at all, which never show up in a Cinder graph snapshot and
// so are invisible to every other Cinder tool. Pure DOM function, tested with JSDOM - no model,
// no network.
import { JSDOM } from 'jsdom';
import { auditUntaggedElements } from '../packages/cinder/dist/index.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function installDomGlobals(dom) {
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Element = dom.window.Element;
  globalThis.CSS = dom.window.CSS ?? {
    escape(value) {
      return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    },
  };
}

function main() {
  const dom = new JSDOM(`
    <main>
      <a href="/billing" cinder-route="billing">Billing</a>
      <a href="/reports" id="reports-link">Reports</a>
      <button cinder-action="export-csv">Export CSV</button>
      <button id="delete-account">Delete account</button>
      <button disabled id="disabled-button">Can't click me</button>
      <a href="#" aria-hidden="true" id="hidden-skip-link">Skip</a>
      <div cinder-filter="status">
        <select id="status-select"><option>Open</option></select>
      </div>
      <select id="sort-order"><option>Newest</option></select>
      <input type="text" id="search-box" placeholder="Search" />
      <input type="checkbox" id="agree-checkbox" />
      <a href="javascript:void(0)" id="js-link">Do a thing</a>
      <input type="password" id="password-field" />
    </main>
  `, { url: 'http://localhost/' });

  installDomGlobals(dom);

  const findings = auditUntaggedElements(dom.window.document);
  const byId = (id) => findings.find((f) => f.selectorHint === `#${id}`);

  // 1. An already-tagged element must never be flagged.
  assert(!findings.some((f) => f.selectorHint.includes('billing')), 'Expected the already-tagged billing link not to be flagged.');

  // 2. A real, untagged navigation link must be flagged and suggested as a route.
  const reports = byId('reports-link');
  assert(reports?.suggestedTag === 'cinder-route' && reports.accessibleText === 'Reports', 'Expected the untagged real link to be flagged as a likely route.');

  // 3. An element nested inside an already-tagged container must NOT be flagged separately -
  // it's part of that control (the real "icon inside a tagged button" shape).
  assert(!findings.some((f) => f.selectorHint.includes('status-select')), 'Expected the select nested inside an already-tagged filter container to be skipped.');

  // 4. A disabled control and an aria-hidden element must be excluded as noise.
  assert(!byId('disabled-button'), 'Expected a disabled button to be excluded.');
  assert(!byId('hidden-skip-link'), 'Expected an aria-hidden element to be excluded.');

  // 5. Suggested tags must match the element's real shape.
  const deleteButton = byId('delete-account');
  assert(deleteButton?.suggestedTag === 'cinder-action', 'Expected an untagged button to be suggested as an action.');

  const sortSelect = byId('sort-order');
  assert(sortSelect?.suggestedTag === 'cinder-filter', 'Expected an untagged select to be suggested as a filter.');

  const searchBox = byId('search-box');
  assert(searchBox?.suggestedTag === 'cinder-field', 'Expected an untagged text input to be suggested as a field.');

  const checkbox = byId('agree-checkbox');
  assert(checkbox?.suggestedTag === 'cinder-filter', 'Expected an untagged checkbox to be suggested as a filter.');

  // 6. A non-navigational "#"/javascript: link must be suggested as an action, not a route -
  // it's not really taking the user anywhere.
  const jsLink = byId('js-link');
  assert(jsLink?.suggestedTag === 'cinder-action', 'Expected a javascript: link to be suggested as an action, not a route.');

  // 7. A password field must NEVER be suggested as a Cinder field - found via real testing
  // (a real app's change-password form): letting a semantic command engine set a password's
  // value is a real security/UX anti-pattern, not just noise to filter.
  assert(!byId('password-field'), 'Expected a password input to be excluded entirely, never suggested as a field.');

  console.log('All untagged element audit validations passed.');
}

main();
