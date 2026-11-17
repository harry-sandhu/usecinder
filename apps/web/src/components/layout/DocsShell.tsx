// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { getDocPage } from '@/lib/docs/docs';
import { Breadcrumbs } from './Breadcrumbs';
import { DocsSidebar } from './DocsSidebar';
import { MobileSidebar } from './MobileSidebar';
import { TableOfContents } from './TableOfContents';

export function DocsShell() {
  const location = useLocation();
  const page = getDocPage(location.pathname);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileSidebarOpen) {
      document.body.style.removeProperty('overflow');
      return undefined;
    }

    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.removeProperty('overflow');
    };
  }, [mobileSidebarOpen]);

  return (
    <div id="docs-layout" className="mx-auto max-w-[1600px] px-3 py-6 sm:px-6 sm:py-8 lg:px-8">
      <MobileSidebar open={mobileSidebarOpen} onClose={() => setMobileSidebarOpen(false)} />

      <div className="grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-8 xl:grid-cols-[250px_minmax(0,1fr)_220px]">
        <aside id="docs-sidebar-region" cinder-context="docs-sidebar-region" className="sticky top-24 hidden self-start lg:block">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
            <p className="mb-5 text-xs font-semibold uppercase tracking-[0.18em] text-brand-700 dark:text-brand-300">Documentation</p>
            <DocsSidebar />
          </div>
        </aside>

        <div id="docs-main-region" cinder-context="docs-main-region" className="min-w-0">
          <div className="mb-4 flex items-center justify-between gap-4 lg:hidden">
            <button
              id="open-docs-navigation"
              type="button"
              cinder-action="open-docs-navigation"
              aria-label="Open documentation navigation"
              onClick={() => setMobileSidebarOpen(true)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              Browse docs
            </button>
            <span className="truncate text-sm font-medium text-slate-500 dark:text-slate-400">{page?.title ?? 'Documentation'}</span>
          </div>

          {page?.headings?.length ? (
            <div className="mb-4 xl:hidden">
              <TableOfContents sections={page.headings} compact />
            </div>
          ) : null}

          <div id="docs-content-surface" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8 dark:border-slate-800 dark:bg-slate-900/80">
            {page ? <Breadcrumbs group={page.group} title={page.title} /> : null}
            <Outlet />
          </div>
        </div>

        <div id="docs-toc-region">
          <TableOfContents sections={page?.headings ?? []} />
        </div>
      </div>
    </div>
  );
}
