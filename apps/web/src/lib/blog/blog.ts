// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import type { ComponentType } from 'react';

export interface BlogPostMeta {
  title: string;
  description: string;
  date: string;
  author?: string;
  tags?: string[];
}

export interface BlogPost {
  slug: string;
  meta: BlogPostMeta;
  Component: ComponentType<{ components?: Record<string, unknown> }>;
}

interface BlogModule {
  default: ComponentType<{ components?: Record<string, unknown> }>;
  meta: BlogPostMeta;
}

const blogModules = import.meta.glob('../../content/blog/*.mdx', { eager: true }) as Record<string, BlogModule>;

function filePathToSlug(sourcePath: string): string {
  const match = sourcePath.match(/\/([^/]+)\.mdx$/);
  return match?.[1] ?? sourcePath;
}

const allPosts: BlogPost[] = Object.entries(blogModules)
  .map(([sourcePath, mod]) => ({
    slug: filePathToSlug(sourcePath),
    meta: mod.meta,
    Component: mod.default,
  }))
  .sort((a, b) => b.meta.date.localeCompare(a.meta.date));

export function getBlogPosts(): BlogPost[] {
  return allPosts;
}

export function getBlogPost(slug: string): BlogPost | undefined {
  return allPosts.find((post) => post.slug === slug);
}
