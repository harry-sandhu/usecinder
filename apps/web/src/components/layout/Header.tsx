// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { SITE_GITHUB_URL } from '@/lib/seo/site';
import { cn } from '@/lib/utils/cn';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { getWebCinderRouteAttributes } from '@/lib/cinder/routes';
import { DocsSearchDialog } from './DocsSearchDialog';

const navigation = [
  { to: '/', label: 'Home', end: true },
  { to: '/docs', label: 'Docs' },
  { to: '/docs/quick-start', label: 'Quick Start' },
  { to: '/docs/api', label: 'API' },
  { to: '/docs/architecture', label: 'Architecture' },
  { to: '/relay', label: 'Relay' },
  { to: '/blog', label: 'Blog' },
];

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

export function Header() {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    setMobileMenuOpen(false);
    setSearchOpen(false);
    setSearchQuery('');
  }, [location.pathname]);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setMobileMenuOpen(false);
        setSearchOpen(true);
        return;
      }

      if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !isTypingTarget(event.target)) {
        event.preventDefault();
        setMobileMenuOpen(false);
        setSearchOpen(true);
        return;
      }

      if (event.key === 'Escape') {
        setSearchOpen(false);
        setMobileMenuOpen(false);
      }
    }

    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  }, []);

  useEffect(() => {
    if (!mobileMenuOpen && !searchOpen) {
      document.body.style.removeProperty('overflow');
      return undefined;
    }

    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.removeProperty('overflow');
    };
  }, [mobileMenuOpen, searchOpen]);

  function openSearch() {
    setMobileMenuOpen(false);
    setSearchOpen(true);
  }

  function closeSearch() {
    setSearchOpen(false);
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/75 dark:border-slate-800 dark:bg-slate-950/90 dark:supports-[backdrop-filter]:bg-slate-950/75">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <NavLink to="/" aria-label="Open home page" {...getWebCinderRouteAttributes('/')} className="flex items-center gap-3 text-sm font-semibold text-slate-950 dark:text-white">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-sm font-bold text-white shadow-sm shadow-brand-900/20">
              C
            </span>
            <span className="text-base">Cinder</span>
          </NavLink>

          <nav id="primary-navigation" cinder-context="site-header-navigation" className="hidden items-center gap-1 lg:flex" aria-label="Primary navigation">
            {navigation.map((item) => (
              <NavLink
                key={`${item.label}-${item.to}`}
                to={item.to}
                end={item.end}
                aria-label={`Open ${item.label}`}
                {...getWebCinderRouteAttributes(item.to)}
                className={({ isActive }) =>
                  cn(
                    'rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                    isActive
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div cinder-context="site-header-actions" className="flex items-center gap-2 sm:gap-3">
            <button
              id="open-docs-search"
              type="button"
              cinder-action="open-docs-search"
              onClick={openSearch}
              aria-label="Search documentation"
              className="hidden items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 lg:inline-flex dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              <span>Search docs</span>
              <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                ⌘K
              </span>
            </button>
            <ThemeToggle cinderAction="toggle-theme-desktop" className="hidden lg:inline-flex" />
            <a
              id="open-github-link"
              href={SITE_GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="Open GitHub"
              className="hidden rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 lg:inline-flex dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              GitHub
            </a>
            <button
              type="button"
              onClick={openSearch}
              aria-label="Search documentation"
              className="inline-flex rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 lg:hidden dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              Search docs
            </button>
            <button
              id="toggle-mobile-navigation"
              type="button"
              cinder-action={mobileMenuOpen ? 'close-site-navigation' : 'open-site-navigation'}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-primary-navigation"
              aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              onClick={() => {
                setSearchOpen(false);
                setMobileMenuOpen((open) => !open);
              }}
              className="inline-flex rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 lg:hidden dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              {mobileMenuOpen ? 'Close' : 'Menu'}
            </button>
          </div>
        </div>
      </header>

      {mobileMenuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close navigation menu"
            className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm dark:bg-slate-950/70"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div
            id="mobile-primary-navigation"
            className="absolute right-0 top-0 h-full w-[min(22rem,92vw)] overflow-y-auto border-l border-slate-200 bg-white px-5 py-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950"
          >
            <div className="mb-6 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-700 dark:text-brand-300">Navigation</p>
                <h2 className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">Browse Cinder</h2>
              </div>
              <button
                type="button"
                cinder-action="close-site-navigation"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
              >
                Close
              </button>
            </div>

            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                cinder-action="open-docs-search"
                onClick={openSearch}
                className="inline-flex w-full items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-950 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-white"
              >
                Search docs
              </button>
              <ThemeToggle cinderAction="toggle-theme-mobile" className="justify-center" />
            </div>

            <nav className="space-y-2" aria-label="Mobile primary navigation">
              {navigation.map((item) => (
                <NavLink
                  key={`mobile-${item.label}-${item.to}`}
                  to={item.to}
                  end={item.end}
                  aria-label={`Open ${item.label}`}
                  {...getWebCinderRouteAttributes(item.to)}
                  className={({ isActive }) =>
                    cn(
                      'block rounded-xl px-4 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                      isActive
                        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950'
                        : 'text-slate-700 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-200 dark:hover:bg-slate-900 dark:hover:text-white',
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>

            <a
              href={SITE_GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="Open GitHub"
              className="mt-6 inline-flex rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              GitHub
            </a>
          </div>
        </div>
      ) : null}

      <DocsSearchDialog open={searchOpen} query={searchQuery} onClose={closeSearch} onQueryChange={setSearchQuery} />
    </>
  );
}
