import type { ComponentPropsWithoutRef } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { Callout } from '@/components/ui/Callout';
import { Card, CardGrid } from '@/components/ui/Card';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { PageLinkCard } from '@/components/ui/PageLinkCard';
import { Tab, Tabs } from '@/components/ui/Tabs';
import { getWebCinderRouteAttributesForHref } from '@/lib/cinder/routes';
import { cn } from '@/lib/utils/cn';

function MdxAnchor({ className, href = '', ...props }: ComponentPropsWithoutRef<'a'>) {
  if (href.startsWith('/')) {
    return (
      <Link
        to={href}
        {...getWebCinderRouteAttributesForHref(href)}
        className={cn('font-medium text-brand-700 underline decoration-brand-200 underline-offset-4 hover:text-brand-800 dark:text-brand-300 dark:decoration-brand-500/40 dark:hover:text-brand-200', className)}
        {...props}
      />
    );
  }

  return (
    <a
      href={href}
      className={cn('font-medium text-brand-700 underline decoration-brand-200 underline-offset-4 hover:text-brand-800 dark:text-brand-300 dark:decoration-brand-500/40 dark:hover:text-brand-200', className)}
      {...props}
    />
  );
}

export const mdxComponents = {
  h2: ({ className, ...props }: ComponentPropsWithoutRef<'h2'>) => (
    <h2 className={cn('scroll-mt-24 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white', className)} {...props} />
  ),
  h3: ({ className, ...props }: ComponentPropsWithoutRef<'h3'>) => (
    <h3 className={cn('scroll-mt-24 text-xl font-semibold tracking-tight text-slate-950 dark:text-white', className)} {...props} />
  ),
  p: ({ className, ...props }: ComponentPropsWithoutRef<'p'>) => (
    <p className={cn('text-base leading-8 text-slate-600 dark:text-slate-300', className)} {...props} />
  ),
  strong: ({ className, ...props }: ComponentPropsWithoutRef<'strong'>) => (
    <strong className={cn('font-semibold text-slate-950 dark:text-white', className)} {...props} />
  ),
  ul: ({ className, ...props }: ComponentPropsWithoutRef<'ul'>) => (
    <ul className={cn('space-y-3 pl-5 text-base leading-8 text-slate-600 dark:text-slate-300', className)} {...props} />
  ),
  ol: ({ className, ...props }: ComponentPropsWithoutRef<'ol'>) => (
    <ol className={cn('space-y-3 pl-5 text-base leading-8 text-slate-600 dark:text-slate-300', className)} {...props} />
  ),
  li: ({ className, ...props }: ComponentPropsWithoutRef<'li'>) => <li className={cn('pl-1', className)} {...props} />,
  hr: ({ className, ...props }: ComponentPropsWithoutRef<'hr'>) => <hr className={cn('border-slate-200 dark:border-slate-800', className)} {...props} />,
  a: MdxAnchor,
  blockquote: ({ className, ...props }: ComponentPropsWithoutRef<'blockquote'>) => (
    <blockquote className={cn('rounded-r-2xl border-l-4 border-brand-500 bg-brand-50/60 px-5 py-4 text-base leading-8 text-slate-700 dark:bg-brand-500/10 dark:text-slate-200', className)} {...props} />
  ),
  code: ({ className, ...props }: ComponentPropsWithoutRef<'code'>) => (
    <code className={cn('rounded bg-slate-100 px-1.5 py-0.5 text-[0.95em] text-slate-900 dark:bg-slate-800 dark:text-slate-100', className)} {...props} />
  ),
  pre: (props: ComponentPropsWithoutRef<'pre'>) => <CodeBlock {...props} />,
  table: ({ className, ...props }: ComponentPropsWithoutRef<'table'>) => (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
      <table className={cn('min-w-full border-collapse text-left text-sm text-slate-700 dark:text-slate-300', className)} {...props} />
    </div>
  ),
  th: ({ className, ...props }: ComponentPropsWithoutRef<'th'>) => (
    <th className={cn('border-b border-slate-200 bg-slate-50 px-4 py-3 font-semibold text-slate-950 dark:border-slate-800 dark:bg-slate-900 dark:text-white', className)} {...props} />
  ),
  td: ({ className, ...props }: ComponentPropsWithoutRef<'td'>) => (
    <td className={cn('border-b border-slate-100 px-4 py-3 align-top dark:border-slate-800', className)} {...props} />
  ),
  Badge,
  Callout,
  Card,
  CardGrid,
  PageLinkCard,
  Tabs,
  Tab,
};
