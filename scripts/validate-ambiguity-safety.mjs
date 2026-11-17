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
  globalThis.CSS = dom.window.CSS ?? {
    escape(value) {
      return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    },
  };

  if (!dom.window.HTMLElement.prototype.scrollIntoView) {
    dom.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
  }

  if (!dom.window.HTMLElement.prototype.focus) {
    dom.window.HTMLElement.prototype.focus = function focus() {};
  }
}

function createMarkup() {
  return `
    <main>
      <section id="reports-page" cinder-route="reports" data-cinder-path="/reports">
        <div id="north-region" cinder-context="north-region">
          <div id="north-toolbar" cinder-context="toolbar">
            <button id="north-save" cinder-action="save">Save</button>
            <div id="north-price" tabindex="0" cinder-output="price">North Price</div>
            <input id="north-note" cinder-field="north-note" />
          </div>
        </div>

        <div id="south-region" cinder-context="south-region">
          <div id="south-toolbar" cinder-context="toolbar">
            <button id="south-save" cinder-action="save">Save</button>
            <div id="south-price" tabindex="0" cinder-output="price">South Price</div>
            <input id="south-note" cinder-field="south-note" />
          </div>
        </div>
      </section>
    </main>
  `;
}

async function main() {
  const dom = new JSDOM(createMarkup(), {
    url: 'http://localhost/reports',
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

  await runtime.scan(dom.window.document);
  const snapshot = runtime.graph();

  const priceNodes = snapshot.nodes.filter((node) => node.type === 'output' && node.key === 'price');
  const saveNodes = snapshot.nodes.filter((node) => node.type === 'action' && node.key === 'save');

  assert(priceNodes.length === 2, 'Expected duplicated price outputs for ambiguity validation.');
  assert(saveNodes.length === 2, 'Expected duplicated save actions for ambiguity validation.');
  assert(new Set(priceNodes.map((node) => node.id)).size === 2, 'Expected duplicated price outputs to stay uniquely scoped.');
  assert(new Set(saveNodes.map((node) => node.id)).size === 2, 'Expected duplicated save actions to stay uniquely scoped.');
  assert(new Set(priceNodes.map((node) => node.contextId)).size === 2, 'Expected duplicated outputs to stay attached to distinct contexts.');
  assert(new Set(saveNodes.map((node) => node.contextId)).size === 2, 'Expected duplicated actions to stay attached to distinct contexts.');

  const ambiguousOutputIntent = runtime.resolve('show price');
  assert(ambiguousOutputIntent.intent === 'unknown', 'Expected ambiguous duplicated output to degrade to unknown intent.');
  assert(ambiguousOutputIntent.reason?.includes('Multiple output candidates matched'), 'Expected ambiguous output reason to explain duplicate output candidates.');

  const ambiguousOutputRun = await runtime.run('show price', dom.window.document);
  assert(ambiguousOutputRun.intent.intent === 'unknown', 'Expected ambiguous duplicated output run to preserve unknown intent.');
  assert(ambiguousOutputRun.dispatch.handled === false, 'Expected ambiguous duplicated output run not to dispatch a silent winner.');
  assert(ambiguousOutputRun.reflex.kind === 'clarification', 'Expected ambiguous duplicated output run to request clarification.');

  const ambiguousActionIntent = runtime.resolve('save');
  assert(ambiguousActionIntent.intent === 'unknown', 'Expected ambiguous duplicated action to degrade to unknown intent.');
  assert(ambiguousActionIntent.reason?.includes('Multiple action candidates matched'), 'Expected ambiguous action reason to explain duplicate action candidates.');

  const ambiguousActionRun = await runtime.run('save', dom.window.document);
  assert(ambiguousActionRun.intent.intent === 'unknown', 'Expected ambiguous duplicated action run to preserve unknown intent.');
  assert(ambiguousActionRun.dispatch.handled === false, 'Expected ambiguous duplicated action run not to dispatch a silent winner.');
  assert(ambiguousActionRun.reflex.kind === 'clarification', 'Expected ambiguous duplicated action run to request clarification.');

  runtime.destroy();

  console.log(JSON.stringify({
    ok: true,
    summary: {
      priceNodeIds: priceNodes.map((node) => node.id),
      saveNodeIds: saveNodes.map((node) => node.id),
      outputReason: ambiguousOutputIntent.reason,
      actionReason: ambiguousActionIntent.reason,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-ambiguity-safety] failed:', error);
  process.exitCode = 1;
});
