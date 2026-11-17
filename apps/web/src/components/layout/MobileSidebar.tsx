import { DocsSidebar } from './DocsSidebar';

interface MobileSidebarProps {
  open: boolean;
  onClose: () => void;
}

export function MobileSidebar({ open, onClose }: MobileSidebarProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 lg:hidden" aria-modal="true" role="dialog">
      <button
        type="button"
        cinder-action="close-docs-navigation"
        aria-label="Close documentation navigation"
        className="absolute inset-0 bg-slate-950/35 backdrop-blur-sm dark:bg-slate-950/70"
        onClick={onClose}
      />
      <div
        id="mobile-docs-sidebar"
        cinder-context="mobile-docs-sidebar"
        className="absolute left-0 top-0 h-full w-[min(22rem,90vw)] overflow-y-auto border-r border-slate-200 bg-white px-5 py-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950"
      >
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-700 dark:text-brand-300">Docs</p>
            <h2 className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">Browse pages</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">Use the site search from the header for method names, concepts, and guide tasks.</p>
          </div>
          <button
            type="button"
            cinder-action="close-docs-navigation"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </div>
        <DocsSidebar onNavigate={onClose} contextKey="mobile-docs-sidebar-links" />
      </div>
    </div>
  );
}
