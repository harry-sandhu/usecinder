// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
//
// Loaded via Vite's ssrLoadModule by scripts/prerender.mjs (plain Node, no browser). Renders the
// real route tree to an HTML string with react-dom/server, so a crawler that fetches raw HTML
// without executing JavaScript sees the actual per-page content and metadata, not an empty
// #root div. PageMetadata.tsx normally sets <head> tags in a useEffect, which never runs under
// renderToString - SsrMetadataContext captures the same props directly during render instead,
// so there is exactly one source of truth for each page's title/description.
import { renderToString } from 'react-dom/server';
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from 'react-router-dom/server';
import { routeObjects } from '@/app/routes';
import { SsrMetadataContext, type SsrMetadataSnapshot } from '@/components/seo/PageMetadata';
import { SITE_DESCRIPTION, SITE_NAME } from '@/lib/seo/site';

export interface SsrRenderResult {
  html: string;
  meta: SsrMetadataSnapshot;
}

const fallbackMeta: SsrMetadataSnapshot = {
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  type: 'website',
  image: '/og-image.svg',
  noindex: false,
};

export async function render(routePath: string): Promise<SsrRenderResult> {
  const handler = createStaticHandler(routeObjects);
  const request = new Request(`http://localhost${routePath}`);
  const context = await handler.query(request);

  if (context instanceof Response) {
    throw context;
  }

  const staticRouter = createStaticRouter(handler.dataRoutes, context);
  const metadataRef: { current?: SsrMetadataSnapshot } = {};

  const html = renderToString(
    <SsrMetadataContext.Provider value={metadataRef}>
      <StaticRouterProvider router={staticRouter} context={context} />
    </SsrMetadataContext.Provider>,
  );

  return { html, meta: metadataRef.current ?? fallbackMeta };
}
