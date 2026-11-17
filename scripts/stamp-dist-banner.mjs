// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
//
// Prepends the license banner directly to every compiled .js file under a package's dist/ -
// run as a "postbuild" step. The source-level header (stamp-license-headers.mjs) is NOT
// enough on its own: tsc can drop a leading comment that sits directly above a type-only
// import once that import is elided from the output, so the banner would silently vanish from
// exactly the file (dist/index.js) that anyone who runs `npm install` actually receives.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';

const target = process.argv[2];

if (!target) {
  console.error('Usage: node scripts/stamp-dist-banner.mjs <path-to-dist-dir>');
  process.exitCode = 1;
  process.exit();
}

const BANNER = `// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
`;

function walk(dir, files) {
  let entries;

  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }

    if (extname(entry.name) === '.js') {
      files.push(fullPath);
    }
  }
}

const files = [];
walk(target, files);

let stamped = 0;

for (const filePath of files) {
  const content = readFileSync(filePath, 'utf8');

  if (content.includes('Elastic License 2.0 (ELv2)')) {
    continue;
  }

  if (content.startsWith('#!')) {
    const newlineIndex = content.indexOf('\n');
    writeFileSync(filePath, content.slice(0, newlineIndex + 1) + BANNER + content.slice(newlineIndex + 1), 'utf8');
  } else {
    writeFileSync(filePath, BANNER + content, 'utf8');
  }

  stamped += 1;
}

console.log(`Stamped ${stamped} compiled file(s) in ${target} with the license banner.`);
