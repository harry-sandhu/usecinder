import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const docsRoot = path.join(root, 'src', 'content', 'docs');
const srcRoot = path.join(root, 'src');
const staticRoutes = new Set(['/', '/docs', '/relay', '/relay/login', '/relay/dashboard']);

function filePathToSlug(filePath) {
  const relative = path.relative(docsRoot, filePath).replace(/\\/g, '/').replace(/\.mdx$/, '');

  if (relative === 'index') {
    return '/docs';
  }

  if (relative.endsWith('/index')) {
    return `/docs/${relative.slice(0, -'/index'.length)}`;
  }

  return `/docs/${relative}`;
}

function normalizeLink(link) {
  return link.replace(/[#?].*$/, '').replace(/\/$/, '') || '/';
}

function extractLinks(content) {
  const links = new Set();
  const patterns = [
    /(?:href|to)=['"](\/[^'"]*)['"]/g,
    /\]\((\/[^)\s]*)\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (match[1]) {
        links.add(normalizeLink(match[1]));
      }
    }
  }

  return [...links];
}

async function collectFiles(directory, matcher) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath, matcher)));
      continue;
    }

    if (entry.isFile() && matcher(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

const docFiles = await collectFiles(docsRoot, (filePath) => filePath.endsWith('.mdx'));
const sourceFiles = await collectFiles(srcRoot, (filePath) => filePath.endsWith('.tsx') || filePath.endsWith('.mdx'));
const docRoutes = new Set(docFiles.map(filePathToSlug));
const knownRoutes = new Set([...staticRoutes, ...docRoutes]);
const problems = [];

for (const filePath of sourceFiles) {
  const content = await readFile(filePath, 'utf8');
  const links = extractLinks(content);

  for (const link of links) {
    if (!knownRoutes.has(link)) {
      problems.push(`${path.relative(root, filePath)} -> ${link}`);
    }
  }
}

if (problems.length > 0) {
  console.error('[validate:docs] broken internal links found:');
  for (const problem of problems) {
    console.error(`- ${problem}`);
  }
  process.exitCode = 1;
} else {
  console.log(`[validate:docs] ok (${docFiles.length} docs files checked, ${sourceFiles.length} source files checked)`);
}
