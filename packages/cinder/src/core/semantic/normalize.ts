// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
const NON_CANONICAL_SEPARATOR_PATTERN = /[^a-z0-9_-]+/g;
const DASH_TRIM_PATTERN = /^-+|-+$/g;
const CANONICAL_KEY_PATTERN = /^[a-z0-9_-]+$/;

export function normalizeSemanticKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(NON_CANONICAL_SEPARATOR_PATTERN, "-")
    .replace(/-+/g, "-")
    .replace(DASH_TRIM_PATTERN, "");
}

export function isCanonicalSemanticKey(value: string): boolean {
  return value.length > 0 && CANONICAL_KEY_PATTERN.test(value);
}

export function normalizeOptionalSemanticKey(
  value?: string | null,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = normalizeSemanticKey(value);

  return normalized || undefined;
}

export function uniqueNormalizedValues(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!value) {
      continue;
    }

    const normalized = normalizeSemanticKey(value);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}
