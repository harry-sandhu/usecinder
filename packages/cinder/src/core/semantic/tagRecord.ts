// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import type {
  CinderSemanticSource,
  CinderSemanticWarning,
  CinderTagAttributeName,
  CinderTagMetadata,
  CinderTagRecord,
  CinderTagRecordResult,
  CinderTagType,
} from "../../types.js";
import { normalizeOptionalSemanticKey, normalizeSemanticKey, uniqueNormalizedValues } from "./normalize.js";
import { CINDER_V1_ATTRIBUTES, getTagTypeForAttribute } from "./tagSpec.js";

/**
 * Container types whose DOM element typically wraps other tagged elements
 * (e.g. a cinder-route <section> containing its own field/action/output
 * children). textContent for these is the concatenation of everything
 * nested inside - not a meaningful identity for the container itself - so
 * it must not be used as a label/alias fallback. A leaf type's own
 * textContent (a button's label, an output's displayed text) is its actual
 * identity and stays a legitimate fallback.
 *
 * Found via a real bug: a <section cinder-route="reports"> containing a
 * "Save" button and a "Price" output derived the label "Save Price" and
 * the alias "save-price" from its full textContent, which then fuzzy-
 * matched the unrelated term "price" at a high enough score to be treated
 * as a confident (and wrongly hardcoded 0.95-confidence) route match.
 */
const TEXT_CONTENT_UNSAFE_TAG_TYPES = new Set<CinderTagType>(["route", "context"]);

function deriveLabel(metadata: CinderTagMetadata | undefined, type: CinderTagType): string | undefined {
  const textContentCandidate = TEXT_CONTENT_UNSAFE_TAG_TYPES.has(type) ? undefined : metadata?.textContent;

  return [metadata?.label, metadata?.accessibleName, textContentCandidate, metadata?.placeholder]
    .map((value) => value?.trim())
    .find((value) => Boolean(value));
}

function isUsefulAliasCandidate(value?: string): boolean {
  if (!value) {
    return false;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return false;
  }

  const wordCount = trimmed.split(/\s+/).length;

  return trimmed.length <= 40 && wordCount <= 4;
}

function getPathAliasCandidates(path?: string): string[] {
  const trimmedPath = path?.trim();

  if (!trimmedPath || !trimmedPath.startsWith("/")) {
    return [];
  }

  const sanitizedPath = trimmedPath.split(/[?#]/, 1)[0] ?? trimmedPath;
  const segments = sanitizedPath
    .split("/")
    .map((segment) => segment.replace(/[-_]+/g, " ").trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return [];
  }

  return [segments.join(" "), segments[segments.length - 1]!];
}

function getTerminalSymbolAliasCandidates(value?: string): string[] {
  const trimmed = value?.trim();

  if (!trimmed) {
    return [];
  }

  const parts = trimmed
    .split(/(?:::|[./#])/g)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    return [];
  }

  return [parts.join(" "), parts[parts.length - 1]!];
}

function deriveAliases(key: string, metadata: CinderTagMetadata | undefined, type: CinderTagType): string[] {
  const label = deriveLabel(metadata, type);
  const textContentCandidate = TEXT_CONTENT_UNSAFE_TAG_TYPES.has(type) ? undefined : metadata?.textContent;
  const labelCandidates = [
    label,
    metadata?.accessibleName,
    metadata?.placeholder,
    textContentCandidate,
    ...(metadata?.aliases ?? []),
  ].filter((value): value is string => isUsefulAliasCandidate(value));

  const pathCandidates = [
    ...getPathAliasCandidates(metadata?.routePath),
    ...getPathAliasCandidates(metadata?.href),
  ].filter((value) => isUsefulAliasCandidate(value));

  const symbolCandidates = labelCandidates
    .flatMap((value) => getTerminalSymbolAliasCandidates(value))
    .filter((value) => isUsefulAliasCandidate(value));

  return uniqueNormalizedValues([key, ...labelCandidates, ...pathCandidates, ...symbolCandidates]);
}

function createNonCanonicalKeyWarning(
  rawValue: string,
  normalized: string,
  attribute: CinderTagAttributeName,
): CinderSemanticWarning {
  return {
    code: "noncanonical-key",
    attribute,
    key: normalized,
    message: `Normalized semantic key for ${attribute} from "${rawValue}" to "${normalized}".`,
  };
}

function getDefinedAttributes(
  source: CinderSemanticSource,
): CinderTagAttributeName[] {
  return CINDER_V1_ATTRIBUTES.filter((attribute) => {
    const value = source.attributes[attribute];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export function createTagRecordFromSource(
  source: CinderSemanticSource,
): CinderTagRecordResult {
  const warnings: CinderSemanticWarning[] = [];
  const definedAttributes = getDefinedAttributes(source);

  if (definedAttributes.length === 0) {
    return { warnings };
  }

  if (definedAttributes.length > 1) {
    warnings.push({
      code: "multiple-primary-tags",
      message: `A single element should only define one primary Cinder tag, but found: ${definedAttributes.join(
        ", ",
      )}.`,
    });

    return { warnings };
  }

  const attribute = definedAttributes[0]!;
  const rawKey = source.attributes[attribute];

  if (!rawKey || !rawKey.trim()) {
    warnings.push({
      code: "empty-key",
      attribute,
      message: `The ${attribute} attribute is present but empty.`,
    });

    return { warnings };
  }

  const normalizedKey = normalizeSemanticKey(rawKey);

  if (!normalizedKey) {
    warnings.push({
      code: "empty-key",
      attribute,
      message: `The ${attribute} attribute does not contain a usable semantic key.`,
    });

    return { warnings };
  }

  if (normalizedKey !== rawKey.trim()) {
    warnings.push(createNonCanonicalKeyWarning(rawKey, normalizedKey, attribute));
  }

  const tagType = getTagTypeForAttribute(attribute);

  const record: CinderTagRecord = {
    type: tagType,
    attribute,
    key: normalizedKey,
    label: deriveLabel(source.metadata, tagType),
    aliases: deriveAliases(normalizedKey, source.metadata, tagType),
    contextKey: normalizeOptionalSemanticKey(source.contextKey),
    routeKey: normalizeOptionalSemanticKey(source.routeKey),
    metadata: source.metadata,
  };

  return {
    record,
    warnings,
  };
}

export function createTagRecord(
  attribute: CinderTagAttributeName,
  key: string,
  metadata?: CinderTagMetadata,
  scope?: { contextKey?: string; routeKey?: string },
): CinderTagRecordResult {
  return createTagRecordFromSource({
    attributes: {
      [attribute]: key,
    },
    metadata,
    contextKey: scope?.contextKey,
    routeKey: scope?.routeKey,
  });
}
