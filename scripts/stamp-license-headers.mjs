// One-time (re-runnable, idempotent) stamp of a copyright/license header across every real
// source file - not a build step, not wired into CI. Run manually after adding new source
// files: `node scripts/stamp-license-headers.mjs`.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';

const REPO_ROOT = new URL('..', import.meta.url).pathname;

const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', '.git', 'coverage', '.playwright-mcp']);

const SCAN_DIRS = ['packages', 'apps', 'scripts'].map((name) => join(REPO_ROOT, name));

const JS_HEADER = `// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
`;

const VUE_HEADER = `<!--
Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
See LICENSE and NOTICE in the repository root. Do not remove this notice.
-->
`;

const JS_LIKE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs']);

function hasHeaderAlready(content) {
  return content.includes('Elastic License 2.0 (ELv2)');
}

function stampFile(filePath) {
  const ext = extname(filePath);
  const content = readFileSync(filePath, 'utf8');

  if (hasHeaderAlready(content)) {
    return false;
  }

  if (ext === '.vue') {
    writeFileSync(filePath, VUE_HEADER + content, 'utf8');
    return true;
  }

  if (JS_LIKE_EXTENSIONS.has(ext)) {
    // A file that starts with a shebang (e.g. a CLI bin entry point) must keep that as the
    // literal first line - insert the header right after it instead of before it.
    if (content.startsWith('#!')) {
      const newlineIndex = content.indexOf('\n');
      const shebangLine = content.slice(0, newlineIndex + 1);
      const rest = content.slice(newlineIndex + 1);
      writeFileSync(filePath, shebangLine + JS_HEADER + rest, 'utf8');
      return true;
    }

    writeFileSync(filePath, JS_HEADER + content, 'utf8');
    return true;
  }

  return false;
}

function walk(dir, stamped) {
  let entries;

  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) {
        continue;
      }
      walk(join(dir, entry.name), stamped);
      continue;
    }

    const fullPath = join(dir, entry.name);
    const ext = extname(entry.name);

    if (ext === '.d.ts') {
      continue;
    }

    if (JS_LIKE_EXTENSIONS.has(ext) || ext === '.vue') {
      if (stampFile(fullPath)) {
        stamped.push(fullPath);
      }
    }
  }
}

const stamped = [];
for (const dir of SCAN_DIRS) {
  walk(dir, stamped);
}

console.log(`Stamped ${stamped.length} file(s) with the copyright/license header.`);
for (const filePath of stamped) {
  console.log(`  ${filePath.replace(REPO_ROOT, '')}`);
}
