// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
export type CinderTagType =
  | "context"
  | "route"
  | "entity"
  | "field"
  | "filter"
  | "action"
  | "output"
  | "data";

export type CinderTagAttributeName =
  | "cinder-context"
  | "cinder-route"
  | "cinder-entity"
  | "cinder-field"
  | "cinder-filter"
  | "cinder-action"
  | "cinder-output"
  | "cinder-data";

export interface CinderTagMetadata {
  label?: string;
  accessibleName?: string;
  placeholder?: string;
  textContent?: string;
  aliases?: string[];
  href?: string;
  role?: string;
  ariaCurrent?: string;
  routePath?: string;
  routeSelector?: string;
  submit?: boolean;
  control?: string;
  optionSelector?: string;
  name?: string;
  inputType?: string;
  value?: string;
  /**
   * Keys of output nodes this field/filter/action influences, declared via
   * `data-cinder-affects="<output-key> [<output-key> ...]"`. Resolved into real "filters"
   * graph edges once all nodes exist - see getOutputsAffectedBy in
   * cinder's core/cag/graphBuilder.ts.
   */
  affects?: string[];
  /**
   * Keys of field/filter nodes this action (or output) requires to be set first, declared
   * via `data-cinder-depends-on="<key> [<key> ...]"`. Resolved into real "depends_on" graph
   * edges - see getDependenciesOf in cinder's core/cag/graphBuilder.ts.
   */
  dependsOn?: string[];
  /**
   * The route key this action navigates to, declared via
   * `data-cinder-navigates-to="<route-key>"` - e.g. a "View details" action that opens a
   * detail page. Singular, unlike affects/dependsOn's lists, since one action leads to one
   * place. Resolved into a real "navigates_to" graph edge - see getNavigationTargetOf in
   * cinder's core/cag/graphBuilder.ts. Most actions have no navigation target at all, which
   * is the normal case, not a gap.
   */
  navigatesTo?: string;
  /**
   * For a `cinder-field`/`cinder-filter` backed by a real `<select>`: the visible text of
   * each `<option>`, in document order. Lets a value-only command ("filter by overdue") find
   * which filter actually offers that value, without the sentence needing to name the
   * filter itself.
   */
  options?: string[];
  [key: string]: unknown;
}

export interface CinderTagRecord {
  type: CinderTagType;
  attribute: CinderTagAttributeName;
  key: string;
  label?: string;
  aliases: string[];
  contextKey?: string;
  routeKey?: string;
  metadata?: CinderTagMetadata;
}

export interface CinderSemanticSource {
  attributes: Partial<Record<CinderTagAttributeName, string | null | undefined>>;
  metadata?: CinderTagMetadata;
  contextKey?: string;
  routeKey?: string;
}

export type CinderSemanticWarningCode =
  | "empty-key"
  | "noncanonical-key"
  | "multiple-primary-tags"
  | "duplicate-key-in-context"
  | "no-dom-root";

export interface CinderSemanticWarning {
  code: CinderSemanticWarningCode;
  message: string;
  type?: CinderTagType;
  attribute?: CinderTagAttributeName;
  key?: string;
  contextKey?: string;
}

export interface CinderTagRecordResult {
  record?: CinderTagRecord;
  warnings: CinderSemanticWarning[];
}

export interface CinderSemanticNodeSource {
  tagName: string;
  elementId?: string;
  selectorHint?: string;
}

export interface CinderSemanticScanEntry {
  record: CinderTagRecord;
  source: CinderSemanticNodeSource;
}

export interface CinderSemanticScanSummary {
  totalTaggedElements: number;
  warningCount: number;
  byType: Record<CinderTagType, number>;
}

export interface CinderSemanticScanResult {
  scannedAt: string;
  entries: CinderSemanticScanEntry[];
  warnings: CinderSemanticWarning[];
  summary: CinderSemanticScanSummary;
}
