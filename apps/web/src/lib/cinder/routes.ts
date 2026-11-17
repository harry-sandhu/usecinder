// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import type { CinderRouteDefinition } from 'usecinder';
import { docsPages } from '@/lib/docs/docs';

interface WebRouteMeta {
  key: string;
  path: string;
  aliases: string[];
}

const genericAliases = new Set(['overview', 'home', 'page', 'docs page']);

function slugToWords(value: string) {
  return value
    .replace(/^\//, '')
    .replace(/\//g, ' ')
    .replace(/-/g, ' ')
    .trim();
}

function normalizeAlias(value: string) {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function uniqueAliases(values: Array<string | undefined>) {
  const seen = new Set<string>();
  const aliases: string[] = [];

  for (const value of values) {
    if (!value) {
      continue;
    }

    const normalized = normalizeAlias(value);
    if (!normalized || genericAliases.has(normalized) || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    aliases.push(value.trim());
  }

  return aliases;
}

const staticRoutes: WebRouteMeta[] = [
  {
    key: 'home',
    path: '/',
    aliases: uniqueAliases(['home', 'homepage', 'main site', 'cinder home']),
  },
  {
    key: 'docs-home',
    path: '/docs',
    aliases: uniqueAliases(['docs', 'documentation', 'docs home', 'documentation home', 'cinder documentation']),
  },
  {
    key: 'relay-overview',
    path: '/relay',
    aliases: uniqueAliases(['relay', 'cinder relay', 'relay overview', 'relay pricing']),
  },
  {
    key: 'relay-login',
    path: '/relay/login',
    aliases: uniqueAliases(['relay sign in', 'relay login', 'relay create account']),
  },
  {
    key: 'relay-dashboard',
    path: '/relay/dashboard',
    aliases: uniqueAliases(['relay dashboard', 'relay projects', 'relay usage', 'relay billing']),
  },
  {
    key: 'blog-home',
    path: '/blog',
    aliases: uniqueAliases(['blog', 'cinder blog', 'blog home', 'updates']),
  },
];

const docRoutes: WebRouteMeta[] = docsPages
  .filter((page) => page.slug !== '/docs')
  .map((page) => {
    const routePhrase = page.slug.startsWith('/docs/') ? slugToWords(page.slug.slice('/docs/'.length)) : slugToWords(page.slug);

    return {
      key: page.slug.replace(/^\//, '').replace(/\//g, '-'),
      path: page.slug,
      aliases: uniqueAliases([
        page.title,
        page.navTitle,
        routePhrase,
        routePhrase ? `docs ${routePhrase}` : undefined,
        page.group === 'API Reference' && routePhrase ? `api ${routePhrase}` : undefined,
        page.group === 'Guides' && routePhrase ? `guide ${routePhrase}` : undefined,
        page.group === 'Concepts' && routePhrase ? `concept ${routePhrase}` : undefined,
        page.group === 'Server' && routePhrase ? `server ${routePhrase}` : undefined,
      ]),
    };
  });

export const webCinderRoutes: WebRouteMeta[] = [...staticRoutes, ...docRoutes];

const webCinderRouteByPath = new Map(webCinderRoutes.map((route) => [route.path, route]));

function isRouteActive(path: string) {
  return window.location.pathname === path;
}

export function getWebCinderRoute(path: string) {
  return webCinderRouteByPath.get(path);
}

export function getWebCinderRouteAttributes(path: string): Record<string, string> {
  const route = getWebCinderRoute(path);

  if (!route) {
    return {};
  }

  return {
    'cinder-route': route.key,
    'data-cinder-route-path': route.path,
  };
}

export function getWebCinderRouteAttributesForHref(href?: string): Record<string, string> {
  if (!href || !href.startsWith('/')) {
    return {};
  }

  const normalizedHref = href.split(/[?#]/, 1)[0] ?? href;
  return getWebCinderRouteAttributes(normalizedHref);
}

export function createWebCinderRouteDefinitions(navigate: (path: string) => void): CinderRouteDefinition[] {
  return webCinderRoutes.map((route) => ({
    key: route.key,
    path: route.path,
    aliases: route.aliases,
    navigate: () => navigate(route.path),
    isActive: () => isRouteActive(route.path),
  }));
}
