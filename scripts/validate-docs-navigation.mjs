// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { JSDOM } from 'jsdom';
import { CinderSemanticRuntime } from '../packages/cinder/dist/index.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function installDomGlobals(dom) {
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLAnchorElement = dom.window.HTMLAnchorElement;
  globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
  globalThis.HTMLFormElement = dom.window.HTMLFormElement;
  globalThis.HTMLInputElement = dom.window.HTMLInputElement;
  globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
  globalThis.Event = dom.window.Event;
  globalThis.SpeechSynthesisUtterance = dom.window.SpeechSynthesisUtterance ?? class {
    constructor(text) {
      this.text = text;
    }
  };
  globalThis.CSS = dom.window.CSS ?? {
    escape(value) {
      return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    },
  };
}

async function main() {
  const dom = new JSDOM('<main><h1>Docs runtime</h1></main>', {
    url: 'http://localhost/',
  });
  installDomGlobals(dom);

  const runtime = new CinderSemanticRuntime();

  await runtime.init({
    semantic: {
      scanOnInit: false,
      observeMutations: false,
    },
    ai: {
      enabled: false,
      mode: 'local',
      endpoint: '',
      apiKey: '',
    },
  });

  runtime.registerSiteManifest({
    id: 'docs-navigation-site',
    routes: [
      {
        key: 'docs-architecture',
        path: '/docs/architecture',
        title: 'Architecture',
        metadata: {
          group: 'Concepts',
        },
      },
      {
        key: 'docs-api-bind',
        path: '/docs/api/bind',
        title: 'Cinder.bind',
        metadata: {
          group: 'API Reference',
        },
      },
      {
        key: 'docs-guides-debugging',
        path: '/docs/guides/debugging',
        title: 'Debugging',
        metadata: {
          group: 'Guides',
        },
      },
      {
        key: 'docs-local-resolution',
        path: '/docs/concepts/local-resolution',
        title: 'Local Resolution',
        metadata: {
          group: 'Concepts',
        },
      },
    ],
  });

  const commands = [
    {
      input: 'open architecture',
      expectedTarget: 'docs-architecture',
      expectedPath: '/docs/architecture',
    },
    {
      input: 'can you show me bind method',
      expectedTarget: 'docs-api-bind',
      expectedPath: '/docs/api/bind',
    },
    {
      input: 'take me to debugging guide',
      expectedTarget: 'docs-guides-debugging',
      expectedPath: '/docs/guides/debugging',
    },
    {
      input: 'please show me local resolution concept',
      expectedTarget: 'docs-local-resolution',
      expectedPath: '/docs/concepts/local-resolution',
    },
  ];

  const results = [];

  for (const command of commands) {
    const result = await runtime.run(command.input, dom.window.document);
    assert(result.intent.intent === 'navigate', `Expected navigate intent for "${command.input}".`);
    assert(result.intent.target === command.expectedTarget, `Expected target ${command.expectedTarget} for "${command.input}", got ${result.intent.target}.`);
    assert(result.dispatch.handled, `Expected dispatch to handle "${command.input}".`);
    assert(dom.window.location.pathname === command.expectedPath, `Expected pathname ${command.expectedPath} after "${command.input}", got ${dom.window.location.pathname}.`);

    results.push({
      input: command.input,
      target: result.intent.target,
      path: dom.window.location.pathname,
    });
  }

  runtime.destroy();

  console.log(JSON.stringify({
    ok: true,
    summary: {
      commands: results,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-docs-navigation] failed:', error);
  process.exitCode = 1;
});
