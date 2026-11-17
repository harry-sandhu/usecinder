// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { collectRoutes } from './collect-routes.mjs';

const root = process.cwd();
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

const routes = await collectRoutes(root);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${routes
  .map(
    (entry) => `  <url>\n    <loc>${escapeXml(new URL(entry.path, `${siteUrl}/`).toString())}</loc>\n    <lastmod>${entry.lastmod}</lastmod>\n    <priority>${entry.priority}</priority>\n  </url>`,
  )
  .join('\n')}\n</urlset>\n`;

await mkdir(publicRoot, { recursive: true });
await writeFile(sitemapPath, sitemap, 'utf8');
console.log(`[generate:sitemap] wrote ${path.relative(root, sitemapPath)} (${routes.length} routes)`);
