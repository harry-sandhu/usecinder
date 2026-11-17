import type { CinderGraphNode, CinderGraphSnapshot } from "../../types.js";

/**
 * Motivated by tier 3's prompt being enriched with each real candidate's label
 * (docs/known-limitations.md §27), specifically to help disambiguate similar-sounding
 * candidates - which only works if the label actually carries information beyond the key. If
 * an element's accessible name on the page was never set, Cinder's scanner falls back to
 * echoing the raw key back as the "label," which looks like a label but isn't one. No amount
 * of prompt engineering can disambiguate two candidates that are genuinely both just called
 * their own key - the fix has to happen in the tagged app itself, by giving the element a real
 * `aria-label` (or associated `<label>`). This audit exists to find those nodes so a developer
 * or a coding agent can go fix them - see docs/prompts/fix-weak-cinder-labels.md for the
 * runnable prompt that uses this, including an important caution about verifying a finding
 * against a single, isolated navigation before trusting it (a rapid, scripted sweep through
 * many routes in a row was found, via real testing, to produce false positives - see that
 * prompt's own note on this).
 */
export type CinderLabelQualityIssue =
  /** No label at all - the scanner had nothing but the key/aliases to fall back to. */
  | "missing_label"
  /** The label is just the key with separators normalized away - functionally the same as no
   * label, since it carries no information a reader couldn't already get from the key itself. */
  | "label_echoes_key";

export interface CinderLabelAuditFinding {
  nodeId: string;
  key: string;
  type: CinderGraphNode["type"];
  issue: CinderLabelQualityIssue;
  currentLabel?: string;
  /** Where to find the real element in the page/DOM, if the scanner captured one - the
   * starting point for locating the source file that needs a better label. */
  selectorHint?: string;
}

function normalizeForComparison(value: string): string {
  return value.toLowerCase().replace(/[-_\s]+/g, "");
}

/**
 * Scans a real (or synthetic) graph snapshot for nodes whose label carries no real information
 * beyond their own key - see the module doc comment for why this matters for tier 3's prompt
 * quality specifically, though it's useful context for any consumer of real labels (tier 2's
 * embedding ranking, a human reading the graph, etc).
 */
export function auditLabelQuality(snapshot: CinderGraphSnapshot): CinderLabelAuditFinding[] {
  const findings: CinderLabelAuditFinding[] = [];

  for (const node of snapshot.nodes) {
    if (node.type === "app") {
      continue;
    }

    const selectorHint = node.source?.selectorHint;
    const base = { nodeId: node.id, key: node.key, type: node.type, selectorHint };

    if (!node.label || node.label.trim().length === 0) {
      findings.push({ ...base, issue: "missing_label" });
      continue;
    }

    if (normalizeForComparison(node.label) === normalizeForComparison(node.key)) {
      findings.push({ ...base, issue: "label_echoes_key", currentLabel: node.label });
    }
  }

  return findings;
}
