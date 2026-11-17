import { Children, isValidElement } from 'react';
import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from 'react';
import { renderHighlightedCode } from '@/lib/code/highlight';
import { cn } from '@/lib/utils/cn';
import { CopyButton } from './CopyButton';

interface CodeBlockProps extends ComponentPropsWithoutRef<'pre'> {
  children?: ReactNode;
}

function extractCode(children: ReactNode) {
  const childArray = Children.toArray(children);

  if (childArray.length !== 1 || !isValidElement(childArray[0])) {
    return {
      code: childArray.map((child) => (typeof child === 'string' ? child : '')).join(''),
      language: undefined,
    };
  }

  const child = childArray[0] as ReactElement<{ children?: ReactNode; className?: string }>;
  const code = typeof child.props.children === 'string' ? child.props.children : String(child.props.children ?? '');
  const language = child.props.className?.replace(/^language-/, '');

  return {
    code,
    language,
  };
}

export function CodeBlock({ children, className, ...props }: CodeBlockProps) {
  const { code, language } = extractCode(children);
  const lineCount = code === '' ? 0 : code.replace(/\n$/, '').split('\n').length;

  return (
    <div className="overflow-hidden rounded-2xl bg-slate-950 shadow-soft ring-1 ring-black/10 transition-shadow duration-200 hover:shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{language ?? 'Code'}</div>
          <div className="text-xs text-slate-500">{lineCount} {lineCount === 1 ? 'line' : 'lines'}</div>
        </div>
        <CopyButton value={code} />
      </div>
      <pre className={cn('overflow-x-auto p-4 text-sm leading-7 text-slate-100 sm:p-5', className)} {...props}>
        <code>{renderHighlightedCode(code, language)}</code>
      </pre>
    </div>
  );
}
