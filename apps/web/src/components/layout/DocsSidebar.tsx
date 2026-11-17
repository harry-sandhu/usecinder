import { useEffect, useRef } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { getDocsNavigation } from '@/lib/docs/docs';
import { getWebCinderRouteAttributes } from '@/lib/cinder/routes';
import { cn } from '@/lib/utils/cn';

interface DocsSidebarProps {
  onNavigate?: () => void;
  contextKey?: string;
}

const quickPaths = [
  {
    href: '/docs/quick-start',
    title: 'First working integration',
    description: 'Install, tag one page, scan it, and run a first command.',
  },
  {
    href: '/docs/guides/debugging',
    title: 'Debug a confusing result',
    description: 'Inspect scan, graph, active route/context, and dispatch in the right order.',
  },
  {
    href: '/docs/api',
    title: 'Browse the SDK surface',
    description: 'See runtime methods, hooks, extension points, and lifecycle APIs.',
  },
  {
    href: '/docs/server',
    title: 'Add bounded fallback',
    description: 'Use the server path only after the local-first browser path already works.',
  },
];

const headerTaggedRoutes = new Set(['/docs', '/docs/quick-start', '/docs/api', '/docs/architecture']);

export function DocsSidebar({ onNavigate, contextKey = 'docs-sidebar' }: DocsSidebarProps) {
  const navigation = getDocsNavigation();
  const location = useLocation();
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const activeLink = navRef.current?.querySelector<HTMLElement>('[data-doc-link-active="true"]');
    activeLink?.scrollIntoView({ block: 'nearest' });
  }, [location.pathname]);

  return (
    <nav ref={navRef} id="docs-sidebar-nav" cinder-context={contextKey} aria-label="Documentation navigation" className="space-y-8">
      <div className="space-y-3">
        <h2 className="px-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Quick paths</h2>
        <div className="space-y-2">
          {quickPaths.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              onClick={onNavigate}
              {...getWebCinderRouteAttributes(item.href)}
              className="block rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 transition-colors hover:border-brand-200 hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:hover:border-brand-500/30 dark:hover:bg-slate-900"
            >
              <h3 className="text-sm font-semibold text-slate-950 dark:text-white">{item.title}</h3>
              <p className="mt-1 text-xs leading-6 text-slate-600 dark:text-slate-300">{item.description}</p>
            </Link>
          ))}
        </div>
      </div>

      {navigation.map((group) => {
        const groupIsActive = group.items.some((item) => item.href === location.pathname);

        return (
          <div key={group.title} id={`docs-group-${group.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} className="space-y-3">
            <h2 className={cn('px-3 text-xs font-semibold uppercase tracking-[0.18em]', groupIsActive ? 'text-brand-700 dark:text-brand-300' : 'text-slate-500 dark:text-slate-400')}>
              {group.title}
            </h2>
            <div className="space-y-1">
              {group.items.map((item) => (
                <NavLink
                  key={item.href}
                  to={item.href}
                  onClick={onNavigate}
                  end={item.href === '/docs'}
                  aria-label={`Open ${item.title}`}
                  {...(headerTaggedRoutes.has(item.href) ? {} : getWebCinderRouteAttributes(item.href))}
                  className={({ isActive }) =>
                    cn(
                      'block rounded-xl px-3 py-2.5 text-sm transition-colors',
                      isActive
                        ? 'bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-950'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white',
                    )
                  }
                >
                  {({ isActive }) => (
                    <span data-doc-link-active={isActive ? 'true' : 'false'} className="block">
                      {item.title}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
