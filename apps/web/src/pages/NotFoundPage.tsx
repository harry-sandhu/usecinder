// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { Link } from 'react-router-dom';
import { PageMetadata } from '@/components/seo/PageMetadata';
import { PageLinkCard } from '@/components/ui/PageLinkCard';
import { getWebCinderRouteAttributes } from '@/lib/cinder/routes';

const recoveryLinks = [
  {
    href: '/docs',
    title: 'Documentation Home',
    description: 'Start with the main docs landing page and follow the recommended reading path.',
  },
  {
    href: '/docs/quick-start',
    title: 'Quick Start',
    description: 'Go from first install to first semantic command with the minimum setup.',
  },
  {
    href: '/docs/guides/debugging',
    title: 'Debugging',
    description: 'Inspect scan output, graph state, and dispatch behavior when something feels wrong.',
  },
  {
    href: '/docs/api',
    title: 'API Overview',
    description: 'Browse the core runtime methods, hooks, extension points, and lifecycle controls.',
  },
];

export function NotFoundPage() {
  return (
    <>
      <PageMetadata
        title="Page Not Found | Cinder"
        description="The requested page does not exist. Return to the homepage or browse the documentation."
        noindex
      />
      <div cinder-context="site-page-not-found" className="mx-auto flex min-h-[60vh] max-w-5xl flex-col items-start justify-center gap-8 px-4 py-16 sm:px-6 sm:py-20">
        <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          404
        </span>
        <div className="max-w-3xl space-y-3">
          <h1 className="text-4xl font-semibold tracking-tight text-slate-950 dark:text-white">Page not found</h1>
          <p className="text-lg leading-8 text-slate-600 dark:text-slate-300">
            The route you requested does not exist yet or has moved. The fastest recovery path is usually docs home,
            quick start, debugging, or the API overview.
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Recovery tip</p>
          <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">
            Use the site search in the header and try keywords like <strong>quick start</strong>, <strong>debugging</strong>, <strong>application graph</strong>, or a method name like <strong>Cinder.scan</strong>.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            to="/docs"
            {...getWebCinderRouteAttributes('/docs')}
            className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
          >
            Go to Docs
          </Link>
          <Link
            to="/"
            {...getWebCinderRouteAttributes('/')}
            className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-600 dark:hover:bg-slate-800"
          >
            Return Home
          </Link>
        </div>

        <div className="grid w-full gap-5 md:grid-cols-2 xl:grid-cols-4">
          {recoveryLinks.map((link) => (
            <PageLinkCard key={link.href} href={link.href} title={link.title} description={link.description} />
          ))}
        </div>
      </div>
    </>
  );
}
