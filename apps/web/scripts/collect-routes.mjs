// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

// Shared by scripts/generate-sitemap.mjs and scripts/prerender.mjs - both need the exact same
// list of public, indexable routes, and keeping one source of truth avoids the sitemap and the
// prerendered output silently drifting apart.
//
// /relay/login and /relay/dashboard are deliberately excluded: both set PageMetadata's noindex
// flag, since one is a bare auth form and the other needs a real session - neither is a page a
// search engine or a prerendered static file should serve.
const staticRouteEntries = [
  { path: '/', priority: '1.0' },
  { path: '/relay', priority: '0.9' },
  { path: '/blog', priority: '0.7' },
];

function filePathToDocsSlug(docsRoot, filePath) {
  const relative = path.relative(docsRoot, filePath).replace(/\\/g, '/').replace(/\.mdx$/, '');

  if (relative === 'index') {
    return '/docs';
  }

  if (relative.endsWith('/index')) {
    return `/docs/${relative.slice(0, -'/index'.length)}`;
  }

  return `/docs/${relative}`;
}

async function collectMdxFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectMdxFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && fullPath.endsWith('.mdx')) {
      files.push(fullPath);
    }
  }

  return files;
}

export async function collectRoutes(root) {
  const docsRoot = path.join(root, 'src', 'content', 'docs');
  const blogRoot = path.join(root, 'src', 'content', 'blog');

  const docsFiles = await collectMdxFiles(docsRoot);
  const blogFiles = await collectMdxFiles(blogRoot).catch(() => []);

  const routeEntries = [
    ...staticRouteEntries.map((entry) => ({ ...entry, lastmod: new Date().toISOString() })),
    ...(
      await Promise.all(
        docsFiles.map(async (filePath) => {
          const details = await stat(filePath);
          return {
            path: filePathToDocsSlug(docsRoot, filePath),
            lastmod: details.mtime.toISOString(),
            priority: filePath.includes(`${path.sep}index.mdx`) ? '0.9' : '0.8',
          };
        }),
      )
    ),
    ...(
      await Promise.all(
        blogFiles.map(async (filePath) => {
          const details = await stat(filePath);
          const slug = path.basename(filePath, '.mdx');
          return {
            path: `/blog/${slug}`,
            lastmod: details.mtime.toISOString(),
            priority: '0.6',
          };
        }),
      )
    ),
  ];

  const uniqueRoutes = new Map(routeEntries.map((entry) => [entry.path, entry]));
  return [...uniqueRoutes.values()].sort((left, right) => left.path.localeCompare(right.path));
}
