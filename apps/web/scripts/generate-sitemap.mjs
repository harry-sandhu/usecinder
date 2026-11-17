// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const docsRoot = path.join(root, 'src', 'content', 'docs');
const blogRoot = path.join(root, 'src', 'content', 'blog');
const publicRoot = path.join(root, 'public');
const sitemapPath = path.join(publicRoot, 'sitemap.xml');
const siteUrl = (process.env.SITE_URL || process.env.VITE_SITE_URL || 'https://usecinder.dev').replace(/\/$/, '');

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

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

const docsFiles = await collectMdxFiles(docsRoot);
const blogFiles = await collectMdxFiles(blogRoot).catch(() => []);
// Hardcoded here because these aren't under src/content/docs (no .mdx file to discover them
// from) - only the public, indexable pages belong here. /relay/login and /relay/dashboard are
// deliberately excluded: both set PageMetadata's noindex flag, since one is a bare auth form
// and the other needs a real session - neither is a page a search engine should land anyone on.
const staticRouteEntries = [
  { path: '/', priority: '1.0' },
  { path: '/relay', priority: '0.9' },
  { path: '/blog', priority: '0.7' },
];

const routeEntries = [
  ...staticRouteEntries.map((entry) => ({ ...entry, lastmod: new Date().toISOString() })),
  ...(
    await Promise.all(
      docsFiles.map(async (filePath) => {
        const details = await stat(filePath);
        return {
          path: filePathToSlug(filePath),
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
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...uniqueRoutes.values()]
  .sort((left, right) => left.path.localeCompare(right.path))
  .map(
    (entry) => `  <url>\n    <loc>${escapeXml(new URL(entry.path, `${siteUrl}/`).toString())}</loc>\n    <lastmod>${entry.lastmod}</lastmod>\n    <priority>${entry.priority}</priority>\n  </url>`,
  )
  .join('\n')}\n</urlset>\n`;

await mkdir(publicRoot, { recursive: true });
await writeFile(sitemapPath, sitemap, 'utf8');
console.log(`[generate:sitemap] wrote ${path.relative(root, sitemapPath)} (${uniqueRoutes.size} routes)`);
