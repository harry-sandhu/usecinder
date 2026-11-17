import { Link } from 'react-router-dom';
import { getWebCinderRouteAttributesForHref } from '@/lib/cinder/routes';

interface PageLinkCardProps {
  title: string;
  description: string;
  href: string;
}

export function PageLinkCard({ title, description, href }: PageLinkCardProps) {
  return (
    <Link
      to={href}
      aria-label={`Open ${title}`}
      {...getWebCinderRouteAttributesForHref(href)}
      className="group block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-200 motion-reduce:transform-none hover:-translate-y-1 hover:border-slate-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-950 transition-colors group-hover:text-brand-700 dark:text-white dark:group-hover:text-brand-300">{title}</h3>
          <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">{description}</p>
        </div>
        <span className="text-slate-300 transition-colors group-hover:text-brand-600 dark:text-slate-600 dark:group-hover:text-brand-300">→</span>
      </div>
    </Link>
  );
}
