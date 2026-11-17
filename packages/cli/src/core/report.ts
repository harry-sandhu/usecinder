import type { CinderLabelAuditFinding, CinderUntaggedElementFinding } from "usecinder";

export interface PageFindings {
  url: string;
  untagged: CinderUntaggedElementFinding[];
  weakLabels: CinderLabelAuditFinding[];
  /** Set when the requested URL redirected here instead of loading directly - most commonly
   * an auth wall. Surfaced so the reader knows findings below are for the REDIRECT target, not
   * the page they actually asked to scan - never silently audited as if it were the same page. */
  redirectedFrom?: string;
}

function formatUntaggedFinding(finding: CinderUntaggedElementFinding): string {
  const text = finding.accessibleText ? ` "${finding.accessibleText}"` : "";
  const suggestion = finding.suggestedTag ? ` - suggested: \`${finding.suggestedTag}\`` : " - no clear suggestion, use your own judgment";
  return `- \`<${finding.tagName}>\`${text} at \`${finding.selectorHint}\`${suggestion}`;
}

function formatWeakLabelFinding(finding: CinderLabelAuditFinding): string {
  // selectorHint is genuinely undefined for a cold node with no live DOM element at all (a
  // registered route never actually visited/rendered during this crawl) - found live against
  // apps/web: rendering it with a template literal printed the literal word "undefined" into
  // the report, reading like a tool error rather than an accurate, honest state.
  const where = finding.selectorHint
    ? `at \`${finding.selectorHint}\``
    : "(no live DOM element - a registered route never visited during this crawl)";
  return `- \`${finding.key}\` (${finding.type}): ${finding.issue} - current label "${finding.currentLabel ?? ""}" ${where}`;
}

function formatPageSection(page: PageFindings): string {
  const lines: string[] = [`## ${page.url}`];

  if (page.redirectedFrom) {
    lines.push(
      "",
      `**Redirected here from \`${page.redirectedFrom}\`** - likely an auth wall. If this isn't ` +
        "the page you meant to audit, re-run with `--storage-state` pointed at an authenticated " +
        "session.",
    );
  }

  if (page.untagged.length === 0 && page.weakLabels.length === 0) {
    lines.push("", "No findings on this page.");
    return lines.join("\n");
  }

  if (page.untagged.length > 0) {
    lines.push("", "### Untagged elements", "", ...page.untagged.map(formatUntaggedFinding));
  }

  if (page.weakLabels.length > 0) {
    lines.push("", "### Weak labels", "", ...page.weakLabels.map(formatWeakLabelFinding));
  }

  return lines.join("\n");
}

/**
 * Builds the single consolidated report `cinder integrate` hands off - written to be given
 * directly to a coding agent (Claude Code, Cursor, or similar) to apply, same framing as
 * docs/prompts/cinder-tagging-checklist.md, which this intentionally doesn't replace: it
 * automates the DISCOVERY (crawling every real page, running both audits) that a developer
 * previously had to do by hand before a coding agent could act, while leaving the actual
 * judgment calls (which suggestion is real, what to name each key) to the agent and a human
 * review, exactly as the existing prompts already insist on.
 */
export function buildIntegrationReport(pages: PageFindings[]): string {
  const totalUntagged = pages.reduce((sum, page) => sum + page.untagged.length, 0);
  const totalWeakLabels = pages.reduce((sum, page) => sum + page.weakLabels.length, 0);

  const header = [
    "# Cinder integration report",
    "",
    `Scanned ${pages.length} page(s): ${totalUntagged} untagged element finding(s), ${totalWeakLabels} weak-label finding(s).`,
    "",
    "Hand this file to a coding agent working in this repository (Claude Code, Cursor, or " +
      "similar). For each finding below:",
    "",
    "- **Untagged elements**: confirm the element's real purpose before tagging it - the " +
      "suggested tag is a best-effort guess from its HTML shape, not a verified classification. " +
      "Some findings are correctly NOT a Cinder candidate at all (a cosmetic toggle, a link to " +
      "an external site) - skip those.",
    "- **Weak labels**: write a real, human label and apply it - prefer the most central place " +
      "possible (a route/field/action registry file, if this app has one) over hunting down " +
      "every individual tagged element.",
    "",
    "Full detail on both checks: `docs/prompts/cinder-tagging-checklist.md` in the Cinder repo.",
    "",
    "**Caution inherited from that checklist, still true here**: a rapid sweep through many " +
      "pages in quick succession can occasionally catch a page before its accessible name has " +
      "fully settled. This report paused between page loads specifically to avoid that, but " +
      "re-verify any single finding you're unsure about with an isolated check before treating " +
      "it as real.",
    "",
    "---",
    "",
  ];

  const headerBlock = header.join("\n");

  if (pages.length === 0) {
    return `${headerBlock}\nNo pages were reachable from the starting URL.`;
  }

  return [headerBlock, ...pages.map(formatPageSection)].join("\n\n");
}
