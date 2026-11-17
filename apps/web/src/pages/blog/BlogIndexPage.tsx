// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { Link } from 'react-router-dom';
import { PageMetadata } from '@/components/seo/PageMetadata';
import { getWebCinderRouteAttributes } from '@/lib/cinder/routes';
import { getBlogPosts } from '@/lib/blog/blog';

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function BlogIndexPage() {
  const posts = getBlogPosts();

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6" {...getWebCinderRouteAttributes('/blog')}>
      <PageMetadata
        title="Blog"
        description="Release notes, product updates, and the thinking behind Cinder - a semantic runtime for websites you control."
      />

      <div className="mb-12 space-y-3">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-700 dark:text-brand-300">Blog</p>
        <h1 className="text-4xl font-semibold tracking-tight text-slate-950 dark:text-white">Updates and thinking</h1>
        <p className="text-base leading-8 text-slate-600 dark:text-slate-300">
          Release notes and product updates live in the <Link to="/docs/changelog" className="font-medium text-brand-700 hover:underline dark:text-brand-300">changelog</Link>.
          This is the longer-form stuff: why we built things the way we did, and where the product is headed.
        </p>
      </div>

      {posts.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No posts yet.</p>
      ) : (
        <div className="space-y-8">
          {posts.map((post) => (
            <article key={post.slug} className="border-b border-slate-200 pb-8 last:border-b-0 dark:border-slate-800">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                {formatDate(post.meta.date)}
                {post.meta.author ? ` · ${post.meta.author}` : ''}
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                <Link to={`/blog/${post.slug}`} className="hover:underline">
                  {post.meta.title}
                </Link>
              </h2>
              <p className="mt-2 text-base leading-7 text-slate-600 dark:text-slate-300">{post.meta.description}</p>
              <Link
                to={`/blog/${post.slug}`}
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
              >
                Read more →
              </Link>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
