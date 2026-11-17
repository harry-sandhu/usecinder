import { JSDOM, VirtualConsole } from "jsdom";
import { auditLabelQuality, auditUntaggedElements, type CinderGraphSnapshot } from "usecinder";
import type { PageFindings } from "./report.js";

/**
 * JSDOM's bundled CSS parser doesn't understand modern syntax real apps actually ship (found
 * live against rupeey: Tailwind v4's `@layer properties`/`@property` made it fail to parse the
 * page's own inlined stylesheet) - and by default JSDOM forwards that failure, WITH THE ENTIRE
 * STYLESHEET TEXT, to the real console as an error, once per page crawled. Irrelevant noise for
 * this tool: auditUntaggedElements only inspects DOM structure/attributes, never CSS, so an
 * un-piped virtual console (no `sendTo`, so nothing reaches the real console) silences it
 * without silencing anything this tool actually needs to see.
 */
const SILENT_VIRTUAL_CONSOLE = new VirtualConsole();

function ensureCssPolyfill(): void {
  if (typeof globalThis.CSS === "undefined") {
    (globalThis as { CSS?: { escape(value: string): string } }).CSS = {
      escape(value: string) {
        return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
      },
    };
  }
}

/**
 * Runs both tagging-checklist audits against one already-rendered page, given its serialized
 * HTML (not a live DOM reference - the CLI gets this from Playwright's `page.content()`, since
 * these pure audit functions only need DOM structure, not live reactive state, and running them
 * this way avoids the real constraint found while fixing docs/prompts/cinder-tagging-checklist.md
 * this session: a bare `import 'cinder'` doesn't resolve inside `page.evaluate()`, since that
 * isn't a bundled module context).
 */
export function auditRenderedPage(
  url: string,
  html: string,
  liveGraphSnapshot: CinderGraphSnapshot | undefined,
  redirectedFrom?: string,
): PageFindings {
  ensureCssPolyfill();

  const dom = new JSDOM(html, { url, virtualConsole: SILENT_VIRTUAL_CONSOLE });
  const untagged = auditUntaggedElements(dom.window.document);
  const weakLabels = liveGraphSnapshot ? auditLabelQuality(liveGraphSnapshot) : [];

  return { url, untagged, weakLabels, redirectedFrom };
}
