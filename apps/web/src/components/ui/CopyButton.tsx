import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils/cn';

interface CopyButtonProps {
  value: string;
  className?: string;
}

export function CopyButton({ value, className }: CopyButtonProps) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (status === 'idle') {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setStatus('idle');
    }, 1800);

    return () => window.clearTimeout(timer);
  }, [status]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
  }

  const label = status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed' : 'Copy';

  return (
    <button
      id="copy-code-button"
      type="button"
      aria-live="polite"
      aria-label={status === 'copied' ? 'Code copied' : status === 'failed' ? 'Copy failed' : 'Copy code block'}
      title={status === 'copied' ? 'Code copied' : status === 'failed' ? 'Copy failed' : 'Copy code block'}
      onClick={handleCopy}
      className={cn(
        'inline-flex items-center justify-center rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all duration-200 motion-reduce:transform-none',
        status === 'copied'
          ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200'
          : status === 'failed'
            ? 'border-amber-400/40 bg-amber-500/15 text-amber-200'
            : 'border-white/10 bg-white/5 text-slate-100 hover:bg-white/10 hover:-translate-y-0.5',
        className,
      )}
    >
      {label}
    </button>
  );
}
