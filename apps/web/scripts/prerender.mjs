// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
//
// Prerenders every public route to a static dist/<route>/index.html after `vite build` runs.
// This repo has no SSR - PageMetadata.tsx already sets correct per-page title/description/OG/
// canonical tags, but only client-side, after React mounts. A crawler that fetches raw HTML
// without executing JavaScript (unlike Googlebot, some AI answer-engine crawlers may not) only
// ever sees the generic homepage shell in dist/index.html, with an empty #root div.
//
// This script serves the real build output over a local static server, visits each route in
// headless Chromium, waits for the app to actually render, and captures the resulting <head>
// and #root content. That gets written as a real static index.html per route, using the
// original dist/index.html as a template so the real hashed <script>/<link> tags are preserved -
// so a browser still loads the same JS bundle and the SPA takes over normally after paint.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { collectRoutes } from './collect-routes.mjs';

const root = process.cwd();
const distRoot = path.join(root, 'dist');
const port = 48173;
const baseUrl = `http://127.0.0.1:${port}`;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function startStaticServer() {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, baseUrl).pathname);
      let filePath = path.join(distRoot, urlPath);

      // Mimic Vercel's static-file-first behavior: an exact file wins, otherwise fall back to
      // the SPA shell, same as how index.html / 404.html serve client-side routing today.
      if (!(await fileExists(filePath)) || (await stat(filePath)).isDirectory()) {
        const indexCandidate = path.join(filePath, 'index.html');
        filePath = (await fileExists(indexCandidate)) ? indexCandidate : path.join(distRoot, 'index.html');
      }

      const contents = await readFile(filePath);
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] ?? 'application/octet-stream' });
      res.end(contents);
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function prerenderRoute(page, template, routePath) {
  await page.goto(`${baseUrl}${routePath}`, { waitUntil: 'domcontentloaded' });

  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    return Boolean(root && root.children.length > 0);
  });

  // PageMetadata writes tags in a useEffect right after mount - give it one tick past first
  // paint so the real per-page title/description/canonical are in place before we capture.
  await page.waitForTimeout(150);

  const headInnerHtml = await page.evaluate(() => document.head.innerHTML);
  const rootInnerHtml = await page.evaluate(() => document.getElementById('root').innerHTML);

  let html = template;
  html = html.replace(/<head>[\s\S]*<\/head>/, `<head>${headInnerHtml}</head>`);
  html = html.replace(
    /<div id="root"><\/div>/,
    `<div id="root">${rootInnerHtml}</div>`,
  );

  return html;
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
  const server = await startStaticServer();
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage();

    for (const { path: routePath } of routes) {
      const html = await prerenderRoute(page, template, routePath);
      const outputPath = routeToOutputPath(routePath);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, html, 'utf8');
      console.log(`[prerender] ${routePath} -> ${path.relative(root, outputPath)}`);
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`[prerender] done (${routes.length} routes)`);
}

await main();
