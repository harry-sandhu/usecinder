// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { getWebCinderRouteAttributes, getWebCinderRouteAttributesForHref } from '@/lib/cinder/routes';
import { searchDocs } from '@/lib/docs/docs';

interface DocsSearchDialogProps {
  open: boolean;
  query: string;
  onClose: () => void;
  onQueryChange: (value: string) => void;
}

const suggestedLinks = [
  { href: '/docs/quick-start', title: 'Quick Start' },
  { href: '/docs/guides/debugging', title: 'Debugging' },
  { href: '/docs/api', title: 'API Overview' },
  { href: '/docs/guides/tagging-a-page', title: 'Tagging a Page' },
  { href: '/docs/guides/using-route-registry', title: 'Using Route Registry' },
  { href: '/docs/guides/understanding-fallback-telemetry', title: 'Fallback Telemetry' },
  { href: '/docs/relay', title: 'Relay Overview' },
];

export function DocsSearchDialog({ open, query, onClose, onQueryChange }: DocsSearchDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchDocs(query), [query]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[70]" aria-modal="true" role="dialog" aria-label="Search documentation">
      <button
        type="button"
        aria-label="Close search"
        cinder-action="close-docs-search"
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm dark:bg-slate-950/75"
        onClick={onClose}
      />

      <div cinder-context="docs-search-dialog" className="absolute inset-x-3 top-16 mx-auto w-auto max-w-3xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl sm:inset-x-4 sm:top-20 dark:border-slate-800 dark:bg-slate-950">
        <div className="border-b border-slate-200 px-4 py-4 sm:px-6 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-700 dark:text-brand-300">Search</span>
            <div className="hidden rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-500 sm:inline-flex dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              Docs / API / Guides
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 focus-within:border-brand-300 focus-within:bg-white dark:border-slate-700 dark:bg-slate-900 dark:focus-within:border-brand-500 dark:focus-within:bg-slate-900">
            <span className="text-slate-400 dark:text-slate-500">⌘K</span>
            <input
              ref={inputRef}
              cinder-field="docs-search-query"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search quick start, route registry, DOM adapters, custom intents, fallback telemetry..."
              aria-label="Search documentation"
              className="w-full border-0 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
            {query ? (
              <button
                type="button"
                cinder-action="clear-docs-search"
                onClick={() => onQueryChange('')}
                className="rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-4 py-5 sm:px-6 dark:bg-slate-950">
          {query.trim() ? (
            results.length > 0 ? (
              <div className="space-y-3">
                {results.map((result) => (
                  <Link
                    key={result.slug}
                    to={result.slug}
                    onClick={onClose}
                    {...getWebCinderRouteAttributes(result.slug)}
                    className="block rounded-2xl border border-slate-200 bg-white px-4 py-4 transition-colors hover:border-brand-200 hover:bg-brand-50/40 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-500/40 dark:hover:bg-slate-900"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
                      <span>{result.group}</span>
                      <span className="text-slate-300 dark:text-slate-600">•</span>
                      <span className="text-slate-500 dark:text-slate-400">{result.slug}</span>
                    </div>
                    <h2 className="mt-2 text-base font-semibold text-slate-950 dark:text-white">{result.navTitle ?? result.title}</h2>
                    <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">{result.description}</p>
                    {result.matchedHeading ? (
                      <p className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">Matching heading: {result.matchedHeading}</p>
                    ) : null}
                  </Link>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-6 dark:border-slate-700 dark:bg-slate-900">
                <h2 className="text-base font-semibold text-slate-950 dark:text-white">No matching docs yet</h2>
                <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  Try broader keywords like <strong>scan</strong>, <strong>semantic tags</strong>, <strong>runtime events</strong>, <strong>DOM adapters</strong>, or <strong>dispatch</strong>.
                </p>
              </div>
            )
          ) : (
            <div className="space-y-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Suggested pages</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {suggestedLinks.map((item) => (
                    <Link
                      key={item.href}
                      to={item.href}
                      onClick={onClose}
                      {...getWebCinderRouteAttributesForHref(item.href)}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm font-medium text-slate-700 transition-colors hover:border-brand-200 hover:bg-brand-50/40 hover:text-slate-950 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-brand-500/40 dark:hover:bg-slate-900 dark:hover:text-white"
                    >
                      {item.title}
                    </Link>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-5 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Tips</p>
                <ul className="mt-3 space-y-2 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  <li>
                    Search by method name like <code className="rounded bg-white px-1.5 py-0.5 text-slate-900 dark:bg-slate-800 dark:text-slate-100">Cinder.run</code> or <code className="rounded bg-white px-1.5 py-0.5 text-slate-900 dark:bg-slate-800 dark:text-slate-100">Cinder.scan</code>.
                  </li>
                  <li>
                    Search by concept like <code className="rounded bg-white px-1.5 py-0.5 text-slate-900 dark:bg-slate-800 dark:text-slate-100">application graph</code> or <code className="rounded bg-white px-1.5 py-0.5 text-slate-900 dark:bg-slate-800 dark:text-slate-100">local resolution</code>.
                  </li>
                  <li>
                    Search by flow like <code className="rounded bg-white px-1.5 py-0.5 text-slate-900 dark:bg-slate-800 dark:text-slate-100">speech</code>,{' '}
                    <code className="rounded bg-white px-1.5 py-0.5 text-slate-900 dark:bg-slate-800 dark:text-slate-100">AI fallback</code>, or{' '}
                    <code className="rounded bg-white px-1.5 py-0.5 text-slate-900 dark:bg-slate-800 dark:text-slate-100">debugging</code>.
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
