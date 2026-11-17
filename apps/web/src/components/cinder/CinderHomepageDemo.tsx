import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CinderRunResult,
  CinderSpeechError,
  CinderSpeechStatus,
  CinderSpeechTranscriptEvent,
} from 'usecinder';
import { Cinder } from 'usecinder';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Badge } from '@/components/ui/Badge';
import { Callout } from '@/components/ui/Callout';
import { bootWebCinder } from '@/lib/cinder/runtime';
import { cn } from '@/lib/utils/cn';

const exampleCommands = [
  'open quick start',
  'open installation',
  'open api overview',
  'open debugging',
];

type DemoCommandSource = 'text' | 'voice';

interface DemoCommandState {
  input: string;
  source: DemoCommandSource;
  result: CinderRunResult;
}

interface BrowserSpeechSupportState {
  available: boolean;
  constructorName?: 'SpeechRecognition' | 'webkitSpeechRecognition';
  checked: string[];
  isSecureContext?: boolean;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatIntentSummary(result: CinderRunResult) {
  const parts = [result.intent.intent];

  if (typeof result.intent.target === 'string' && result.intent.target) {
    parts.push(`→ ${result.intent.target}`);
  }

  parts.push(`(${result.intent.source})`);
  return parts.join(' ');
}

function detectBrowserSpeechSupport(): BrowserSpeechSupportState {
  if (typeof window === 'undefined') {
    return {
      available: false,
      checked: ['window.SpeechRecognition', 'window.webkitSpeechRecognition'],
    };
  }

  const speechWindow = window as Window & {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };

  if (speechWindow.SpeechRecognition) {
    return {
      available: true,
      constructorName: 'SpeechRecognition',
      checked: ['window.SpeechRecognition'],
      isSecureContext: window.isSecureContext,
    };
  }

  if (speechWindow.webkitSpeechRecognition) {
    return {
      available: true,
      constructorName: 'webkitSpeechRecognition',
      checked: ['window.SpeechRecognition', 'window.webkitSpeechRecognition'],
      isSecureContext: window.isSecureContext,
    };
  }

  return {
    available: false,
    checked: ['window.SpeechRecognition', 'window.webkitSpeechRecognition'],
    isSecureContext: window.isSecureContext,
  };
}

function getStatusBadge(
  ready: boolean,
  runtimeError: string | undefined,
  speechStatus: CinderSpeechStatus,
) {
  if (runtimeError) {
    return {
      label: 'error',
      className:
        'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300',
    };
  }

  if (!ready) {
    return {
      label: 'warming',
      className:
        'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
    };
  }

  if (speechStatus === 'listening') {
    return {
      label: 'listening',
      className:
        'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
    };
  }

  if (speechStatus === 'unsupported') {
    return {
      label: 'active / text only',
      className:
        'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    };
  }

  return {
    label: 'active',
    className:
      'bg-brand-100 text-brand-800 dark:bg-brand-500/15 dark:text-brand-300',
  };
}

export function CinderHomepageDemo() {
  const [ready, setReady] = useState(false);
  const [command, setCommand] = useState('');
  const [running, setRunning] = useState(false);
  const [speechStatus, setSpeechStatus] = useState<CinderSpeechStatus>(() => Cinder.speechStatus());
  const [transcript, setTranscript] = useState('');
  const [runtimeError, setRuntimeError] = useState<string | undefined>();
  const [speechError, setSpeechError] = useState<CinderSpeechError | undefined>();
  const [lastCommand, setLastCommand] = useState<DemoCommandState | undefined>();
  const [browserSpeechSupport, setBrowserSpeechSupport] = useState<BrowserSpeechSupportState>(() => detectBrowserSpeechSupport());

  const runCommand = useCallback(async (input: string, source: DemoCommandSource) => {
    const trimmed = input.trim();
    if (!trimmed) {
      return;
    }

    setRunning(true);
    setRuntimeError(undefined);
    setSpeechError(undefined);
    setCommand(trimmed);

    try {
      await bootWebCinder(document);
      setReady(true);

      const result = await Cinder.run(trimmed, document);
      setLastCommand({
        input: trimmed,
        source,
        result,
      });
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : 'Unknown Cinder runtime error.');
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void bootWebCinder(document)
      .then(() => {
        if (cancelled) {
          return;
        }

        setReady(true);
        setSpeechStatus(Cinder.speechStatus());
        setBrowserSpeechSupport(detectBrowserSpeechSupport());
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setRuntimeError(error instanceof Error ? error.message : 'Failed to activate Cinder on this page.');
        setBrowserSpeechSupport(detectBrowserSpeechSupport());
      });

    const handleTranscript = (event: CinderSpeechTranscriptEvent) => {
      setTranscript(event.transcript);
      setCommand(event.transcript);

      if (!event.isFinal || !event.transcript.trim()) {
        return;
      }

      void runCommand(event.transcript, 'voice');
    };

    const handleSpeechError = (error: CinderSpeechError) => {
      setSpeechError(error);
      setSpeechStatus('error');
    };

    const handleSpeechStart = () => {
      setSpeechStatus('listening');
      setSpeechError(undefined);
    };

    const handleSpeechEnd = (payload: { status: CinderSpeechStatus }) => {
      setSpeechStatus(payload.status);
    };

    Cinder.onTranscript(handleTranscript);
    Cinder.onSpeechError(handleSpeechError);
    Cinder.on('speech:start', handleSpeechStart);
    Cinder.on('speech:end', handleSpeechEnd);

    return () => {
      cancelled = true;
      Cinder.offTranscript(handleTranscript);
      Cinder.offSpeechError(handleSpeechError);
      Cinder.off('speech:start', handleSpeechStart);
      Cinder.off('speech:end', handleSpeechEnd);
      Cinder.stopListening();
    };
  }, [runCommand]);

  const statusBadge = useMemo(
    () => getStatusBadge(ready, runtimeError, speechStatus),
    [ready, runtimeError, speechStatus],
  );

  async function handleVoiceToggle() {
    if (speechStatus === 'listening') {
      Cinder.stopListening();
      setSpeechStatus(Cinder.speechStatus());
      return;
    }

    setSpeechError(undefined);
    setTranscript('');
    setRuntimeError(undefined);

    try {
      await bootWebCinder(document);
      setReady(true);

      const result = await Cinder.listen({
        autoRun: false,
        continuous: false,
        interimResults: true,
        root: document,
      });

      setSpeechStatus(result.status);

      if (!result.ok && result.message) {
        setSpeechError({
          code: result.status === 'unsupported' ? 'unsupported' : 'speech-error',
          message: result.message,
        });
      }
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : 'Failed to start speech input.');
    }
  }

  return (
    <section cinder-context="home-live-demo" className="border-y border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950/60">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 sm:py-16 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
        <div className="space-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-700 dark:text-brand-300">See it on a real site</p>
          <h2 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
            Cinder is active on this docs website.
          </h2>
          <p className="text-base leading-8 text-slate-600 dark:text-slate-300">
            This homepage is not just describing the SDK. The docs site is tagged, bootstrapped with the public browser API,
            and ready for text or voice commands right here.
          </p>
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Try saying or typing:</p>
            <ul cinder-context="home-live-demo-examples" className="space-y-2 text-sm leading-7 text-slate-600 dark:text-slate-300">
              {exampleCommands.map((example) => (
                <li key={example} className="flex items-start gap-2">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-brand-600 dark:bg-brand-400" />
                  <span>{example}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs leading-6 text-slate-500 dark:text-slate-400">
              Voice only asks for microphone permission after you click <strong>Start voice demo</strong>.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 pt-1">
            <ButtonLink href="/docs/guides/tagging-a-page" variant="secondary">
              See the tagging pattern
            </ButtonLink>
            <ButtonLink href="/docs/guides/using-speech" variant="secondary">
              Speech integration guide
            </ButtonLink>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-slate-900 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-700 dark:text-brand-300">Live demo</p>
              <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">Try Cinder on this site</h3>
              <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">
                Use one example command, type your own, or start voice input. The site should navigate the same way a real
                Cinder-enabled website would.
              </p>
            </div>
            <span
              className={cn(
                'rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em]',
                statusBadge.className,
              )}
            >
              {statusBadge.label}
            </span>
          </div>

          <div cinder-context="home-live-demo-actions" className="mt-6 space-y-4">
            <div className="flex flex-wrap gap-2">
              {exampleCommands.map((example) => (
                <button
                  key={example}
                  type="button"
                  cinder-action={`try-${slugify(example)}`}
                  onClick={() => void runCommand(example, 'text')}
                  disabled={running}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
                >
                  {example}
                </button>
              ))}
            </div>

            <form
              className="flex flex-col gap-3 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                void runCommand(command, 'text');
              }}
            >
              <input
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder="Try: open quick start"
                cinder-field="home-demo-command"
                className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-brand-300 focus:bg-white dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500"
              />
              <div className="flex gap-3">
                <button
                  type="submit"
                  cinder-action="run-home-demo-command"
                  disabled={running || !command.trim()}
                  className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
                >
                  {running ? 'Running…' : 'Run command'}
                </button>
                <button
                  type="button"
                  cinder-action="toggle-home-demo-voice"
                  onClick={() => void handleVoiceToggle()}
                  disabled={!browserSpeechSupport.available && speechStatus !== 'listening'}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-600 dark:hover:bg-slate-800"
                >
                  {speechStatus === 'listening'
                    ? 'Stop voice'
                    : browserSpeechSupport.available
                      ? 'Start voice demo'
                      : 'Voice unavailable here'}
                </button>
              </div>
            </form>

            <div className="grid gap-3 md:grid-cols-2">
              <div cinder-output="home-demo-transcript" aria-live="polite" className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Transcript</p>
                <p className="mt-2 text-sm leading-7 text-slate-700 dark:text-slate-300">
                  {transcript ? transcript : speechStatus === 'listening' ? 'Listening… speak one of the example commands.' : 'No voice transcript yet.'}
                </p>
              </div>

              <div cinder-output="home-demo-result" aria-live="polite" className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Last result</p>
                {lastCommand ? (
                  <div className="mt-2 space-y-1 text-sm leading-7 text-slate-700 dark:text-slate-300">
                    <p><strong>Command:</strong> {lastCommand.input}</p>
                    <p><strong>Source:</strong> {lastCommand.source}</p>
                    <p><strong>Intent:</strong> {formatIntentSummary(lastCommand.result)}</p>
                    <p>
                      <strong>Dispatch:</strong> {lastCommand.result.dispatch.handled ? 'handled' : 'not handled'} / {lastCommand.result.dispatch.mode}
                    </p>
                  </div>
                ) : (
                  <p className="mt-2 text-sm leading-7 text-slate-700 dark:text-slate-300">Run a command to see the resolved intent and dispatch outcome.</p>
                )}
              </div>
            </div>

            <Callout
              variant={browserSpeechSupport.available ? 'tip' : 'warning'}
              title={browserSpeechSupport.available ? 'Voice demo status' : 'Voice unavailable in this browser'}
            >
              <div className="flex flex-wrap gap-2">
                <Badge tone={browserSpeechSupport.available ? 'success' : 'warning'}>
                  {browserSpeechSupport.available
                    ? `Detected ${browserSpeechSupport.constructorName}`
                    : 'No speech constructor detected'}
                </Badge>
                <Badge tone={browserSpeechSupport.isSecureContext === false ? 'warning' : 'default'}>
                  {browserSpeechSupport.isSecureContext === false ? 'Not a secure context' : 'Secure-context check passed or not required here'}
                </Badge>
              </div>
              {browserSpeechSupport.available ? (
                <div className="space-y-2">
                  <p>
                    This page can see <strong>{browserSpeechSupport.constructorName}</strong> on the browser window. When you click{' '}
                    <strong>Start voice demo</strong>, the browser should request microphone permission and stream transcripts into the same Cinder runtime used by text commands.
                  </p>
                  <p>
                    Important: detecting the constructor means the browser exposes the Web Speech API surface. It does <strong>not</strong> guarantee the underlying speech service will succeed. Runtime failures like <code>network</code>, <code>not-allowed</code>, or <code>audio-capture</code> can still happen.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p>
                    This page could not find <strong>SpeechRecognition</strong> or <strong>webkitSpeechRecognition</strong> on the browser window, so the voice demo is disabled here. Text commands still work normally.
                  </p>
                  <p>
                    Checked: <code>{browserSpeechSupport.checked.join(', ')}</code>
                  </p>
                  <p>
                    Try the docs site in a current Chromium-based browser like <strong>Chrome</strong> or <strong>Edge</strong>. Browser speech support can also depend on OS build, browser flags, and secure-context policy.
                  </p>
                </div>
              )}
            </Callout>

            {speechError ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-7 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.14em]">Speech error</span>
                  <Badge tone="warning">{speechError.code}</Badge>
                </div>
                <p className="mt-2">{speechError.message}</p>
              </div>
            ) : null}

            {runtimeError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-7 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                {runtimeError}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
