import type { CinderSemanticWarning, CinderTagRecord } from "../../types.js";

function getContextBucketKey(contextKey?: string): string {
  return contextKey ?? "__root__";
}

export function detectDuplicateTagRecords(
  records: CinderTagRecord[],
): CinderSemanticWarning[] {
  const warnings: CinderSemanticWarning[] = [];
  const seen = new Map<string, CinderTagRecord>();

  for (const record of records) {
    const contextBucket = getContextBucketKey(record.contextKey);
    const dedupeKey = `${record.type}::${record.key}::${contextBucket}`;

    if (seen.has(dedupeKey)) {
      if (record.type === "route") {
        continue;
      }

      warnings.push({
        code: "duplicate-key-in-context",
        type: record.type,
        attribute: record.attribute,
        key: record.key,
        contextKey: record.contextKey,
        message: `Duplicate ${record.type} key "${record.key}" found in context "${contextBucket}".`,
      });
      continue;
    }

    seen.set(dedupeKey, record);
  }

  return warnings;
}
