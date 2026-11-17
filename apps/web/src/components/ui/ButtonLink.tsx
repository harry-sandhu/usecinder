import type { AnchorHTMLAttributes, PropsWithChildren } from 'react';
import { getWebCinderRouteAttributesForHref } from '@/lib/cinder/routes';
import { cn } from '@/lib/utils/cn';

type ButtonLinkProps = PropsWithChildren<AnchorHTMLAttributes<HTMLAnchorElement>> & {
  variant?: 'primary' | 'secondary';
};

export function ButtonLink({ children, className, variant = 'primary', href, ...props }: ButtonLinkProps) {
  const semanticRouteAttributes = getWebCinderRouteAttributesForHref(href);

  return (
    <a
      href={href}
      {...semanticRouteAttributes}
      className={cn(
        'inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200 motion-reduce:transform-none hover:-translate-y-0.5',
        variant === 'primary'
          ? 'bg-slate-950 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100'
          : 'border border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-600 dark:hover:bg-slate-800',
        className,
      )}
      {...props}
    >
      {children}
    </a>
  );
}
