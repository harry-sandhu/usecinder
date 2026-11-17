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
  const dom = new JSDOM(`
    <main>
      <section cinder-route="profile" data-cinder-path="/profile">
        <form cinder-context="profile-form">
          <label for="mobile-field">Mobile</label>
          <input id="mobile-field" cinder-field="mobile" />
          <button id="save-button" type="button" cinder-action="save">Save Changes</button>
        </form>
      </section>
    </main>
  `, {
    url: 'http://localhost/profile',
  });

  installDomGlobals(dom);

  const execution = {
    saveTriggered: 0,
  };

  dom.window.document.getElementById('save-button')?.addEventListener('click', () => {
    execution.saveTriggered += 1;
  });

  const runtime = new CinderSemanticRuntime();
  runtime.registerColdGraph({
    id: 'admin-catalog',
    nodes: [
      {
        type: 'route',
        key: 'admin',
        label: 'Admin',
        metadata: {
          routePath: '/admin',
        },
      },
      {
        type: 'context',
        key: 'publish-panel',
        routeKey: 'admin',
        label: 'Publish Panel',
      },
      {
        type: 'action',
        key: 'publish',
        routeKey: 'admin',
        contextPath: ['publish-panel'],
        label: 'Publish',
      },
      {
        type: 'field',
        key: 'mobile',
        routeKey: 'admin',
        contextPath: ['publish-panel'],
        label: 'Admin Mobile',
      },
      {
        type: 'action',
        key: 'save',
        routeKey: 'admin',
        contextPath: ['publish-panel'],
        label: 'Save Draft',
      },
    ],
  });

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

  const saveResult = await runtime.run('save changes', dom.window.document);
  assert(saveResult.intent.intent === 'trigger_action', 'Expected hot DOM save action to resolve normally.');
  assert(saveResult.dispatch.handled, 'Expected hot DOM save action to dispatch.');
  assert(execution.saveTriggered === 1, 'Expected only the hot DOM save action to execute.');
  assert(saveResult.intent.matchedNodeIds?.length === 1, 'Expected one matched save node.');
  const saveNode = runtime.graph().nodes.find((node) => node.id === saveResult.intent.matchedNodeIds?.[0]);
  assert(saveNode?.metadata?.graphTemperature === 'hot', 'Expected save action planner to prefer the hot node over cold duplicates.');

  const setFieldResult = await runtime.run('set mobile to 12345', dom.window.document);
  assert(setFieldResult.intent.intent === 'set_field', 'Expected hot field to resolve for set mobile.');
  assert(dom.window.document.getElementById('mobile-field').value === '12345', 'Expected hot DOM field to update.');
  const fieldNode = runtime.graph().nodes.find((node) => node.id === setFieldResult.intent.matchedNodeIds?.[0]);
  assert(fieldNode?.metadata?.graphTemperature === 'hot', 'Expected field planner to prefer the hot node over cold duplicates.');

  const publishResult = await runtime.run('publish', dom.window.document);
  assert(publishResult.intent.intent === 'unknown', 'Expected cold-only action not to resolve for direct DOM execution.');
  assert(publishResult.dispatch.handled === false, 'Expected cold-only action not to dispatch.');

  runtime.destroy();

  console.log(JSON.stringify({
    ok: true,
    summary: {
      saveIntent: saveResult.intent.intent,
      saveTemperature: saveNode?.metadata?.graphTemperature,
      fieldIntent: setFieldResult.intent.intent,
      fieldTemperature: fieldNode?.metadata?.graphTemperature,
      publishIntent: publishResult.intent.intent,
      saveTriggered: execution.saveTriggered,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-hybrid-planner-preference] failed:', error);
  process.exitCode = 1;
});
