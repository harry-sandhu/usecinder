// Coverage for auditLabelQuality (packages/cinder/src/core/tools/labelAudit.ts) - the detector
// behind docs/prompts/fix-weak-cinder-labels.md. Found necessary by real testing
// (docs/known-limitations.md §27): some real nodes in apps/web turned out to have no real
// label at all - the scanner fell back to echoing the raw key back as "label" - and no amount
// of tier-3 prompt engineering can disambiguate two candidates that are genuinely both just
// called their own key. This is a pure function over a snapshot, so it's tested directly
// against hand-built snapshots - no DOM/model needed.
import { auditLabelQuality } from '../packages/cinder/dist/index.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function node(overrides) {
  return { id: `${overrides.type}:${overrides.key}`, metadata: {}, ...overrides };
}

function main() {
  // 1. A node with no label at all - the real "docs-api-on-reflex" pattern once the scanner
  // had nothing to fall back to but the key.
  {
    const snapshot = { nodes: [node({ type: 'route', key: 'docs-api-on-reflex' })] };
    const findings = auditLabelQuality(snapshot);
    assert(findings.length === 1 && findings[0].issue === 'missing_label', 'Expected a node with no label to be flagged as missing_label.');
  }

  // 2. A label that's just the key with separators normalized away - functionally identical
  // to having no label, and the EXACT real bug found in apps/web.
  {
    const snapshot = { nodes: [node({ type: 'route', key: 'docs-api-on-reflex', label: 'docs-api-on-reflex' })] };
    const findings = auditLabelQuality(snapshot);
    assert(findings.length === 1 && findings[0].issue === 'label_echoes_key' && findings[0].currentLabel === 'docs-api-on-reflex', 'Expected a label identical to the key to be flagged as label_echoes_key.');
  }

  // 3. A real, informative label must NOT be flagged - the common, correct case.
  {
    const snapshot = { nodes: [node({ type: 'output', key: 'dashboard-tile-disbursed-amount', label: 'Amount disbursed: open the list' })] };
    const findings = auditLabelQuality(snapshot);
    assert(findings.length === 0, 'Expected a real, distinct label to pass the audit with no findings.');
  }

  // 4. Normalization must catch spacing/casing/separator differences, not just an exact
  // string match - "Docs Api On Reflex" is just as uninformative as "docs-api-on-reflex".
  {
    const snapshot = { nodes: [node({ type: 'route', key: 'docs-api-on-reflex', label: 'Docs Api On Reflex' })] };
    const findings = auditLabelQuality(snapshot);
    assert(findings.length === 1 && findings[0].issue === 'label_echoes_key', 'Expected a label that only differs from the key by spacing/casing to still be flagged.');
  }

  // 5. The app root node must never be flagged - it's not a real user-facing candidate.
  {
    const snapshot = { nodes: [node({ type: 'app', key: 'app' })] };
    const findings = auditLabelQuality(snapshot);
    assert(findings.length === 0, 'Expected the app root node to be excluded from the audit entirely.');
  }

  // 6. selectorHint (when the scanner captured one) must pass through, so a developer or agent
  // fixing the finding has a concrete starting point for finding the real source element.
  {
    const snapshot = { nodes: [node({ type: 'action', key: 'export-csv', source: { tagName: 'button', selectorHint: '#export-csv-button' } })] };
    const findings = auditLabelQuality(snapshot);
    assert(findings[0]?.selectorHint === '#export-csv-button', 'Expected the finding to carry the real selectorHint through for locating the element.');
  }

  console.log('All label audit validations passed.');
}

main();
