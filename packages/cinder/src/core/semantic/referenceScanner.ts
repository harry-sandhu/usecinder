import type { CinderSemanticNodeSource } from "../../types.js";
import { escapeCssIdentifier } from "../dom/realm.js";
import { normalizeSemanticKey, uniqueNormalizedValues } from "./normalize.js";

export interface CinderInternalRouteReference {
  key: string;
  path: string;
  label?: string;
  aliases: string[];
  source: CinderSemanticNodeSource;
}

const GENERIC_LABEL_CANDIDATES = new Set([
  "click here",
  "here",
  "read more",
  "learn more",
  "more",
  "details",
  "open",
  "view",
  "show",
  "link",
]);

function getRootQueryTarget(root?: ParentNode | Document): ParentNode | Document | null {
  if (root) {
    return root;
  }

  if (typeof document !== "undefined") {
    return document;
  }

  return null;
}

function getTextContent(element: Element): string | undefined {
  const text = element.textContent?.replace(/\s+/g, " ").trim();
  return text || undefined;
}

function isUsefulLabelCandidate(value?: string): value is string {
  if (!value) {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  return !GENERIC_LABEL_CANDIDATES.has(trimmed.toLowerCase());
}

function getPathAliasCandidates(path: string): string[] {
  const segments = path
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
    .map((part) => part.replace(/\(\)$/g, "").trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    return [];
  }

  return [parts.join(" "), parts[parts.length - 1]!];
}

function looksLikeApiReference(path: string, labelCandidates: string[]): boolean {
  if (path.includes("/api/")) {
    return true;
  }

  return labelCandidates.some((candidate) => /(^|\s)cinder\.|\(\)$/.test(candidate.toLowerCase()));
}

function createMethodStyleAliases(path: string, labelCandidates: string[]): string[] {
  if (!looksLikeApiReference(path, labelCandidates)) {
    return [];
  }

  const terminalCandidate = [...labelCandidates]
    .flatMap((candidate) => getTerminalSymbolAliasCandidates(candidate))
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .at(-1);

  if (!terminalCandidate) {
    return [];
  }

  return [
    `${terminalCandidate} method`,
    `${terminalCandidate} api`,
    `api ${terminalCandidate}`,
    `method ${terminalCandidate}`,
  ];
}

function deriveReferenceAliases(path: string, labelCandidates: string[]): string[] {
  return uniqueNormalizedValues([
    ...labelCandidates,
    ...getPathAliasCandidates(path),
    ...labelCandidates.flatMap((candidate) => getTerminalSymbolAliasCandidates(candidate)),
    ...createMethodStyleAliases(path, labelCandidates),
  ]);
}

function resolveInternalPath(element: Element, href: string): string | undefined {
  const trimmedHref = href.trim();

  if (!trimmedHref || trimmedHref.startsWith("#")) {
    return undefined;
  }

  if (/^(mailto:|tel:|javascript:|data:)/i.test(trimmedHref)) {
    return undefined;
  }

  const defaultView = element.ownerDocument?.defaultView;
  const baseHref = defaultView?.location.href ?? element.ownerDocument?.baseURI;

  if (!baseHref) {
    return undefined;
  }

  try {
    const url = new URL(trimmedHref, baseHref);
    const origin = defaultView?.location.origin ?? new URL(baseHref).origin;

    if (url.origin !== origin) {
      return undefined;
    }

    return `${url.pathname}${url.search}`;
  } catch {
    return undefined;
  }
}

function createSelectorHint(element: Element, href: string): string {
  const id = element.getAttribute("id")?.trim();

  if (id) {
    return `#${escapeCssIdentifier(id, element.ownerDocument ?? element)}`;
  }

  const safeHref = href.replace(/"/g, '\\"');
  return `a[href="${safeHref}"]`;
}

function createReferenceKey(path: string): string {
  const candidate = path === "/"
    ? "home"
    : path
      .replace(/^\//, "")
      .replace(/[/?=&]+/g, "-")
      .replace(/-+/g, "-");

  return normalizeSemanticKey(candidate) || "route";
}

export function scanInternalLinkRouteReferences(
  root?: ParentNode | Document,
): CinderInternalRouteReference[] {
  const target = getRootQueryTarget(root);

  if (!target || typeof (target as ParentNode).querySelectorAll !== "function") {
    return [];
  }

  const references = new Map<string, CinderInternalRouteReference>();
  const anchors = Array.from(target.querySelectorAll("a[href]"));

  for (const anchor of anchors) {
    if (anchor.getAttribute("cinder-route")?.trim()) {
      continue;
    }

    const href = anchor.getAttribute("href")?.trim();
    if (!href) {
      continue;
    }

    const path = resolveInternalPath(anchor, href);
    if (!path) {
      continue;
    }

    const labelCandidates = [
      getTextContent(anchor),
      anchor.getAttribute("aria-label")?.trim() || undefined,
      anchor.getAttribute("title")?.trim() || undefined,
    ].filter((value): value is string => isUsefulLabelCandidate(value));

    const aliases = deriveReferenceAliases(path, labelCandidates);
    const existing = references.get(path);

    if (existing) {
      existing.aliases = uniqueNormalizedValues([...existing.aliases, ...aliases]);
      continue;
    }

    references.set(path, {
      key: createReferenceKey(path),
      path,
      label: labelCandidates[0],
      aliases,
      source: {
        tagName: anchor.tagName.toLowerCase(),
        elementId: anchor.getAttribute("id")?.trim() || undefined,
        selectorHint: createSelectorHint(anchor, href),
      },
    });
  }

  return [...references.values()];
}
