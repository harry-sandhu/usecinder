import { useEffect, useState } from 'react';
import type { DocHeading } from '@/types/docs';
import { cn } from '@/lib/utils/cn';

interface TableOfContentsProps {
  sections: DocHeading[];
  compact?: boolean;
}

export function TableOfContents({ sections, compact = false }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string | undefined>(sections[0]?.id);

  useEffect(() => {
    if (sections.length === 0) {
      setActiveId(undefined);
      return undefined;
    }

    function updateActiveId() {
      const threshold = 160;
      let nextActiveId = sections[0]?.id;

      for (const section of sections) {
        const element = document.getElementById(section.id);
        if (!element) {
          continue;
        }

        if (element.getBoundingClientRect().top <= threshold) {
          nextActiveId = section.id;
        }
      }

      setActiveId(nextActiveId);
    }

    updateActiveId();
    window.addEventListener('scroll', updateActiveId, { passive: true });
    window.addEventListener('resize', updateActiveId);

    return () => {
      window.removeEventListener('scroll', updateActiveId);
      window.removeEventListener('resize', updateActiveId);
    };
  }, [sections]);

  if (sections.length === 0) {
    return null;
  }

  const wrapperClassName = compact
    ? 'xl:hidden'
    : 'sticky top-24 hidden xl:block';

  const containerClassName = compact
    ? 'rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60'
    : 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/80';

  return (
    <aside className={wrapperClassName}>
      <div className={containerClassName}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">On this page</p>
          <span className="text-xs text-slate-400 dark:text-slate-500">{sections.length} sections</span>
        </div>
        <nav aria-label="Table of contents" className={cn('mt-4', compact ? 'grid gap-2 sm:grid-cols-2' : 'space-y-2')}>
          {sections.map((section) => {
            const isActive = section.id === activeId;

            return (
              <a
                key={section.id}
                href={`#${section.id}`}
                aria-current={isActive ? 'location' : undefined}
                className={cn(
                  'block rounded-lg border-l-2 border-transparent pl-3 text-sm leading-6 text-slate-600 transition-colors hover:text-slate-950 dark:text-slate-300 dark:hover:text-white',
                  section.depth === 3 ? 'ml-3 text-slate-500 dark:text-slate-400' : '',
                  compact ? 'bg-white/80 py-2 pr-3 dark:bg-slate-900/80' : '',
                  isActive ? 'border-brand-500 bg-brand-50/60 font-medium text-slate-950 dark:bg-brand-500/10 dark:text-white' : '',
                )}
              >
                {section.title}
              </a>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
