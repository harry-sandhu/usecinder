import { Children, isValidElement, useMemo, useState } from 'react';
import type { PropsWithChildren, ReactElement, ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

interface TabProps extends PropsWithChildren {
  label: string;
}

export function Tab({ children }: TabProps) {
  return <>{children}</>;
}

interface TabItem {
  label: string;
  content: ReactNode;
}

interface TabsProps extends PropsWithChildren {
  defaultTab?: string;
}

export function Tabs({ children, defaultTab }: TabsProps) {
  const items = useMemo<TabItem[]>(() => {
    return Children.toArray(children)
      .filter(isValidElement)
      .map((child) => {
        const element = child as ReactElement<TabProps>;
        return {
          label: element.props.label,
          content: element.props.children,
        };
      });
  }, [children]);

  const [activeLabel, setActiveLabel] = useState(defaultTab ?? items[0]?.label ?? '');
  const activeItem = items.find((item) => item.label === activeLabel) ?? items[0];

  if (!activeItem) {
    return null;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/80">
      <div className="flex flex-wrap gap-2 border-b border-slate-200 px-3 py-3 dark:border-slate-800">
        {items.map((item) => {
          const active = item.label === activeItem.label;
          return (
            <button
              key={item.label}
              type="button"
              onClick={() => setActiveLabel(item.label)}
              className={cn(
                'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950'
                  : 'text-slate-600 hover:bg-white hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <div className="bg-white p-4 dark:bg-slate-950">{activeItem.content}</div>
    </div>
  );
}
