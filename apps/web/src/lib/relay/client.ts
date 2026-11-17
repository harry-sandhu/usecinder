/**
 * A thin, real fetch-based client for @cinder/relay's dashboard-facing routes. Deliberately not
 * a generated SDK - this is the exact same shape a developer's own dashboard/CLI would call,
 * kept in one place so the pages below don't repeat header/error-handling logic.
 */
export interface RelaySession {
  baseUrl: string;
  email: string;
  secretKey: string;
}

export interface RelayProjectSummary {
  id: string;
  provider: 'anthropic' | 'openai';
  keyPolicy: 'developer' | 'end_user';
  providerModel?: string;
  hasProviderApiKey: boolean;
  balanceCents: number;
  createdAt: string;
  apiKey: string;
}

export interface RelayUsageEventSummary {
  id: string;
  timestamp: string;
  estimatedCostCents: number;
  keyPolicy: 'developer' | 'end_user';
}

export class RelayApiError extends Error {}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, init);
  } catch {
    throw new RelayApiError(
      `Could not reach ${url}. Check the relay URL is correct and the server is running.`,
    );
  }

  const body = await response.json().catch(() => undefined);

  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : response.statusText;
    throw new RelayApiError(message || `Request to ${url} failed with status ${response.status}.`);
  }

  return body as T;
}

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export async function signup(baseUrl: string, email: string, password: string): Promise<RelaySession> {
  const result = await requestJson<{ id: string; email: string; secretKey: string }>(`${trimBaseUrl(baseUrl)}/v1/relay/accounts/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  return { baseUrl: trimBaseUrl(baseUrl), email: result.email, secretKey: result.secretKey };
}

export async function login(baseUrl: string, email: string, password: string): Promise<RelaySession> {
  const result = await requestJson<{ id: string; email: string; secretKey: string }>(`${trimBaseUrl(baseUrl)}/v1/relay/accounts/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  return { baseUrl: trimBaseUrl(baseUrl), email: result.email, secretKey: result.secretKey };
}

export async function listProjects(session: RelaySession): Promise<RelayProjectSummary[]> {
  const result = await requestJson<{ projects: RelayProjectSummary[] }>(`${session.baseUrl}/v1/relay/projects`, {
    headers: { authorization: `Bearer ${session.secretKey}` },
  });

  return result.projects;
}

export interface CreateProjectInput {
  provider: 'anthropic' | 'openai';
  keyPolicy: 'developer' | 'end_user';
  providerApiKey?: string;
  providerModel?: string;
}

export async function createProject(session: RelaySession, input: CreateProjectInput): Promise<RelayProjectSummary> {
  const result = await requestJson<{ id: string; apiKey: string; provider: string; keyPolicy: string; balanceCents: number }>(
    `${session.baseUrl}/v1/relay/projects`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session.secretKey}` },
      body: JSON.stringify(input),
    },
  );

  return {
    id: result.id,
    apiKey: result.apiKey,
    provider: result.provider as RelayProjectSummary['provider'],
    keyPolicy: result.keyPolicy as RelayProjectSummary['keyPolicy'],
    providerModel: input.providerModel,
    hasProviderApiKey: Boolean(input.providerApiKey),
    balanceCents: result.balanceCents,
    createdAt: new Date().toISOString(),
  };
}

export async function getProjectUsage(
  session: RelaySession,
  projectId: string,
): Promise<{ project: RelayProjectSummary; usage: RelayUsageEventSummary[] }> {
  return requestJson(`${session.baseUrl}/v1/relay/projects/${projectId}/usage`, {
    headers: { authorization: `Bearer ${session.secretKey}` },
  });
}

export async function topUpProject(baseUrl: string, projectApiKey: string, amountCents: number): Promise<{ creditedCents: number; balanceCents: number }> {
  return requestJson(`${trimBaseUrl(baseUrl)}/v1/relay/topup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${projectApiKey}` },
    body: JSON.stringify({ amountCents }),
  });
}
