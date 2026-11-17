// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import type { CinderGraphNode, CinderSemanticNodeSource } from "../../types.js";
import { escapeCssIdentifier } from "./realm.js";

function getQueryRoot(root?: ParentNode | Document): ParentNode | Document | null {
  if (root) {
    return root;
  }

  if (typeof document !== "undefined") {
    return document;
  }

  return null;
}

function makeSourceKey(source: CinderSemanticNodeSource): string {
  return [source.tagName, source.elementId ?? "", source.selectorHint ?? ""].join("::");
}

export function getNodeSemanticSources(node?: CinderGraphNode): CinderSemanticNodeSource[] {
  const candidates = [
    ...(node?.source ? [node.source] : []),
    ...((node?.sources ?? []).filter(Boolean)),
  ];

  const seen = new Set<string>();
  const result: CinderSemanticNodeSource[] = [];

  for (const source of candidates) {
    const key = makeSourceKey(source);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(source);
  }

  return result;
}

export function resolveElementsFromNode(
  node: CinderGraphNode | undefined,
  root?: ParentNode | Document,
): Element[] {
  const target = getQueryRoot(root);
  if (!node || !target || typeof (target as ParentNode).querySelector !== "function") {
    return [];
  }

  const resolved: Element[] = [];
  const seen = new Set<Element>();

  for (const source of getNodeSemanticSources(node)) {
    if (source.elementId) {
      try {
        const byId = target.querySelector(`#${escapeCssIdentifier(source.elementId, target)}`);
        if (byId && !seen.has(byId)) {
          seen.add(byId);
          resolved.push(byId);
          continue;
        }
      } catch {
        // ignore selector resolution failures
      }
    }

    if (!source.selectorHint) {
      continue;
    }

    try {
      const bySelector = target.querySelector(source.selectorHint);
      if (bySelector && !seen.has(bySelector)) {
        seen.add(bySelector);
        resolved.push(bySelector);
      }
    } catch {
      // ignore selector resolution failures
    }
  }

  return resolved;
}

export function resolveFirstElementFromNode(
  node: CinderGraphNode | undefined,
  root?: ParentNode | Document,
): Element | null {
  return resolveElementsFromNode(node, root)[0] ?? null;
}
