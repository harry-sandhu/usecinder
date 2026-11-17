// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { Link, useParams } from 'react-router-dom';
import { PageMetadata } from '@/components/seo/PageMetadata';
import { mdxComponents } from '@/components/mdx/MdxComponents';
import { getWebCinderRouteAttributes } from '@/lib/cinder/routes';
import { getBlogPost } from '@/lib/blog/blog';

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function BlogPostPage() {
  const { slug } = useParams<{ slug: string }>();
  const post = slug ? getBlogPost(slug) : undefined;

  if (!post) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <PageMetadata title="Post not found" description="This blog post does not exist or has moved." noindex />
        <h1 className="text-3xl font-semibold text-slate-950 dark:text-white">Post not found</h1>
        <p className="mt-4 text-base text-slate-600 dark:text-slate-300">
          <Link to="/blog" className="font-medium text-brand-700 hover:underline dark:text-brand-300">
            Back to the blog
          </Link>
        </p>
      </div>
    );
  }

  const { meta, Component } = post;

  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6" {...getWebCinderRouteAttributes(`/blog/${post.slug}`)}>
      <PageMetadata title={meta.title} description={meta.description} type="article" />

      <Link to="/blog" className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
        ← Blog
      </Link>

      <header className="mt-4 mb-8 space-y-3 border-b border-slate-200 pb-8 dark:border-slate-800">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
          {formatDate(meta.date)}
          {meta.author ? ` · ${meta.author}` : ''}
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-slate-950 dark:text-white">{meta.title}</h1>
        <p className="text-lg leading-8 text-slate-600 dark:text-slate-300">{meta.description}</p>
      </header>

      <div className="space-y-5">
        <Component components={mdxComponents} />
      </div>
    </article>
  );
}
