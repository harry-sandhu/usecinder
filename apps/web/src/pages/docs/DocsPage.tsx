import { Link, useLocation } from 'react-router-dom';
import { PageMetadata } from '@/components/seo/PageMetadata';
import { mdxComponents } from '@/components/mdx/MdxComponents';
import { PageLinkCard } from '@/components/ui/PageLinkCard';
import { getWebCinderRouteAttributes } from '@/lib/cinder/routes';
import { getAdjacentDocPages, getDocPage } from '@/lib/docs/docs';

const fallbackLinks = [
  {
    href: '/docs',
    title: 'Docs Home',
    description: 'Return to the main documentation landing page and use the recommended reading path.',
  },
  {
    href: '/docs/installation',
    title: 'Installation',
    description: 'Start from package setup and local-first runtime initialization.',
  },
  {
    href: '/docs/quick-start',
    title: 'Quick Start',
    description: 'Get to the smallest working integration before exploring deeper concepts.',
  },
  {
    href: '/docs/api',
    title: 'API Overview',
    description: 'Browse the SDK method groups for setup, scanning, resolution, dispatch, and speech.',
  },
];

export function DocsPage() {
  const location = useLocation();
  const page = getDocPage(location.pathname);

  if (!page) {
    return (
      <>
        <PageMetadata
          title="Docs Page Not Found — Cinder"
          description="The requested documentation page does not exist yet. Head back to the docs home or browse the core pages."
          noindex
        />
        <section {...getWebCinderRouteAttributes('/docs')}>
          <div cinder-context="docs-page-missing" className="space-y-8">
            <header className="space-y-4 border-b border-slate-200 pb-8 dark:border-slate-800">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">Documentation</p>
            <div className="space-y-3">
              <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl dark:text-white">Page not found</h1>
              <p className="max-w-3xl text-lg leading-8 text-slate-600 dark:text-slate-300">
                This documentation route does not have MDX content yet or the link has changed. Start from docs home, quick start,
                debugging, or the API overview.
              </p>
            </div>
          </header>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-5 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Fast recovery</p>
            <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">
              Use the docs search from the site header and try keywords like <strong>quick start</strong>, <strong>debugging</strong>, <strong>application graph</strong>, or a method name like <strong>Cinder.run</strong>.
            </p>
          </div>

          <div cinder-context="docs-page-missing-actions" className="flex flex-wrap gap-3">
            <Link
              to="/docs"
              aria-label="Go to documentation home"
              {...getWebCinderRouteAttributes('/docs')}
              className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
            >
              Go to Docs Home
            </Link>
            <Link
              to="/docs/quick-start"
              aria-label="Read quick start guide"
              {...getWebCinderRouteAttributes('/docs/quick-start')}
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-600 dark:hover:bg-slate-800"
            >
              Read Quick Start
            </Link>
          </div>

            <div cinder-context="docs-page-missing-links" className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {fallbackLinks.map((link) => (
                <PageLinkCard key={link.href} href={link.href} title={link.title} description={link.description} />
              ))}
            </div>
          </div>
        </section>
      </>
    );
  }

  const Content = page.Component;
  const adjacentPages = getAdjacentDocPages(page.slug);
  const pageQuickLinks = [
    {
      href: '/docs/quick-start',
      title: 'Need the shortest path?',
      description: 'Use Quick Start when you want the smallest working route → scan → graph → run flow first.',
    },
    {
      href: '/docs/guides/debugging',
      title: 'Something feels off?',
      description: 'Inspect scan output, graph state, active route/context, and dispatch in a practical order.',
    },
    {
      href: '/docs/api',
      title: 'Need the full surface?',
      description: 'Browse all runtime methods, hooks, extension points, and lifecycle APIs.',
    },
  ];

  return (
    <>
      <PageMetadata title={`${page.title} — Cinder Docs`} description={page.description} type="article" />
      <section {...getWebCinderRouteAttributes(location.pathname)}>
        <article id="docs-page-article" data-doc-slug={page.slug} cinder-context="docs-page-article" className="space-y-10">
          <header id="docs-page-header" className="space-y-4 border-b border-slate-200 pb-8 dark:border-slate-800">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-700 dark:text-brand-300">{page.group}</p>
          <div className="space-y-3">
            <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl dark:text-white">{page.title}</h1>
            <p className="max-w-3xl text-lg leading-8 text-slate-600 dark:text-slate-300">{page.description}</p>
          </div>
        </header>

        <div cinder-context="docs-page-quick-links" className="grid gap-4 lg:grid-cols-3">
          {pageQuickLinks.map((link) => (
            <PageLinkCard key={`${page.slug}-${link.href}`} href={link.href} title={link.title} description={link.description} />
          ))}
        </div>

        <div id="docs-page-content" cinder-context="docs-page-content" className="docs-prose space-y-8">
          <Content components={mdxComponents} />
        </div>

          {adjacentPages.previous || adjacentPages.next ? (
            <section id="docs-continue-reading" cinder-context="docs-continue-reading" className="border-t border-slate-200 pt-8 dark:border-slate-800">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Continue reading</p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {adjacentPages.previous ? (
                  <PageLinkCard
                    href={adjacentPages.previous.slug}
                    title={`Previous: ${adjacentPages.previous.navTitle ?? adjacentPages.previous.title}`}
                    description={adjacentPages.previous.description}
                  />
                ) : (
                  <div />
                )}
                {adjacentPages.next ? (
                  <PageLinkCard
                    href={adjacentPages.next.slug}
                    title={`Next: ${adjacentPages.next.navTitle ?? adjacentPages.next.title}`}
                    description={adjacentPages.next.description}
                  />
                ) : null}
              </div>
            </section>
          ) : null}
        </article>
      </section>
    </>
  );
}
