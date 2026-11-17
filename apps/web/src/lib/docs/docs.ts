// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import type { DocHeading, DocMeta, DocPage, DocsNavGroup, DocsSearchResult } from '@/types/docs';

interface DocModule {
  default: DocPage['Component'];
  meta: DocMeta;
}

interface SearchIndexEntry {
  slug: string;
  title: string;
  description: string;
  group: string;
  navTitle?: string;
  headings: DocHeading[];
  searchText: string;
}

const GROUP_ORDER = ['Getting Started', 'Concepts', 'Guides', 'API Reference', 'Relay', 'CLI', 'Reference'];

const docModules = import.meta.glob('../../content/docs/**/*.mdx', { eager: true }) as Record<string, DocModule>;
const rawDocModules = import.meta.glob('../../content/docs/**/*.mdx', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, unknown>;

function getGroupOrder(group: string) {
  const index = GROUP_ORDER.indexOf(group);
  return index === -1 ? GROUP_ORDER.length : index;
}

function filePathToSlug(sourcePath: string) {
  const relativePath = sourcePath.split('/content/docs/')[1]?.replace(/\.mdx$/, '') ?? '';

  if (relativePath === 'index') {
    return '/docs';
  }

  if (relativePath.endsWith('/index')) {
    return `/docs/${relativePath.slice(0, -'/index'.length)}`;
  }

  return `/docs/${relativePath}`;
}

function cleanHeadingTitle(title: string) {
  return title
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/[`_*~]/g, '')
    .trim();
}

function slugifyHeading(title: string) {
  return cleanHeadingTitle(title)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function normalizeRawContent(rawContent: unknown) {
  if (typeof rawContent === 'string') {
    return rawContent;
  }

  if (
    rawContent &&
    typeof rawContent === 'object' &&
    'default' in rawContent &&
    typeof (rawContent as { default?: unknown }).default === 'string'
  ) {
    return (rawContent as { default: string }).default;
  }

  return '';
}

function extractHeadings(rawContent: unknown): DocHeading[] {
  const normalizedContent = normalizeRawContent(rawContent);
  const headings: DocHeading[] = [];
  const seenIds = new Map<string, number>();
  const lines = normalizedContent.split(/\r?\n/);
  let inCodeFence = false;

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCodeFence = !inCodeFence;
      continue;
    }

    if (inCodeFence) {
      continue;
    }

    const match = /^(##|###)\s+(.+)$/.exec(line.trim());
    if (!match) {
      continue;
    }

    const depth = match[1] === '##' ? 2 : 3;
    const title = cleanHeadingTitle(match[2] ?? '');
    const baseId = slugifyHeading(title);
    const duplicateCount = seenIds.get(baseId) ?? 0;
    seenIds.set(baseId, duplicateCount + 1);

    headings.push({
      id: duplicateCount === 0 ? baseId : `${baseId}-${duplicateCount}`,
      title,
      depth,
    });
  }

  return headings;
}

function stripMdxSyntax(rawContent: unknown) {
  return normalizeRawContent(rawContent)
    .replace(/^export\s+const\s+meta\s*=\s*\{[\s\S]*?^\};?\s*/m, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/[`*_>#~-]/g, ' ')
    .replace(/\{[^}]+\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSearchText(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreSearchEntry(entry: SearchIndexEntry, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return undefined;
  }

  const terms = normalizedQuery.split(' ').filter(Boolean);
  const title = normalizeSearchText(entry.title);
  const navTitle = normalizeSearchText(entry.navTitle ?? '');
  const description = normalizeSearchText(entry.description);
  const group = normalizeSearchText(entry.group);
  const slug = normalizeSearchText(entry.slug);
  const headings = entry.headings.map((heading) => ({
    title: heading.title,
    normalized: normalizeSearchText(heading.title),
  }));
  const searchText = normalizeSearchText(entry.searchText);

  let score = 0;
  let matchedHeading: string | undefined;

  if (title.includes(normalizedQuery)) {
    score += 180;
  }

  if (navTitle.includes(normalizedQuery)) {
    score += 150;
  }

  if (slug.includes(normalizedQuery)) {
    score += 120;
  }

  if (description.includes(normalizedQuery)) {
    score += 90;
  }

  for (const heading of headings) {
    if (heading.normalized.includes(normalizedQuery)) {
      score += 80;
      matchedHeading = matchedHeading ?? heading.title;
      break;
    }
  }

  for (const term of terms) {
    if (title.includes(term)) {
      score += 35;
    }

    if (navTitle.includes(term)) {
      score += 30;
    }

    if (description.includes(term)) {
      score += 18;
    }

    if (group.includes(term)) {
      score += 10;
    }

    if (slug.includes(term)) {
      score += 16;
    }

    for (const heading of headings) {
      if (heading.normalized.includes(term)) {
        score += 14;
        matchedHeading = matchedHeading ?? heading.title;
        break;
      }
    }

    if (searchText.includes(term)) {
      score += 6;
    }
  }

  if (score === 0) {
    return undefined;
  }

  return {
    slug: entry.slug,
    title: entry.title,
    description: entry.description,
    group: entry.group,
    navTitle: entry.navTitle,
    matchedHeading,
    score,
  };
}

export const docsPages: DocPage[] = Object.entries(docModules)
  .map(([sourcePath, module]) => ({
    ...module.meta,
    slug: filePathToSlug(sourcePath),
    sourcePath,
    headings: extractHeadings(rawDocModules[sourcePath] ?? ''),
    Component: module.default,
  }))
  .sort((left, right) => {
    const groupOrderDifference = getGroupOrder(left.group) - getGroupOrder(right.group);
    if (groupOrderDifference !== 0) {
      return groupOrderDifference;
    }

    const orderDifference = left.order - right.order;
    if (orderDifference !== 0) {
      return orderDifference;
    }

    return left.title.localeCompare(right.title);
  });

const docsPagesBySlug = Object.fromEntries(docsPages.map((page) => [page.slug, page]));

const docsSearchIndex: SearchIndexEntry[] = docsPages.map((page) => ({
  slug: page.slug,
  title: page.title,
  description: page.description,
  group: page.group,
  navTitle: page.navTitle,
  headings: page.headings,
  searchText: [page.title, page.navTitle, page.description, page.group, stripMdxSyntax(rawDocModules[page.sourcePath] ?? '')]
    .filter(Boolean)
    .join(' '),
}));

export function getDocPage(pathname: string) {
  return docsPagesBySlug[pathname] as DocPage | undefined;
}

export function getDocsNavigation(): DocsNavGroup[] {
  const groups = new Map<string, DocsNavGroup>();

  for (const page of docsPages) {
    const group = groups.get(page.group) ?? { title: page.group, items: [] };
    group.items.push({
      title: page.navTitle ?? page.title,
      href: page.slug,
    });
    groups.set(page.group, group);
  }

  return Array.from(groups.values()).sort((left, right) => getGroupOrder(left.title) - getGroupOrder(right.title));
}

export function getAdjacentDocPages(slug: string) {
  const currentIndex = docsPages.findIndex((page) => page.slug === slug);

  if (currentIndex === -1) {
    return {
      previous: undefined,
      next: undefined,
    };
  }

  return {
    previous: docsPages[currentIndex - 1] as DocPage | undefined,
    next: docsPages[currentIndex + 1] as DocPage | undefined,
  };
}

export function searchDocs(query: string): DocsSearchResult[] {
  const scoredResults = docsSearchIndex
    .map((entry) => scoreSearchEntry(entry, query))
    .filter((result): result is NonNullable<ReturnType<typeof scoreSearchEntry>> => result !== undefined);

  return scoredResults
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, 12)
    .map(({ score: _score, ...result }) => result);
}
