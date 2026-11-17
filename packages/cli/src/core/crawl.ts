// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { chromium } from "playwright";
import type { CinderGraphSnapshot } from "usecinder";
import { auditRenderedPage } from "./audit.js";
import { normalizeUrl } from "./normalizeUrl.js";
import { resolveSameOriginLinks } from "./sameOrigin.js";
import type { PageFindings } from "./report.js";

export interface CrawlOptions {
  startUrl: string;
  maxPages: number;
  /**
   * Paused between page loads on purpose - found necessary by real testing this session
   * (docs/known-limitations.md's tagging-checklist entry): rapid, scripted navigation through
   * many routes in a row can catch a page before its accessible name has fully settled,
   * producing false label findings. One hard navigation per page, with a real pause after,
   * avoids that - never rapid in-app link-clicking.
   */
  settleMs: number;
  /**
   * Path to a Playwright storage-state JSON file (cookies + localStorage) - found necessary by
   * real testing: crawling rupeey's real /app/* routes with no session redirected straight to
   * its login page, auditing the login form instead of the actual app. Export one from an
   * already-authenticated session with `await context.storageState({ path })`, or Playwright's
   * own `npx playwright open <url>` (log in manually, then save state) - this tool doesn't try
   * to perform login itself, since that's genuinely app-specific and guessing at it would be
   * exactly the kind of untrustworthy inference this project has already decided against.
   */
  storageStatePath?: string;
  onPageVisited?: (url: string, index: number, total: number) => void;
}

const DEFAULT_SETTLE_MS = 400;
const DEFAULT_MAX_PAGES = 25;

export async function crawlAndAudit(options: CrawlOptions): Promise<PageFindings[]> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;

  const browser = await chromium.launch();
  const context = await browser.newContext(
    options.storageStatePath ? { storageState: options.storageStatePath } : {},
  );
  const page = await context.newPage();
  const visited = new Set<string>();
  const queue: string[] = [options.startUrl];
  const results: PageFindings[] = [];

  try {
    while (queue.length > 0 && results.length < maxPages) {
      // Normalized once via the URL constructor itself, not compared as a raw string - found
      // live against apps/web: a bare "http://host" the browser reports back as
      // "http://host/" (a trailing-slash normalization every browser does, not a redirect at
      // all) was wrongly flagged as "redirected elsewhere" before this fix.
      const url = normalizeUrl(queue.shift()!);

      if (visited.has(url)) {
        continue;
      }

      visited.add(url);

      try {
        await page.goto(url, { waitUntil: "networkidle" });
      } catch {
        // A page that fails to load entirely (dead link, DNS/connection failure) is skipped,
        // not fatal to the whole crawl - one broken route shouldn't stop every other page from
        // being audited.
        continue;
      }

      // A goto that SUCCEEDS but lands somewhere else entirely - found live against rupeey:
      // every /app/* route with no session redirects straight to /login, auditing the login
      // form instead of the real app. Not an error, so it can't be caught above; surfaced
      // honestly in the finding itself rather than silently auditing the wrong page. Both
      // sides are already-normalized URL strings, so this only fires on a REAL difference.
      const landedUrl = normalizeUrl(page.url());
      const redirectedFrom = landedUrl !== url ? url : undefined;

      // Several different requested URLs can all redirect to the SAME page (every /app/*
      // route landing on one shared /login) - already-visited by the time a later redirect
      // reaches it, so skip re-auditing it again instead of duplicating findings.
      if (redirectedFrom && visited.has(landedUrl)) {
        continue;
      }

      visited.add(landedUrl);

      await page.waitForTimeout(settleMs);

      const html = await page.content();
      const liveGraphSnapshot = await page.evaluate<CinderGraphSnapshot | null>(() => {
        const cinder = (window as unknown as { Cinder?: { graph?: () => unknown } }).Cinder;
        return cinder?.graph ? (cinder.graph() as CinderGraphSnapshot) : null;
      });

      results.push(auditRenderedPage(landedUrl, html, liveGraphSnapshot ?? undefined, redirectedFrom));
      options.onPageVisited?.(landedUrl, results.length, maxPages);

      const hrefs = await page.evaluate<string[]>(() =>
        Array.from(document.querySelectorAll("a[href]")).map((anchor) => anchor.getAttribute("href") ?? ""),
      );

      for (const link of resolveSameOriginLinks(url, hrefs)) {
        if (!visited.has(link) && !queue.includes(link)) {
          queue.push(link);
        }
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}
