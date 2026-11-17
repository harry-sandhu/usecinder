// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { getEmbedder } from "./model.js";

/**
 * Background-prefetch for the embedding model, confirmed via the tier-2 architecture
 * discussion: the small embedding model (~23MB) is cheap enough to download for every
 * visitor, so it's ready by the time anyone's command actually needs tier 2, instead of
 * making the first real user wait through a cold download.
 *
 * What this does NOT need to implement: Transformers.js already caches downloaded model
 * files through the browser Cache API by default (env.useBrowserCache, true unless
 * disabled) - calling getEmbedder() here is enough; the library handles not re-downloading
 * on a later visit. What this DOES add, that the library doesn't do on its own:
 *   1. Only starts once the page is idle (requestIdleCallback), never competing with
 *      anything the page itself needs to load first.
 *   2. Checks the Network Information API and skips the prefetch on a slow/metered
 *      connection or when the visitor has explicitly turned on data-saver mode - genuinely
 *      respecting "only when there's bandwidth to spare," not just "always, after a delay."
 *   3. Requests persistent storage (navigator.storage.persist()) once the model is cached,
 *      so it's less likely to be evicted under storage pressure before it's ever used.
 *
 * Call this once during your app's own startup if you want tier 2 pre-warmed. It is NOT
 * called automatically by createEmbeddingLlmCore() - creating that core has no side
 * effects; starting a background download is a deliberate choice the embedding app makes,
 * not something installing @cinder/embeddings does implicitly.
 */

export interface CinderEmbeddingPrefetchOptions {
  /**
   * Skip the prefetch on a slow/metered connection or when saveData is set. Default true.
   * Set to false only if you've decided the download is worth it regardless (e.g. the app
   * is used almost entirely offline-first and the model is effectively mandatory).
   */
  respectConnectionPreferences?: boolean;
}

interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
}

function getConnectionInfo(): NetworkInformationLike | undefined {
  if (typeof navigator === "undefined") {
    return undefined;
  }

  // The Network Information API isn't in TypeScript's standard DOM lib (still
  // non-standard/Chromium-only as of this writing) and ships under different vendor-
  // prefixed names historically - read defensively rather than assuming one shape.
  const nav = navigator as Navigator & {
    connection?: NetworkInformationLike;
    mozConnection?: NetworkInformationLike;
    webkitConnection?: NetworkInformationLike;
  };

  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
}

const SLOW_CONNECTION_TYPES = new Set(["slow-2g", "2g"]);

/**
 * Exported (not just internal) specifically so this pure decision logic can be unit-tested
 * directly - the rest of prefetchEmbeddingModel's behavior (actually scheduling, actually
 * loading a model) can't be meaningfully verified outside a real browser, but this part can
 * and should be, same as any other pure function in this project.
 */
export function shouldSkipPrefetchForConnection(connection: NetworkInformationLike | undefined): boolean {
  // If the API isn't supported at all, don't block the prefetch just because we can't
  // check - that would silently disable prefetching on every browser without this API
  // (which, as of the tier-2 research pass, is most of them outside Chromium).
  if (!connection) {
    return false;
  }

  if (connection.saveData) {
    return true;
  }

  return Boolean(connection.effectiveType && SLOW_CONNECTION_TYPES.has(connection.effectiveType));
}

function scheduleWhenIdle(callback: () => void): void {
  const globalWithIdle = globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: () => void) => number;
  };

  if (typeof globalWithIdle.requestIdleCallback === "function") {
    globalWithIdle.requestIdleCallback(callback);
    return;
  }

  // Safari (as of this writing) and older browsers don't implement
  // requestIdleCallback - a short timeout is the standard fallback, still deferring past
  // the current task without waiting for a real idle signal that will never fire.
  setTimeout(callback, 1);
}

export function prefetchEmbeddingModel(options: CinderEmbeddingPrefetchOptions = {}): void {
  if (typeof window === "undefined") {
    // No-op outside a browser (SSR, Node-based tests) - there's nothing to prefetch into.
    return;
  }

  const respectConnectionPreferences = options.respectConnectionPreferences ?? true;

  scheduleWhenIdle(() => {
    if (respectConnectionPreferences && shouldSkipPrefetchForConnection(getConnectionInfo())) {
      return;
    }

    void getEmbedder()
      .then(async () => {
        const storage = (navigator as Navigator & { storage?: StorageManager }).storage;

        if (storage?.persist) {
          await storage.persist();
        }
      })
      .catch(() => {
        // A failed prefetch is non-fatal: the model simply loads on first real tier-2 use
        // instead, same as if prefetch had never been called.
      });
  });
}
