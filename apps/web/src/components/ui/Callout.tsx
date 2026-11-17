import type { PropsWithChildren } from 'react';
import { cn } from '@/lib/utils/cn';

type CalloutVariant = 'info' | 'tip' | 'warning';

interface CalloutProps extends PropsWithChildren {
  variant?: CalloutVariant;
  title?: string;
}

const variantClasses: Record<CalloutVariant, { container: string; badge: string }> = {
  info: {
    container: 'border-brand-200 bg-brand-50/70 text-slate-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-slate-200',
    badge: 'bg-brand-600 text-white dark:bg-brand-500 dark:text-slate-950',
  },
  tip: {
    container: 'border-emerald-200 bg-emerald-50/80 text-slate-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-slate-200',
    badge: 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-slate-950',
  },
  warning: {
    container: 'border-amber-200 bg-amber-50/90 text-slate-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-slate-200',
    badge: 'bg-amber-500 text-slate-950 dark:bg-amber-400 dark:text-slate-950',
  },
};

export function Callout({ children, title, variant = 'info' }: CalloutProps) {
  const classes = variantClasses[variant];

  return (
    <div className={cn('rounded-2xl border px-5 py-4', classes.container)}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={cn('inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]', classes.badge)}>
          {title ?? variant}
        </span>
      </div>
      <div className="mt-3 space-y-3 text-sm leading-7">{children}</div>
    </div>
  );
}
