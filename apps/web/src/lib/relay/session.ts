// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import type { RelaySession } from './client';

/**
 * This dashboard talks directly to whatever relay server the developer points it at (their own
 * localhost instance, or a deployed one) - there's no Cinder-run backend behind these pages, so
 * the only place a session can live is the browser the developer is sitting at right now.
 * Never sent anywhere except straight back to that same relay server as a bearer token.
 */
const STORAGE_KEY = 'cinder-relay-session';

export function loadRelaySession(): RelaySession | undefined {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return undefined;
    }

    const parsed = JSON.parse(raw) as Partial<RelaySession>;

    if (typeof parsed.baseUrl === 'string' && typeof parsed.email === 'string' && typeof parsed.secretKey === 'string') {
      return { baseUrl: parsed.baseUrl, email: parsed.email, secretKey: parsed.secretKey };
    }

    return undefined;
  } catch {
    return undefined;
  }
}

export function saveRelaySession(session: RelaySession): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Private-window/blocked-storage - the session still works for the rest of this tab's
    // lifetime via React state, it just won't survive a reload. Not worth surfacing as an
    // error for what is, at worst, a minor convenience loss.
  }
}

export function clearRelaySession(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // See saveRelaySession - nothing to recover from here either.
  }
}

export const DEFAULT_RELAY_BASE_URL = 'http://localhost:8081';
