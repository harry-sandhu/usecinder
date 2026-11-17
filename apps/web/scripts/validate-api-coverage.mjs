// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const webRoot = process.cwd();
const repoRoot = path.resolve(webRoot, '../..');
const cinderIndexPath = path.join(repoRoot, 'packages', 'cinder', 'src', 'index.ts');
const apiDocsRoot = path.join(webRoot, 'src', 'content', 'docs', 'api');

function toKebabCase(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
}

function extractCinderMethods(source) {
  const methods = [];
  const objectMatch = source.match(/export const Cinder = \{([\s\S]*?)\n\};/);

  if (!objectMatch?.[1]) {
    return methods;
  }

  for (const match of objectMatch[1].matchAll(/^\s{2}([a-zA-Z0-9_]+)(?:<[^>]+>)?\(/gm)) {
    if (match[1]) {
      methods.push(match[1]);
    }
  }

  return [...new Set(methods)];
}

function extractMetaTitle(source) {
  return source.match(/title:\s*'([^']+)'/)?.[1];
}

const cinderIndexSource = await readFile(cinderIndexPath, 'utf8');
const exportedMethods = extractCinderMethods(cinderIndexSource);
const apiDocFiles = (await readdir(apiDocsRoot)).filter((fileName) => fileName.endsWith('.mdx'));
const apiDocMap = new Map(apiDocFiles.map((fileName) => [fileName.replace(/\.mdx$/, ''), fileName]));
const expectedDocSlugs = new Set(exportedMethods.map(toKebabCase));
const problems = [];

for (const method of exportedMethods) {
  const slug = toKebabCase(method);
  const fileName = apiDocMap.get(slug);

  if (!fileName) {
    problems.push(`Missing API doc page for Cinder.${method} (expected src/content/docs/api/${slug}.mdx).`);
    continue;
  }

  const filePath = path.join(apiDocsRoot, fileName);
  const source = await readFile(filePath, 'utf8');
  const title = extractMetaTitle(source);
  const expectedTitle = `Cinder.${method}`;

  if (title !== expectedTitle) {
    problems.push(`Unexpected title in src/content/docs/api/${fileName}. Expected '${expectedTitle}', got '${title ?? 'missing'}'.`);
  }
}

for (const fileName of apiDocFiles) {
  const slug = fileName.replace(/\.mdx$/, '');
  if (slug === 'index') {
    continue;
  }

  if (!expectedDocSlugs.has(slug)) {
    problems.push(`Orphan API doc page found with no matching Cinder export: src/content/docs/api/${fileName}.`);
  }
}

if (problems.length > 0) {
  console.error('[validate:api-coverage] API reference drift detected:');
  for (const problem of problems) {
    console.error(`- ${problem}`);
  }
  process.exitCode = 1;
} else {
  console.log(`[validate:api-coverage] ok (${exportedMethods.length} exported methods, ${apiDocFiles.length - 1} API pages)`);
}
