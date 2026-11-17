// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import type { ComponentType } from 'react';

export interface DocHeading {
  id: string;
  title: string;
  depth: 2 | 3;
}

export interface DocMeta {
  title: string;
  description: string;
  group: string;
  order: number;
  navTitle?: string;
}

export interface DocPage extends DocMeta {
  slug: string;
  sourcePath: string;
  headings: DocHeading[];
  Component: ComponentType<{ components?: Record<string, unknown> }>;
}

export interface DocsNavItem {
  title: string;
  href: string;
}

export interface DocsNavGroup {
  title: string;
  items: DocsNavItem[];
}

export interface DocsSearchResult {
  slug: string;
  title: string;
  description: string;
  group: string;
  navTitle?: string;
  matchedHeading?: string;
}
