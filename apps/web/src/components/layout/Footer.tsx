// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { Link } from 'react-router-dom';
import { getWebCinderRouteAttributes } from '@/lib/cinder/routes';
import { SITE_GITHUB_DISCUSSIONS_URL, SITE_GITHUB_ISSUES_URL, SITE_GITHUB_URL } from '@/lib/seo/site';

const footerLinks = [
  { href: '/docs/installation', label: 'Installation' },
  { href: '/docs/quick-start', label: 'Quick Start' },
  { href: '/docs/api', label: 'API' },
  { href: '/docs/architecture', label: 'Architecture' },
  { href: '/docs/guides/debugging', label: 'Debugging' },
  { href: '/relay', label: 'Relay' },
  { href: '/blog', label: 'Blog' },
];

const footerExternalLinks = [
  { href: SITE_GITHUB_ISSUES_URL, label: 'Report an issue' },
  { href: SITE_GITHUB_DISCUSSIONS_URL, label: 'Discussions' },
];

export function Footer() {
  return (
    <footer cinder-context="site-footer" className="border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 text-sm text-slate-600 sm:px-6 lg:flex-row lg:items-center lg:justify-between dark:text-slate-300">
        <div className="space-y-2">
          <p className="font-medium text-slate-900 dark:text-white">Cinder</p>
          <p>Semantic runtime for websites you control. Tag the app, build a graph, resolve commands locally, and fall back only when needed.</p>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between lg:justify-end">
          <div className="flex flex-wrap items-center gap-3 text-slate-500 dark:text-slate-400">
            <span>React</span>
            <span>TypeScript</span>
            <span>Tailwind</span>
            <span>MDX</span>
          </div>

          <nav cinder-context="site-footer-navigation" aria-label="Footer navigation" className="flex flex-wrap items-center gap-4">
            {footerLinks.map((link) => (
              <Link key={link.href} to={link.href} {...getWebCinderRouteAttributes(link.href)} className="font-medium text-slate-600 transition-colors hover:text-slate-950 dark:text-slate-300 dark:hover:text-white">
                {link.label}
              </Link>
            ))}
            <a href={SITE_GITHUB_URL} target="_blank" rel="noreferrer" className="font-medium text-slate-600 transition-colors hover:text-slate-950 dark:text-slate-300 dark:hover:text-white">
              GitHub
            </a>
            {footerExternalLinks.map((link) => (
              <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="font-medium text-slate-600 transition-colors hover:text-slate-950 dark:text-slate-300 dark:hover:text-white">
                {link.label}
              </a>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
