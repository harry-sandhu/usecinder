// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageMetadata } from '@/components/seo/PageMetadata';
import { Card } from '@/components/ui/Card';
import { login, signup, RelayApiError } from '@/lib/relay/client';
import { DEFAULT_RELAY_BASE_URL, loadRelaySession, saveRelaySession } from '@/lib/relay/session';

const inputClassName =
  'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white';

export function RelayAuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [baseUrl, setBaseUrl] = useState(DEFAULT_RELAY_BASE_URL);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (loadRelaySession()) {
      navigate('/relay/dashboard');
    }
  }, [navigate]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    setSubmitting(true);

    try {
      const session = mode === 'login' ? await login(baseUrl, email, password) : await signup(baseUrl, email, password);
      saveRelaySession(session);
      navigate('/relay/dashboard');
    } catch (cause) {
      setError(cause instanceof RelayApiError ? cause.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16 sm:px-6">
      <PageMetadata title="Relay sign in" description="Sign in to manage your @cinder/relay projects, balances, and usage." noindex />

      <div className="mb-8 text-center">
        <Link to="/relay" className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-700 hover:underline dark:text-brand-300">
          @cinder/relay
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
          {mode === 'login' ? 'Sign in to your relay account' : 'Create a relay account'}
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Manage projects, wallet balances, and usage for your own relay server.
        </p>
      </div>

      <Card>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="relay-base-url" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Relay server URL
            </label>
            <input
              id="relay-base-url"
              type="url"
              required
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="http://localhost:8081"
              className={inputClassName}
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">
              Your own self-hosted or <code>cinder-relay</code>-deployed server - this dashboard never talks to anything else.
            </p>
          </div>

          <div>
            <label htmlFor="relay-email" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Email
            </label>
            <input
              id="relay-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={inputClassName}
            />
          </div>

          <div>
            <label htmlFor="relay-password" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Password
            </label>
            <input
              id="relay-password"
              type="password"
              required
              minLength={8}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClassName}
            />
          </div>

          {error ? (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
          >
            {submitting ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode((current) => (current === 'login' ? 'signup' : 'login'));
            setError(undefined);
          }}
          className="mt-4 w-full text-center text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
        >
          {mode === 'login' ? "Don't have an account? Create one" : 'Already have an account? Sign in'}
        </button>
      </Card>
    </div>
  );
}
