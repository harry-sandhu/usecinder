import { Link } from 'react-router-dom';
import { getWebCinderRouteAttributes } from '@/lib/cinder/routes';

interface BreadcrumbsProps {
  group?: string;
  title: string;
}

const groupLinks: Record<string, string> = {
  'Getting Started': '/docs',
  Concepts: '/docs/concepts',
  Guides: '/docs/guides',
  'API Reference': '/docs/api',
  Server: '/docs/server',
};

export function Breadcrumbs({ group, title }: BreadcrumbsProps) {
  const groupHref = group ? groupLinks[group] : undefined;

  return (
    <nav aria-label="Breadcrumb" className="mb-5 flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
      <Link
        to="/docs"
        {...getWebCinderRouteAttributes('/docs')}
        className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-950 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600 dark:hover:bg-slate-900 dark:hover:text-white"
      >
        Docs
      </Link>
      {group ? <span className="text-slate-300 dark:text-slate-600">/</span> : null}
      {group ? (
        groupHref ? (
          <Link to={groupHref} {...getWebCinderRouteAttributes(groupHref)} className="transition-colors hover:text-slate-950 dark:hover:text-white">
            {group}
          </Link>
        ) : (
          <span>{group}</span>
        )
      ) : null}
      <span className="text-slate-300 dark:text-slate-600">/</span>
      <span className="font-medium text-slate-700 dark:text-slate-200">{title}</span>
    </nav>
  );
}
