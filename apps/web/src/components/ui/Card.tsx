// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import type { PropsWithChildren } from 'react';
import { cn } from '@/lib/utils/cn';

interface CardProps extends PropsWithChildren {
  title?: string;
  className?: string;
}

export function Card({ children, title, className }: CardProps) {
  return (
    <div className={cn('rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900', className)}>
      {title ? <h3 className="text-lg font-semibold text-slate-950 dark:text-white">{title}</h3> : null}
      <div className={cn(title ? 'mt-3' : '', 'space-y-3 text-sm leading-7 text-slate-600 dark:text-slate-300')}>{children}</div>
    </div>
  );
}

export function CardGrid({ children }: PropsWithChildren) {
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{children}</div>;
}
