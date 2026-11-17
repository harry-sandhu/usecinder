// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
// Regression for a real bug found via live testing against apps/web (not a synthetic test
// alone): @usecinder/cli's crawler compared a requested URL against the page's landed URL with
// raw string equality, so a bare "http://host" (which every browser normalizes to
// "http://host/" on navigation - not a redirect at all) was wrongly reported as "redirected
// elsewhere (likely an auth wall)". normalizeUrl (packages/cli/src/core/normalizeUrl.ts) fixes
// this by routing both sides through the URL constructor before comparing.
import { normalizeUrl } from '../packages/cli/dist/index.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  // 1. The exact real-world case: a bare origin with no trailing slash must normalize
  // identically to its browser-reported, slash-suffixed form.
  assert(normalizeUrl('http://localhost:5174') === normalizeUrl('http://localhost:5174/'), 'Expected a bare origin and its trailing-slash form to normalize identically.');

  // 2. A genuinely different path must NOT be collapsed - this fix must not hide real
  // redirects, only the false-positive trailing-slash case.
  assert(normalizeUrl('http://localhost:5174/app/dashboard') !== normalizeUrl('http://localhost:5174/login'), 'Expected a genuinely different page to still normalize to a different URL.');

  // 3. Query string and path must both be preserved through normalization.
  assert(normalizeUrl('http://localhost:5174/app/loans?status=active') === 'http://localhost:5174/app/loans?status=active', 'Expected path and query string to survive normalization unchanged.');

  console.log('All @usecinder/cli URL normalization validations passed.');
}

main();
