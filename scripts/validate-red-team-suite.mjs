// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { spawnSync } from 'node:child_process';

function runValidation(scriptPath) {
  const result = spawnSync(process.execPath, [scriptPath], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  });

  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(`${scriptPath} exited with status ${result.status}.`);
  }

  if (result.error) {
    throw result.error;
  }
}

function main() {
  const scripts = [
    'scripts/validate-graph-scoping.mjs',
    'scripts/validate-tag-only.mjs',
    'scripts/validate-fallback-scoping.mjs',
    'scripts/validate-extension-safety.mjs',
    'scripts/validate-graph-reasoning.mjs',
    'scripts/validate-domain-preset.mjs',
    'scripts/validate-fallback-telemetry.mjs',
    'scripts/validate-mutation-backpressure.mjs',
    'scripts/validate-builder-runtime-state.mjs',
    'scripts/validate-cross-realm-dom.mjs',
    'scripts/validate-query-optimization.mjs',
    'scripts/validate-ambiguity-safety.mjs',
    'scripts/validate-composite-safety.mjs',
    'scripts/validate-action-linguistics.mjs',
    'scripts/validate-typo-tolerance.mjs',
    'scripts/validate-number-words.mjs',
    'scripts/validate-reference-carryover.mjs',
    'scripts/validate-filter-by-value.mjs',
    'scripts/validate-llm-core-extension.mjs',
    'scripts/validate-embeddings-prefetch.mjs',
  ];

  for (const scriptPath of scripts) {
    runValidation(scriptPath);
  }

  console.log(JSON.stringify({
    ok: true,
    summary: {
      validationCount: scripts.length,
      scripts,
    },
  }, null, 2));
}

main();
