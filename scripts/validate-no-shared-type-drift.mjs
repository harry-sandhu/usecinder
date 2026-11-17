// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
// Guards docs/known-limitations.md #5/#6 from regressing: @cinder/shared is the single source
// of truth for contracts shared across packages. This repo has no ESLint config to carry a real
// lint rule (checked before writing this), so the guard is a plain validate: script in the same
// style as every other scripts/validate-*.mjs - it fails the moment a NEW type/interface is
// declared under a name @cinder/shared already owns, instead of being re-exported from it.
//
// A real "export type { X } from '@cinder/shared'" (or "export type { X };" after an
// "import type") is NOT a redeclaration - that's exactly the pattern this guard wants to see -
// so only a genuine `export interface X` / `export type X =` is flagged.
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = new URL('..', import.meta.url).pathname;
const SHARED_SRC = join(REPO_ROOT, 'packages/shared/src');

// Packages that depend on @cinder/shared and could therefore redeclare one of its contracts
// instead of importing it. apps/web is included even though it currently declares none, so a
// future regression there is caught too.
const WATCHED_SRC_DIRS = [
  'packages/cinder/src',
  'packages/cinder-embeddings/src',
  'apps/web/src',
].map((relativePath) => join(REPO_ROOT, relativePath));

const DECLARATION_PATTERN = /^export\s+(?:interface|type)\s+([A-Za-z_$][\w$]*)/;

function listTsFiles(dir) {
  let entries;

  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...listTsFiles(fullPath));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

function findDeclaredNames(filePath) {
  const lines = readFileSync(filePath, 'utf8').split('\n');
  const names = [];

  for (const line of lines) {
    const match = line.match(DECLARATION_PATTERN);

    if (match) {
      names.push(match[1]);
    }
  }

  return names;
}

function collectSharedNames() {
  const names = new Map();

  for (const filePath of listTsFiles(SHARED_SRC)) {
    for (const name of findDeclaredNames(filePath)) {
      names.set(name, filePath);
    }
  }

  return names;
}

function main() {
  const sharedNames = collectSharedNames();

  if (sharedNames.size === 0) {
    throw new Error('Expected to find at least one real type/interface declared in @cinder/shared - the scan path may be wrong.');
  }

  const violations = [];

  for (const srcDir of WATCHED_SRC_DIRS) {
    for (const filePath of listTsFiles(srcDir)) {
      for (const name of findDeclaredNames(filePath)) {
        if (sharedNames.has(name)) {
          violations.push({ name, filePath, sharedFilePath: sharedNames.get(name) });
        }
      }
    }
  }

  if (violations.length > 0) {
    const lines = violations.map(
      (v) => `  - "${v.name}" redeclared in ${v.filePath} (already a real contract in ${v.sharedFilePath})`,
    );
    throw new Error(
      `Found ${violations.length} type(s) redeclared outside @cinder/shared instead of imported from it:\n${lines.join('\n')}\n\nImport it from "@cinder/shared" and re-export with "export type { Name } from \\"@cinder/shared\\";" instead.`,
    );
  }

  console.log(`No shared-contract drift: checked ${sharedNames.size} @cinder/shared type(s) against ${WATCHED_SRC_DIRS.length} watched package(s).`);
}

main();
