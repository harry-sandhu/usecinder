// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { CINDER_V1_ATTRIBUTES } from "../semantic/index.js";

/**
 * Found necessary by real testing (docs/known-limitations.md's label-quality entry): the label
 * audit (labelAudit.ts) only ever sees elements that are ALREADY tagged - a real interactive
 * element with no `cinder-*` attribute at all never makes it into the graph, so it's invisible
 * to every other Cinder tool, and to tier 1/2/3 alike. This is the other half of the checklist:
 * find real interactive elements on a live page that look like they should be tagged but
 * aren't, so a developer or coding agent can go add the real tag - see
 * docs/prompts/tag-untagged-cinder-elements.md for the runnable prompt that uses this.
 */
export type CinderSuggestedTag = "cinder-route" | "cinder-action" | "cinder-field" | "cinder-filter" | "cinder-output";

export interface CinderUntaggedElementFinding {
  tagName: string;
  /** Best-effort accessible text - aria-label if present, else visible text content. Purely
   * advisory context for a human/agent deciding what the real tag and label should be. */
  accessibleText?: string;
  selectorHint: string;
  /** A best-effort guess at which attribute probably fits, based on the element's tag/type -
   * never apply this blindly; it's a starting point for a human or agent to confirm, not a
   * verified classification (a `<button>` that opens a dialog isn't really a "cinder-action"
   * in the sense of triggering a real command, for example - that judgment needs real context
   * this function doesn't have). */
  suggestedTag?: CinderSuggestedTag;
}

const DEFAULT_CANDIDATE_SELECTOR =
  "a[href], button, input, select, textarea, [role='button'], [role='link'], [role='menuitem']";

/** Ancestors within this many levels also count as "already tagged" - an untagged interactive
 * element nested inside an already-tagged container (e.g. an icon-only <button> inside a
 * cinder-action wrapper, or an <input> inside a cinder-filter group) is usually just part of
 * that control, not a separate thing that itself needs tagging. */
const ANCESTOR_CHECK_DEPTH = 3;

function hasAnyCinderAttribute(element: Element): boolean {
  return CINDER_V1_ATTRIBUTES.some((attribute) => element.hasAttribute(attribute));
}

function isAlreadyTagged(element: Element): boolean {
  if (hasAnyCinderAttribute(element)) {
    return true;
  }

  let current = element.parentElement;
  let depth = 0;

  while (current && depth < ANCESTOR_CHECK_DEPTH) {
    if (hasAnyCinderAttribute(current)) {
      return true;
    }

    current = current.parentElement;
    depth += 1;
  }

  return false;
}

function isLikelyNoise(element: Element): boolean {
  if (element.getAttribute("aria-hidden") === "true") {
    return true;
  }

  if (element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") {
    return true;
  }

  const tagName = element.tagName.toLowerCase();

  if (tagName === "input") {
    const type = (element.getAttribute("type") ?? "text").toLowerCase();

    if (type === "hidden") {
      return true;
    }

    // Found via real testing against a real app's change-password form: a password field
    // should never be suggested as a Cinder field. Letting a semantic command engine set a
    // password's value is a real security/UX anti-pattern, not just an edge case to skip for
    // noise - this exclusion is deliberate, not an oversight to revisit later.
    if (type === "password") {
      return true;
    }
  }

  return false;
}

function suggestTagFor(element: Element): CinderSuggestedTag | undefined {
  const tagName = element.tagName.toLowerCase();

  if (tagName === "a") {
    const href = element.getAttribute("href")?.trim() ?? "";
    const looksLikeRealNavigation = href.length > 0 && !href.startsWith("#") && !href.toLowerCase().startsWith("javascript:");
    return looksLikeRealNavigation ? "cinder-route" : "cinder-action";
  }

  if (tagName === "button" || element.getAttribute("role") === "button" || element.getAttribute("role") === "menuitem") {
    return "cinder-action";
  }

  if (tagName === "select") {
    return "cinder-filter";
  }

  if (tagName === "input") {
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    return type === "checkbox" || type === "radio" ? "cinder-filter" : "cinder-field";
  }

  if (tagName === "textarea") {
    return "cinder-field";
  }

  return undefined;
}

function escapeIdentifier(value: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function nthOfTypeIndex(element: Element): number {
  let index = 1;
  let sibling = element.previousElementSibling;

  while (sibling) {
    if (sibling.tagName === element.tagName) {
      index += 1;
    }

    sibling = sibling.previousElementSibling;
  }

  return index;
}

/** A reasonably stable CSS selector for a general, possibly-untagged element - simpler than the
 * real scanner's own createSelectorHint (tagScanner.ts), which anchors on a known cinder-*
 * attribute this element by definition doesn't have. Good enough for a developer or agent to
 * locate the real element afterward, not guaranteed unique in every possible DOM shape. */
function buildSelectorHint(element: Element): string {
  const id = element.getAttribute("id")?.trim();

  if (id) {
    return `#${escapeIdentifier(id)}`;
  }

  const segments: string[] = [];
  let current: Element | null = element;
  let depth = 0;

  while (current && depth < 5) {
    const currentId = current.getAttribute("id")?.trim();

    if (currentId) {
      segments.unshift(`#${escapeIdentifier(currentId)}`);
      break;
    }

    segments.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${nthOfTypeIndex(current)})`);
    current = current.parentElement;
    depth += 1;
  }

  return segments.join(" > ");
}

/**
 * Scans a live page (or a subtree) for real interactive elements that look like they should
 * have a `cinder-*` tag but don't - see the module doc comment for why this matters. Call it on
 * a real running app, via a browser console or Playwright's page.evaluate(), not on a static
 * snapshot (untagged elements never appear in a Cinder graph snapshot at all).
 */
export function auditUntaggedElements(root: ParentNode = document): CinderUntaggedElementFinding[] {
  const candidates = Array.from(root.querySelectorAll(DEFAULT_CANDIDATE_SELECTOR));
  const findings: CinderUntaggedElementFinding[] = [];

  for (const element of candidates) {
    if (isLikelyNoise(element) || isAlreadyTagged(element)) {
      continue;
    }

    const accessibleText = element.getAttribute("aria-label")?.trim() || element.textContent?.trim() || undefined;

    findings.push({
      tagName: element.tagName.toLowerCase(),
      accessibleText,
      selectorHint: buildSelectorHint(element),
      suggestedTag: suggestTagFor(element),
    });
  }

  return findings;
}
