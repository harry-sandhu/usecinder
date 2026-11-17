// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
// Coverage for @cinder/cli's same-origin link resolver (packages/cli/src/core/sameOrigin.ts) -
// the crawler's own "don't guess, don't wander off" boundary: cross-origin links, non-http(s)
// links, and fragment-only duplicates must never reach the crawl queue.
import { resolveSameOriginLinks } from '../packages/cli/dist/index.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const pageUrl = 'http://localhost:5174/app/dashboard';

  // 1. Relative and absolute same-origin links both resolve correctly.
  const basic = resolveSameOriginLinks(pageUrl, ['/app/loans/active', 'http://localhost:5174/app/reports']);
  assert(basic.includes('http://localhost:5174/app/loans/active'), 'Expected a relative same-origin link to resolve to an absolute URL.');
  assert(basic.includes('http://localhost:5174/app/reports'), 'Expected an absolute same-origin link to be kept as-is.');

  // 2. Cross-origin links must never be crawled, even if they look like real pages.
  const crossOrigin = resolveSameOriginLinks(pageUrl, ['https://example.com/pricing', 'http://evil.test/app/dashboard']);
  assert(crossOrigin.length === 0, 'Expected every cross-origin link to be excluded.');

  // 3. javascript:/mailto: links and an empty href are never real pages to crawl.
  const nonPages = resolveSameOriginLinks(pageUrl, ['javascript:void(0)', 'mailto:someone@example.com', '']);
  assert(nonPages.length === 0, 'Expected javascript:/mailto:/empty hrefs to be excluded.');

  // 4. The same page reached via two different fragments must be treated as ONE page, not
  // crawled twice - the fragment is stripped before dedup.
  const fragments = resolveSameOriginLinks(pageUrl, ['/app/loans/active#top', '/app/loans/active#bottom']);
  assert(fragments.length === 1 && fragments[0] === 'http://localhost:5174/app/loans/active', 'Expected fragment-only variants of the same page to collapse to one URL.');

  // 5. A malformed href must be skipped, not crash the whole resolver.
  const malformed = resolveSameOriginLinks(pageUrl, ['http://', '/valid-page']);
  assert(malformed.includes('http://localhost:5174/valid-page') && malformed.length === 1, 'Expected a malformed href to be skipped without affecting the rest.');

  console.log('All @cinder/cli same-origin link resolver validations passed.');
}

main();
