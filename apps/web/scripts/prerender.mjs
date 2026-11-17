// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
//
// Prerenders every public route to a static dist/<route>/index.html after `vite build` runs,
// using real React server-side rendering (react-dom/server's renderToString, via src/entry-
// server.tsx) loaded through Vite's own ssrLoadModule - not a headless browser. This repo has
// no SSR; PageMetadata.tsx normally sets correct per-page title/description/OG/canonical tags,
// but only client-side after React mounts. A crawler that fetches raw HTML without executing
// JavaScript (unlike Googlebot, some AI answer-engine crawlers may not) only ever sees the
// generic homepage shell in dist/index.html, with an empty #root div.
//
// A headless-Chromium-based version of this script was tried first and does not work on Vercel:
// its build container has no apt-get/sudo, so Playwright can't install Chromium's OS-level
// shared libraries (fails with "error while loading shared libraries: libnspr4.so"). react-dom/
// server has zero OS dependencies and runs in any Node environment, including Vercel's build.
import { createServer as createViteServer } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { collectRoutes } from './collect-routes.mjs';

const root = process.cwd();
const distRoot = path.join(root, 'dist');
const siteUrl = (process.env.SITE_URL || process.env.VITE_SITE_URL || 'https://usecinder.dev').replace(/\/$/, '');

function upsertTag(head, matcher, tag) {
  return matcher.test(head) ? head.replace(matcher, tag) : head.replace('</head>', `    ${tag}\n  </head>`);
}

function buildHead(template, routePath, meta) {
  const canonicalUrl = new URL(routePath, `${siteUrl}/`).toString();
  const imageUrl = new URL(meta.image, `${siteUrl}/`).toString();
  const robotsContent = meta.noindex ? 'noindex, nofollow' : 'index, follow';

  let head = template;
  head = upsertTag(head, /<title>[\s\S]*?<\/title>/, `<title>${meta.title}</title>`);
  head = upsertTag(head, /<meta\s+name="description"[^>]*\/>/, `<meta name="description" content="${meta.description}" />`);
  head = upsertTag(head, /<meta\s+name="robots"[^>]*\/>/, `<meta name="robots" content="${robotsContent}" />`);
  head = upsertTag(head, /<meta\s+property="og:title"[^>]*\/>/, `<meta property="og:title" content="${meta.title}" />`);
  head = upsertTag(
    head,
    /<meta\s+property="og:description"[^>]*\/>/,
    `<meta property="og:description" content="${meta.description}" />`,
  );
  head = upsertTag(head, /<meta\s+property="og:type"[^>]*\/>/, `<meta property="og:type" content="${meta.type}" />`);
  head = upsertTag(head, /<meta\s+property="og:url"[^>]*\/>/, `<meta property="og:url" content="${canonicalUrl}" />`);
  head = upsertTag(head, /<meta\s+property="og:image"[^>]*\/>/, `<meta property="og:image" content="${imageUrl}" />`);
  head = upsertTag(head, /<meta\s+name="twitter:title"[^>]*\/>/, `<meta name="twitter:title" content="${meta.title}" />`);
  head = upsertTag(
    head,
    /<meta\s+name="twitter:description"[^>]*\/>/,
    `<meta name="twitter:description" content="${meta.description}" />`,
  );
  head = upsertTag(head, /<meta\s+name="twitter:image"[^>]*\/>/, `<meta name="twitter:image" content="${imageUrl}" />`);
  head = upsertTag(head, /<link\s+rel="canonical"[^>]*\/>/, `<link rel="canonical" href="${canonicalUrl}" />`);

  return head;
}

function routeToOutputPath(routePath) {
  if (routePath === '/') {
    return path.join(distRoot, 'index.html');
  }
  return path.join(distRoot, routePath.replace(/^\//, ''), 'index.html');
}

async function main() {
  const template = await readFile(path.join(distRoot, 'index.html'), 'utf8');

  if (!template.includes('<div id="root"></div>')) {
    throw new Error(
      'prerender: expected dist/index.html to contain an empty <div id="root"></div> template - the build output shape may have changed.',
    );
  }

  const routes = await collectRoutes(root);

  const vite = await createViteServer({
    root,
    server: { middlewareMode: true },
    appType: 'custom',
  });

  try {
    const { render } = await vite.ssrLoadModule('/src/entry-server.tsx');

    for (const { path: routePath } of routes) {
      const { html: bodyHtml, meta } = await render(routePath);
      const head = buildHead(template, routePath, meta);
      const page = head.replace('<div id="root"></div>', `<div id="root">${bodyHtml}</div>`);

      const outputPath = routeToOutputPath(routePath);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, page, 'utf8');
      console.log(`[prerender] ${routePath} -> ${path.relative(root, outputPath)}`);
    }
  } finally {
    await vite.close();
  }

  console.log(`[prerender] done (${routes.length} routes)`);
}

await main();
