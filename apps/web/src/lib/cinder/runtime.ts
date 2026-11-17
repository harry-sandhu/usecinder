// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { Cinder, classifyRunResult } from 'usecinder';
import { webCinderSiteManifest } from './coldGraph';

// Debug-friendly expose, consistent with this site's own "debug-friendly state" claim
// (see the homepage's "Honest failure modes" copy): lets the live runtime already scanning
// this real page be driven from the browser console or an automated test, instead of only
// through the homepage's own demo widget. No behavior change, no data exposure risk - this
// is a documentation/marketing site with no user accounts or sensitive state.
if (typeof window !== 'undefined') {
  (window as unknown as { Cinder: typeof Cinder; classifyRunResult: typeof classifyRunResult }).Cinder = Cinder;
  (window as unknown as { Cinder: typeof Cinder; classifyRunResult: typeof classifyRunResult }).classifyRunResult = classifyRunResult;
}

let cinderInitPromise: Promise<void> | undefined;

function registerWebCinderSiteManifest() {
  const registeredManifestIds = new Set(Cinder.getSiteManifests().map((manifest) => manifest.id));

  if (!registeredManifestIds.has(webCinderSiteManifest.id)) {
    Cinder.registerSiteManifest(webCinderSiteManifest);
  }
}

export async function bootWebCinder(root: ParentNode | Document = document) {
  registerWebCinderSiteManifest();

  cinderInitPromise ??= Cinder.init({
    app: {
      name: 'Cinder Docs',
      version: '0.1.0',
    },
    semantic: {
      scanOnInit: false,
      observeMutations: true,
    },
    ai: {
      enabled: false,
      mode: 'local',
    },
  });

  await cinderInitPromise;
  await Cinder.scan(root);
}
