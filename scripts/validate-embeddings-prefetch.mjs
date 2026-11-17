// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
// Coverage for the connection-aware prefetch decision (@usecinder/embeddings'
// shouldSkipPrefetchForConnection, prefetch.ts). This is the one piece of the
// idle-prefetch/Network-Information-API design (docs/local-engine-fully-fledged-plan.md
// §12) that's pure, deterministic logic - testable without a real browser, unlike the rest
// of prefetchEmbeddingModel (actually scheduling via requestIdleCallback, actually
// downloading a model), which needs real-browser verification this session couldn't do
// (Playwright was unavailable).
import { shouldSkipPrefetchForConnection } from '../packages/cinder-embeddings/dist/index.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const cases = [
  { connection: undefined, expected: false, label: 'no connection API available - must not block' },
  { connection: {}, expected: false, label: 'connection present but no useful fields - must not block' },
  { connection: { saveData: true }, expected: true, label: 'saveData set - must skip' },
  { connection: { saveData: false }, expected: false, label: 'saveData explicitly false, no slow type - must not skip' },
  { connection: { effectiveType: '2g' }, expected: true, label: '2g - must skip' },
  { connection: { effectiveType: 'slow-2g' }, expected: true, label: 'slow-2g - must skip' },
  { connection: { effectiveType: '3g' }, expected: false, label: '3g - must not skip' },
  { connection: { effectiveType: '4g' }, expected: false, label: '4g - must not skip' },
  { connection: { saveData: true, effectiveType: '4g' }, expected: true, label: 'saveData wins even on a fast connection - must skip' },
];

function main() {
  const failures = [];

  for (const testCase of cases) {
    const actual = shouldSkipPrefetchForConnection(testCase.connection);

    if (actual !== testCase.expected) {
      failures.push(`${testCase.label}: expected ${testCase.expected}, got ${actual}.`);
    }
  }

  if (failures.length > 0) {
    console.error('[validate-embeddings-prefetch] failed:\n' + failures.join('\n'));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({ ok: true, summary: { casesChecked: cases.length } }, null, 2));
}

main();
