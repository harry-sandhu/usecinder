import type {
  CinderSemanticNodeSource,
  CinderSemanticScanEntry,
  CinderSemanticScanResult,
  CinderSemanticSource,
  CinderSemanticWarning,
  CinderTagAttributeName,
  CinderTagMetadata,
  CinderTagType,
} from "../../types.js";
import {
  escapeCssIdentifier,
  getControlLabels,
  getPlaceholderProperty,
  isSelectElement,
} from "../dom/realm.js";
import { createTagRecordFromSource } from "./tagRecord.js";
import { normalizeOptionalSemanticKey, normalizeSemanticKey } from "./normalize.js";
import { CINDER_V1_ATTRIBUTES, CINDER_V1_TYPES } from "./tagSpec.js";
import { detectDuplicateTagRecords } from "./validate.js";

const TAG_SELECTOR = CINDER_V1_ATTRIBUTES.map((attribute) => `[${attribute}]`).join(", ");

function createEmptySummary(): Record<CinderTagType, number> {
  return {
    context: 0,
    route: 0,
    entity: 0,
    field: 0,
    filter: 0,
    action: 0,
    output: 0,
    data: 0,
  };
}

export function createEmptySemanticScanResult(): CinderSemanticScanResult {
  return {
    scannedAt: new Date().toISOString(),
    entries: [],
    warnings: [],
    summary: {
      totalTaggedElements: 0,
      warningCount: 0,
      byType: createEmptySummary(),
    },
  };
}

function getRootQueryTarget(root?: ParentNode | Document): ParentNode | Document | null {
  if (root) {
    return root;
  }

  if (typeof document !== "undefined") {
    return document;
  }

  return null;
}

function findTaggedElements(root?: ParentNode | Document): Element[] {
  const target = getRootQueryTarget(root);

  if (!target || typeof (target as ParentNode).querySelectorAll !== "function") {
    return [];
  }

  return Array.from(target.querySelectorAll(TAG_SELECTOR));
}

function getAttributeValue(
  element: Element,
  attribute: CinderTagAttributeName,
): string | undefined {
  const value = element.getAttribute(attribute);
  return value?.trim() || undefined;
}

function findNearestAncestorKey(
  element: Element | null,
  attribute: CinderTagAttributeName,
): string | undefined {
  let current = element;

  while (current) {
    const value = getAttributeValue(current, attribute);

    if (value) {
      return normalizeSemanticKey(value);
    }

    current = current.parentElement;
  }

  return undefined;
}

function findAncestorKeyPath(
  element: Element | null,
  attribute: CinderTagAttributeName,
): string[] {
  const path: string[] = [];
  let current = element;

  while (current) {
    const value = getAttributeValue(current, attribute);

    if (value) {
      path.push(normalizeSemanticKey(value));
    }

    current = current.parentElement;
  }

  return path.reverse();
}

function getAssociatedLabelText(element: Element): string | undefined {
  const labels = getControlLabels(element);
  const directLabel = labels?.[0]?.textContent?.trim();
  if (directLabel) {
    return directLabel;
  }

  const id = element.getAttribute("id");
  const ownerDocument = element.ownerDocument;

  if (!id || !ownerDocument) {
    return undefined;
  }

  const label = ownerDocument.querySelector(`label[for="${escapeCssIdentifier(id, ownerDocument)}"]`);
  return label?.textContent?.trim() || undefined;
}

function getPlaceholder(element: Element): string | undefined {
  const placeholder = getPlaceholderProperty(element) ?? element.getAttribute("placeholder")?.trim();
  return placeholder || undefined;
}

/**
 * A `<select>` has no meaningful "own" text the way a button/link/output div does -
 * `element.textContent` concatenates EVERY `<option>`'s text with no separator at all (real
 * JSX output has no whitespace between sibling elements), so a filter offering "Day"/"Week"/
 * "Half month"/"Month"/"Quarter"/"Custom" got the label/alias candidate
 * "DayWeekHalf monthMonthQuarterCustom" - a single garbled, useless alias that could even
 * collide with a real user phrase by sharing a substring ("custom"). Found via real testing
 * against the rupeey CRM, not anticipated in advance. A select's real content is already
 * modeled correctly and separately via getSelectOptionLabels/metadata.options - this function
 * excluding selects isn't losing anything, since nothing useful was ever being captured here
 * for them to begin with.
 */
function getTextContent(element: Element): string | undefined {
  if (isSelectElement(element)) {
    return undefined;
  }

  const text = element.textContent?.replace(/\s+/g, " ").trim();
  return text || undefined;
}

/**
 * Reads via querySelectorAll/textContent rather than the HTMLSelectElement `.options`
 * property, which stays correct across realms (an element from a different window/iframe
 * than the one this code loaded in isn't an `instanceof` match for this realm's prototypes -
 * see validate-cross-realm-dom.mjs for why every DOM check in this scanner works this way).
 */
function getSelectOptionLabels(element: Element): string[] | undefined {
  if (!isSelectElement(element)) {
    return undefined;
  }

  const labels = Array.from(element.querySelectorAll("option"))
    .map((option) => option.textContent?.replace(/\s+/g, " ").trim())
    .filter((label): label is string => Boolean(label));

  return labels.length > 0 ? labels : undefined;
}

function deriveMetadata(element: Element): CinderTagMetadata {
  const label =
    getAssociatedLabelText(element) ||
    element.getAttribute("aria-label")?.trim() ||
    undefined;

  const accessibleName =
    element.getAttribute("aria-label")?.trim() ||
    element.getAttribute("title")?.trim() ||
    undefined;

  const routePath =
    element.getAttribute("data-cinder-path")?.trim() ||
    element.getAttribute("data-cinder-route-path")?.trim() ||
    undefined;

  const routeSelector =
    element.getAttribute("data-cinder-route-selector")?.trim() ||
    undefined;

  const affectsRaw = element.getAttribute("data-cinder-affects")?.trim();
  const affects = affectsRaw
    ? affectsRaw.split(/[\s,]+/).filter((key) => key.length > 0)
    : undefined;

  const dependsOnRaw = element.getAttribute("data-cinder-depends-on")?.trim();
  const dependsOn = dependsOnRaw
    ? dependsOnRaw.split(/[\s,]+/).filter((key) => key.length > 0)
    : undefined;

  const navigatesTo = element.getAttribute("data-cinder-navigates-to")?.trim() || undefined;

  return {
    label,
    accessibleName,
    placeholder: getPlaceholder(element),
    textContent: getTextContent(element),
    href: element.getAttribute("href")?.trim() || undefined,
    role: element.getAttribute("role")?.trim() || undefined,
    ariaCurrent: element.getAttribute("aria-current")?.trim() || undefined,
    routePath,
    routeSelector,
    submit: element.getAttribute("data-cinder-submit")?.trim() === "true",
    control: element.getAttribute("data-cinder-control")?.trim() || undefined,
    optionSelector: element.getAttribute("data-cinder-option-selector")?.trim() || undefined,
    name: element.getAttribute("name")?.trim() || undefined,
    inputType: element.getAttribute("type")?.trim() || undefined,
    value: element.getAttribute("value")?.trim() || undefined,
    affects,
    dependsOn,
    navigatesTo,
    options: getSelectOptionLabels(element),
  };
}

function getNthOfTypeIndex(element: Element): number {
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

function createSelectorHint(
  element: Element,
  attribute: CinderTagAttributeName,
  key: string,
): string {
  const id = element.getAttribute("id")?.trim();

  if (id) {
    return `#${escapeCssIdentifier(id, element.ownerDocument ?? element)}`;
  }

  const segments: string[] = [];
  let current: Element | null = element;

  while (current) {
    const currentId = current.getAttribute("id")?.trim();

    if (currentId) {
      segments.unshift(`#${escapeCssIdentifier(currentId, current.ownerDocument ?? current)}`);
      break;
    }

    const tagName = current.tagName.toLowerCase();
    const nthOfType = getNthOfTypeIndex(current);
    const hasSameTypeSibling = Boolean(current.previousElementSibling || current.nextElementSibling);
    const isPrimaryElement = current === element;

    let segment = tagName;

    if (isPrimaryElement) {
      segment += `[${attribute}="${key}"]`;
    }

    if (hasSameTypeSibling) {
      segment += `:nth-of-type(${nthOfType})`;
    }

    segments.unshift(segment);
    current = current.parentElement;
  }

  return segments.join(" > ");
}

function getPrimaryAttribute(
  element: Element,
): CinderTagAttributeName | undefined {
  for (const attribute of CINDER_V1_ATTRIBUTES) {
    if (getAttributeValue(element, attribute)) {
      return attribute;
    }
  }

  return undefined;
}

function createSemanticSourceFromElement(element: Element): CinderSemanticSource {
  const attributes = Object.fromEntries(
    CINDER_V1_ATTRIBUTES.map((attribute) => [attribute, element.getAttribute(attribute)]),
  ) as CinderSemanticSource["attributes"];

  const ownRoute = getAttributeValue(element, "cinder-route");
  const contextPath = findAncestorKeyPath(element.parentElement, "cinder-context");

  return {
    attributes,
    metadata: {
      ...deriveMetadata(element),
      ...(contextPath.length > 0 ? { contextPath } : {}),
    },
    contextKey: findNearestAncestorKey(element.parentElement, "cinder-context"),
    routeKey: normalizeOptionalSemanticKey(
      ownRoute ?? findNearestAncestorKey(element.parentElement, "cinder-route"),
    ),
  };
}

function createScanEntry(
  element: Element,
  result: ReturnType<typeof createTagRecordFromSource>,
): CinderSemanticScanEntry | undefined {
  if (!result.record) {
    return undefined;
  }

  const source: CinderSemanticNodeSource = {
    tagName: element.tagName.toLowerCase(),
    elementId: element.getAttribute("id")?.trim() || undefined,
    selectorHint: createSelectorHint(
      element,
      result.record.attribute,
      result.record.key,
    ),
  };

  return {
    record: result.record,
    source,
  };
}

function createNoDomWarning(): CinderSemanticWarning {
  return {
    code: "no-dom-root",
    message:
      "No DOM root is available for semantic scanning. Provide a document/root or run in a browser environment.",
  };
}

export function scanSemanticTree(
  root?: ParentNode | Document,
): CinderSemanticScanResult {
  const result = createEmptySemanticScanResult();
  const target = getRootQueryTarget(root);

  if (!target) {
    result.warnings.push(createNoDomWarning());
    result.summary.warningCount = result.warnings.length;
    return result;
  }

  const elements = findTaggedElements(target);

  for (const element of elements) {
    const semanticSource = createSemanticSourceFromElement(element);
    const recordResult = createTagRecordFromSource(semanticSource);

    result.warnings.push(...recordResult.warnings);

    const entry = createScanEntry(element, recordResult);

    if (!entry) {
      continue;
    }

    result.entries.push(entry);
    result.summary.byType[entry.record.type] += 1;
  }

  const duplicateWarnings = detectDuplicateTagRecords(
    result.entries.map((entry) => entry.record),
  );

  result.warnings.push(...duplicateWarnings);
  result.summary.totalTaggedElements = elements.length;
  result.summary.warningCount = result.warnings.length;

  return result;
}

export function formatSemanticScanDebugSummary(
  scanResult: CinderSemanticScanResult,
): string {
  const byTypeSummary = CINDER_V1_TYPES.map(
    (type) => `${type}=${scanResult.summary.byType[type]}`,
  ).join(", ");

  return [
    `Cinder semantic scan @ ${scanResult.scannedAt}`,
    `tagged=${scanResult.summary.totalTaggedElements}`,
    `warnings=${scanResult.summary.warningCount}`,
    byTypeSummary,
  ].join(" | ");
}
