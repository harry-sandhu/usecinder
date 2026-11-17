import type { CinderSiteManifest } from 'usecinder';
import { docsPages, getDocsNavigation } from '@/lib/docs/docs';
import { getWebCinderRoute, webCinderRoutes } from './routes';

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function uniqueStrings(values: Array<string | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) {
      continue;
    }

    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(trimmed);
  }

  return result;
}

function getPageContextKey() {
  return 'page';
}

function createRouteManifest(): CinderSiteManifest['routes'] {
  return webCinderRoutes.map((route) => {
    const page = docsPages.find((candidate) => candidate.slug === route.path);

    return {
      key: route.key,
      path: route.path,
      title: page?.title ?? (route.key === 'home' ? 'Home' : route.key),
      aliases: uniqueStrings([
        ...(route.aliases ?? []),
        page?.title,
        page?.navTitle,
        page?.group === 'Getting Started' ? 'getting started' : undefined,
      ]),
      metadata: {
        description: page?.description,
        group: page?.group,
        slug: page?.slug,
        headingCount: page?.headings.length ?? 0,
      },
      nodes: page
        ? [
            {
              type: 'context',
              key: getPageContextKey(),
              label: `${page.title} Page`,
              aliases: uniqueStrings([
                page.title,
                page.navTitle,
                `${page.title} page`,
                page.group ? `${page.group} ${page.title}` : undefined,
              ]),
              metadata: {
                kind: 'docs-page',
                slug: page.slug,
                title: page.title,
                navTitle: page.navTitle,
                description: page.description,
                group: page.group,
              },
              children: page.headings.map((heading) => ({
                type: 'output',
                key: heading.id,
                label: heading.title,
                aliases: uniqueStrings([
                  heading.title,
                  `${page.navTitle ?? page.title} ${heading.title}`,
                  page.group ? `${page.group} ${heading.title}` : undefined,
                ]),
                metadata: {
                  kind: 'docs-heading',
                  headingId: heading.id,
                  headingDepth: heading.depth,
                  routePath: `${page.slug}#${heading.id}`,
                  pageTitle: page.title,
                  pageSlug: page.slug,
                },
              })),
            },
          ]
        : undefined,
    };
  });
}

function createGroupManifest(): NonNullable<CinderSiteManifest['groups']> {
  return getDocsNavigation().map((group) => ({
    key: `${slugify(group.title)}-group`,
    title: group.title,
    routeKey: 'docs-home',
    aliases: uniqueStrings([group.title, `${group.title} docs`]),
    metadata: {
      kind: 'docs-group',
      itemCount: group.items.length,
    },
    memberRouteKeys: group.items
      .map((item) => getWebCinderRoute(item.href)?.key)
      .filter((key): key is string => Boolean(key)),
  }));
}

export const webCinderSiteManifest: CinderSiteManifest = {
  id: 'cinder-docs-site',
  routes: createRouteManifest(),
  groups: createGroupManifest(),
};
