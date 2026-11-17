import type {
  CinderSemanticScanResult,
  CinderSemanticSource,
  CinderSemanticWarning,
  CinderTagRecord,
  CinderTagRecordResult,
} from "../../types.js";
import { createTagRecordFromSource } from "./tagRecord.js";
import {
  createEmptySemanticScanResult,
  formatSemanticScanDebugSummary,
  scanSemanticTree,
} from "./tagScanner.js";
import { detectDuplicateTagRecords } from "./validate.js";

export {
  CINDER_TAG_ATTRIBUTE_TO_TYPE,
  CINDER_V1_ATTRIBUTES,
  CINDER_V1_TYPES,
  getTagTypeForAttribute,
} from "./tagSpec.js";
export {
  isCanonicalSemanticKey,
  normalizeOptionalSemanticKey,
  normalizeSemanticKey,
  uniqueNormalizedValues,
} from "./normalize.js";
export { createTagRecord, createTagRecordFromSource } from "./tagRecord.js";
export {
  createEmptySemanticScanResult,
  formatSemanticScanDebugSummary,
  scanSemanticTree,
} from "./tagScanner.js";
export { detectDuplicateTagRecords } from "./validate.js";

export interface CinderSemanticModule {
  kind: "semantic";
  createTagRecord(source: CinderSemanticSource): CinderTagRecordResult;
  detectDuplicateTagRecords(records: CinderTagRecord[]): CinderSemanticWarning[];
  scan(root?: ParentNode | Document): CinderSemanticScanResult;
  createEmptyScanResult(): CinderSemanticScanResult;
  formatDebugSummary(scanResult: CinderSemanticScanResult): string;
}

export function createSemanticModule(): CinderSemanticModule {
  return {
    kind: "semantic",
    createTagRecord(source) {
      return createTagRecordFromSource(source);
    },
    detectDuplicateTagRecords(records) {
      return detectDuplicateTagRecords(records);
    },
    scan(root) {
      return scanSemanticTree(root);
    },
    createEmptyScanResult() {
      return createEmptySemanticScanResult();
    },
    formatDebugSummary(scanResult) {
      return formatSemanticScanDebugSummary(scanResult);
    },
  };
}
