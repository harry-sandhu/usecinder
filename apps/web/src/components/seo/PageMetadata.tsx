// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { createContext, useContext, useEffect } from 'react';
import { SITE_NAME, SITE_OG_IMAGE, SITE_THEME_COLOR_DARK, SITE_THEME_COLOR_LIGHT, SITE_URL } from '@/lib/seo/site';

interface PageMetadataProps {
  title: string;
  description: string;
  type?: 'website' | 'article';
  image?: string;
  pathname?: string;
  noindex?: boolean;
}

// Captures the exact props each page passes to PageMetadata, for the SSR prerender script
// (scripts/prerender.mjs via src/entry-server.tsx) to read after renderToString finishes - since
// renderToString never runs effects, the useEffect below (which sets real DOM tags client-side)
// never fires during SSR. Writing to this ref directly in the render body, not in an effect,
// keeps the SSR-emitted <head> tags guaranteed identical to what the client would set itself,
// with no second copy of per-page titles/descriptions to keep in sync.
export interface SsrMetadataSnapshot extends Required<Pick<PageMetadataProps, 'title' | 'description' | 'type'>> {
  image: string;
  noindex: boolean;
}

export const SsrMetadataContext = createContext<{ current?: SsrMetadataSnapshot } | undefined>(undefined);

function upsertMeta(selector: string, attributes: Record<string, string>) {
  let element = document.head.querySelector<HTMLMetaElement>(selector);

  if (!element) {
    element = document.createElement('meta');
    document.head.appendChild(element);
  }

  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
}

function upsertLink(selector: string, attributes: Record<string, string>) {
  let element = document.head.querySelector<HTMLLinkElement>(selector);

  if (!element) {
    element = document.createElement('link');
    document.head.appendChild(element);
  }

  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
}

function getThemeColor() {
  return document.documentElement.classList.contains('dark') ? SITE_THEME_COLOR_DARK : SITE_THEME_COLOR_LIGHT;
}

export function PageMetadata({
  title,
  description,
  type = 'website',
  image = SITE_OG_IMAGE,
  pathname,
  noindex = false,
}: PageMetadataProps) {
  const ssrMetadataRef = useContext(SsrMetadataContext);

  if (ssrMetadataRef) {
    ssrMetadataRef.current = { title, description, type, image, noindex };
  }

  useEffect(() => {
    const resolvedPathname = pathname ?? window.location.pathname;
    const canonicalUrl = new URL(resolvedPathname, `${SITE_URL}/`).toString();
    const imageUrl = new URL(image, `${SITE_URL}/`).toString();

    function syncThemeColor() {
      upsertMeta('meta[name="theme-color"]', { name: 'theme-color', content: getThemeColor() });
    }

    document.title = title;

    upsertMeta('meta[name="description"]', { name: 'description', content: description });
    upsertMeta('meta[property="og:title"]', { property: 'og:title', content: title });
    upsertMeta('meta[property="og:description"]', { property: 'og:description', content: description });
    upsertMeta('meta[property="og:type"]', { property: 'og:type', content: type });
    upsertMeta('meta[property="og:url"]', { property: 'og:url', content: canonicalUrl });
    upsertMeta('meta[property="og:image"]', { property: 'og:image', content: imageUrl });
    upsertMeta('meta[property="og:site_name"]', { property: 'og:site_name', content: SITE_NAME });
    upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary_large_image' });
    upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: title });
    upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: description });
    upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: imageUrl });
    upsertMeta('meta[name="robots"]', {
      name: 'robots',
      content: noindex ? 'noindex, nofollow' : 'index, follow',
    });
    upsertLink('link[rel="canonical"]', { rel: 'canonical', href: canonicalUrl });
    syncThemeColor();

    const observer = new MutationObserver(() => {
      syncThemeColor();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });

    window.addEventListener('cinder-theme-change', syncThemeColor);

    return () => {
      observer.disconnect();
      window.removeEventListener('cinder-theme-change', syncThemeColor);
    };
  }, [description, image, noindex, pathname, title, type]);

  return null;
}
