// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
/**
 * Canonicalizes a URL string through the `URL` constructor itself rather than comparing raw
 * strings - found necessary by real testing against apps/web: a bare `http://host` the browser
 * reports back as `http://host/` (ordinary trailing-slash normalization every browser does,
 * never a real redirect) was wrongly flagged as "redirected elsewhere" before this existed.
 * Comparing two URLs for "is this actually a different page" should always go through this
 * first, on both sides.
 */
export function normalizeUrl(url: string): string {
  return new URL(url).toString();
}
