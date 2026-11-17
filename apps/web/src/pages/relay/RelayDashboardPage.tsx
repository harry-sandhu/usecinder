import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageMetadata } from '@/components/seo/PageMetadata';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import {
  RelayApiError,
  createProject,
  getProjectUsage,
  listProjects,
  topUpProject,
  type RelayProjectSummary,
  type RelayUsageEventSummary,
} from '@/lib/relay/client';
import { clearRelaySession, loadRelaySession } from '@/lib/relay/session';

const inputClassName =
  'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white';

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function RelayDashboardPage() {
  const navigate = useNavigate();
  // loadRelaySession() parses a fresh object out of localStorage on every call - reading it
  // directly into a render-time const would hand the data-fetch effect below a new object
  // reference on every render (even though its *contents* never change), re-triggering the
  // effect forever. useState's initializer runs exactly once, giving a stable reference.
  const [session] = useState(() => loadRelaySession());

  const [projects, setProjects] = useState<RelayProjectSummary[]>([]);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(undefined);
  const [usage, setUsage] = useState<RelayUsageEventSummary[] | undefined>(undefined);
  const [usageError, setUsageError] = useState<string | undefined>(undefined);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [provider, setProvider] = useState<'anthropic' | 'openai'>('anthropic');
  const [keyPolicy, setKeyPolicy] = useState<'developer' | 'end_user'>('developer');
  const [providerApiKey, setProviderApiKey] = useState('');
  const [providerModel, setProviderModel] = useState('');

  const [topUpAmount, setTopUpAmount] = useState('500');
  const [topUpError, setTopUpError] = useState<string | undefined>(undefined);
  const [toppingUp, setToppingUp] = useState(false);

  const refreshProjects = useCallback(async () => {
    if (!session) {
      return;
    }

    setLoading(true);
    setLoadError(undefined);

    try {
      const result = await listProjects(session);
      setProjects(result);
    } catch (cause) {
      setLoadError(cause instanceof RelayApiError ? cause.message : 'Could not load projects.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!session) {
      navigate('/relay/login');
      return;
    }

    void refreshProjects();
  }, [navigate, refreshProjects, session]);

  const refreshUsage = useCallback(
    async (projectId: string) => {
      if (!session) {
        return;
      }

      setUsageError(undefined);

      try {
        const result = await getProjectUsage(session, projectId);
        setUsage(result.usage);
        setProjects((current) => current.map((project) => (project.id === projectId ? result.project : project)));
      } catch (cause) {
        setUsageError(cause instanceof RelayApiError ? cause.message : 'Could not load usage.');
      }
    },
    [session],
  );

  useEffect(() => {
    if (selectedProjectId) {
      void refreshUsage(selectedProjectId);
    } else {
      setUsage(undefined);
    }
  }, [refreshUsage, selectedProjectId]);

  if (!session) {
    return null;
  }

  async function handleCreateProject(event: FormEvent) {
    event.preventDefault();
    if (!session) {
      return;
    }

    setCreateError(undefined);
    setCreating(true);

    try {
      await createProject(session, {
        provider,
        keyPolicy,
        providerApiKey: keyPolicy === 'developer' ? providerApiKey : undefined,
        providerModel: providerModel || undefined,
      });
      setShowCreateForm(false);
      setProviderApiKey('');
      setProviderModel('');
      await refreshProjects();
    } catch (cause) {
      setCreateError(cause instanceof RelayApiError ? cause.message : 'Could not create project.');
    } finally {
      setCreating(false);
    }
  }

  async function handleTopUp(event: FormEvent) {
    event.preventDefault();
    const selected = projects.find((project) => project.id === selectedProjectId);
    if (!selected || !session) {
      return;
    }

    setTopUpError(undefined);
    setToppingUp(true);

    try {
      const amountCents = Math.round(Number(topUpAmount) * 100);
      await topUpProject(session.baseUrl, selected.apiKey, amountCents);
      await refreshUsage(selected.id);
    } catch (cause) {
      setTopUpError(cause instanceof RelayApiError ? cause.message : 'Top-up failed.');
    } finally {
      setToppingUp(false);
    }
  }

  function handleSignOut() {
    clearRelaySession();
    navigate('/relay');
  }

  const selectedProject = projects.find((project) => project.id === selectedProjectId);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <PageMetadata title="Relay dashboard" description="Manage your @cinder/relay projects, balances, and usage." noindex />

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-700 dark:text-brand-300">@cinder/relay</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Signed in as <span className="font-medium text-slate-900 dark:text-white">{session.email}</span> · {session.baseUrl}
          </p>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
        >
          Sign out
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Projects</h2>
            <button
              type="button"
              onClick={() => setShowCreateForm((current) => !current)}
              className="rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
            >
              {showCreateForm ? 'Cancel' : 'New project'}
            </button>
          </div>

          {showCreateForm ? (
            <Card>
              <form onSubmit={handleCreateProject} className="space-y-3">
                <div>
                  <label htmlFor="relay-provider" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Provider
                  </label>
                  <select
                    id="relay-provider"
                    value={provider}
                    onChange={(event) => setProvider(event.target.value as 'anthropic' | 'openai')}
                    className={inputClassName}
                  >
                    <option value="anthropic">Anthropic</option>
                    <option value="openai">OpenAI</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="relay-key-policy" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Who supplies the AI provider key?
                  </label>
                  <select
                    id="relay-key-policy"
                    value={keyPolicy}
                    onChange={(event) => setKeyPolicy(event.target.value as 'developer' | 'end_user')}
                    className={inputClassName}
                  >
                    <option value="developer">Me (the developer) - stored once</option>
                    <option value="end_user">My app's end user - sent per request, never stored</option>
                  </select>
                </div>

                {keyPolicy === 'developer' ? (
                  <div>
                    <label htmlFor="relay-provider-key" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key
                    </label>
                    <input
                      id="relay-provider-key"
                      type="password"
                      required
                      value={providerApiKey}
                      onChange={(event) => setProviderApiKey(event.target.value)}
                      placeholder={provider === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
                      className={inputClassName}
                    />
                  </div>
                ) : null}

                <div>
                  <label htmlFor="relay-model" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Model (optional - uses the server default if left blank)
                  </label>
                  <input
                    id="relay-model"
                    type="text"
                    value={providerModel}
                    onChange={(event) => setProviderModel(event.target.value)}
                    placeholder={provider === 'anthropic' ? 'claude-haiku-5-5' : 'gpt-4o-mini'}
                    className={inputClassName}
                  />
                </div>

                {createError ? (
                  <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                    {createError}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={creating}
                  className="w-full rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
                >
                  {creating ? 'Creating…' : 'Create project'}
                </button>
              </form>
            </Card>
          ) : null}

          {loading ? <p className="text-sm text-slate-500 dark:text-slate-400">Loading projects…</p> : null}

          {loadError ? (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              {loadError}
            </p>
          ) : null}

          {!loading && !loadError && projects.length === 0 ? (
            <Card>
              <p>No projects yet. Create one to get a real relay API key for your app's <code>config.ai.endpoint</code>.</p>
            </Card>
          ) : null}

          <div className="space-y-2">
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => setSelectedProjectId(project.id)}
                className={`w-full rounded-xl border p-4 text-left transition-colors ${
                  project.id === selectedProjectId
                    ? 'border-brand-400 bg-brand-50 dark:border-brand-500/50 dark:bg-brand-500/10'
                    : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge tone="brand">{project.provider}</Badge>
                    <Badge tone={project.keyPolicy === 'developer' ? 'default' : 'warning'}>
                      {project.keyPolicy === 'developer' ? 'your key' : "end user's key"}
                    </Badge>
                  </div>
                  <Badge tone={project.balanceCents > 0 ? 'success' : 'warning'}>{formatCents(project.balanceCents)}</Badge>
                </div>
                <p className="mt-2 font-mono text-xs text-slate-500 dark:text-slate-400">{project.id}</p>
              </button>
            ))}
          </div>
        </div>

        <div>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Project detail</h2>

          {!selectedProject ? (
            <Card>
              <p>Select a project to see its API key, balance, and usage history.</p>
            </Card>
          ) : (
            <div className="space-y-4">
              <Card title="Connection">
                <p>
                  Point your app's Cinder config at this server and use this project's API key as its bearer token
                  for tier-3 calls.
                </p>
                <dl className="mt-2 space-y-1">
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500 dark:text-slate-400">Relay URL</dt>
                    <dd className="font-mono text-xs">{session.baseUrl}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500 dark:text-slate-400">Project API key</dt>
                    <dd className="font-mono text-xs">{selectedProject.apiKey}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500 dark:text-slate-400">Model</dt>
                    <dd>{selectedProject.providerModel || '(server default)'}</dd>
                  </div>
                </dl>
              </Card>

              <Card title="Wallet">
                <div className="flex items-center justify-between">
                  <span>Current balance</span>
                  <span className="text-lg font-semibold text-slate-950 dark:text-white">{formatCents(selectedProject.balanceCents)}</span>
                </div>

                <form onSubmit={handleTopUp} className="flex items-end gap-2 pt-2">
                  <div className="flex-1">
                    <label htmlFor="relay-topup-amount" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Top up (USD)
                    </label>
                    <input
                      id="relay-topup-amount"
                      type="number"
                      min="1"
                      step="0.01"
                      value={topUpAmount}
                      onChange={(event) => setTopUpAmount(event.target.value)}
                      className={inputClassName}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={toppingUp}
                    className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
                  >
                    {toppingUp ? 'Topping up…' : 'Top up'}
                  </button>
                </form>
                <p className="text-xs text-slate-500 dark:text-slate-500">
                  Uses the server's configured payment provider - the stub, instant-credit provider on a local/dev
                  server, or real Razorpay checkout if the server has it configured.
                </p>

                {topUpError ? (
                  <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                    {topUpError}
                  </p>
                ) : null}
              </Card>

              <Card title="Usage history">
                {usageError ? (
                  <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                    {usageError}
                  </p>
                ) : null}

                {!usageError && usage && usage.length === 0 ? <p>No calls yet.</p> : null}

                {usage && usage.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="text-slate-500 dark:text-slate-400">
                        <tr>
                          <th className="pb-2 pr-4 font-medium">Time</th>
                          <th className="pb-2 pr-4 font-medium">Key policy</th>
                          <th className="pb-2 font-medium">Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usage
                          .slice()
                          .reverse()
                          .map((event) => (
                            <tr key={event.id} className="border-t border-slate-100 dark:border-slate-800">
                              <td className="py-2 pr-4">{formatTimestamp(event.timestamp)}</td>
                              <td className="py-2 pr-4">{event.keyPolicy === 'developer' ? 'your key' : "end user's key"}</td>
                              <td className="py-2">{formatCents(event.estimatedCostCents)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
