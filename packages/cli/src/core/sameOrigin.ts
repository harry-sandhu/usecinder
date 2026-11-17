// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
/**
 * Resolves a page's raw `<a href>` values against the page's own URL, keeping only real,
 * same-origin, http(s) pages - never cross-origin links (never crawl someone else's site just
 * because it's linked), never `javascript:`/`mailto:`/`#fragment-only` links (not real pages),
 * and with the fragment stripped (so "/app/dashboard#section" and "/app/dashboard" aren't
 * crawled as two different pages). Pure and dependency-free so it's directly testable without
 * a real browser - see validate-cli-same-origin.mjs.
 */
export function resolveSameOriginLinks(pageUrl: string, hrefs: readonly string[]): string[] {
  let base: URL;

  try {
    base = new URL(pageUrl);
  } catch {
    return [];
  }

  const resolved = new Set<string>();

  for (const href of hrefs) {
    if (!href || !href.trim()) {
      continue;
    }

    let candidate: URL;

    try {
      candidate = new URL(href, base);
    } catch {
      continue;
    }

    if (candidate.protocol !== "http:" && candidate.protocol !== "https:") {
      continue;
    }

    if (candidate.origin !== base.origin) {
      continue;
    }

    candidate.hash = "";
    resolved.add(candidate.toString());
  }

  return [...resolved];
}
