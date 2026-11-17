import { JSDOM } from 'jsdom';
import {
  buildGraphFromScanResult,
  formatGraphDebugSummary,
  scanSemanticTree,
} from '../packages/cinder/dist/index.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function installDomGlobals(dom) {
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLInputElement = dom.window.HTMLInputElement;
  globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
  globalThis.Event = dom.window.Event;
  globalThis.CSS = dom.window.CSS ?? {
    escape(value) {
      return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    },
  };
}

function createMarkup() {
  return `
    <main>
      <section id="reports-page" cinder-route="reports">
        <div id="reports-filters" cinder-context="filters">
          <button id="reports-search" cinder-action="search">Search</button>
        </div>

        <div id="registration" cinder-context="registration">
          <div id="registration-details" cinder-context="details">
            <button id="registration-save" cinder-action="save">Save</button>
          </div>
        </div>

        <div id="profile" cinder-context="profile">
          <div id="profile-details" cinder-context="details">
            <button id="profile-save" cinder-action="save">Save</button>
          </div>
        </div>
      </section>

      <section id="farmers-page" cinder-route="farmers">
        <div id="farmers-filters" cinder-context="filters">
          <button id="farmers-search" cinder-action="search">Search</button>
        </div>
      </section>
    </main>
  `;
}

function main() {
  const dom = new JSDOM(createMarkup(), {
    url: 'http://localhost/',
  });
  installDomGlobals(dom);

  const scanResult = scanSemanticTree(dom.window.document);
  const snapshot = buildGraphFromScanResult(scanResult);

  const nodeIds = snapshot.nodes.map((node) => node.id);
  assert(new Set(nodeIds).size === nodeIds.length, 'Expected graph node ids to be unique.');

  const actionNodes = snapshot.nodes.filter((node) => node.type === 'action' && node.key === 'search');
  assert(actionNodes.length === 2, 'Expected two scoped search action nodes.');
  assert(new Set(actionNodes.map((node) => node.id)).size === 2, 'Expected search actions to have distinct ids.');
  assert(actionNodes.every((node) => Boolean(node.contextId)), 'Expected scoped search actions to keep context ids.');
  assert(new Set(actionNodes.map((node) => node.contextId)).size === 2, 'Expected each search action to belong to a different filters context.');

  const detailsContexts = snapshot.nodes.filter((node) => node.type === 'context' && node.key === 'details');
  assert(detailsContexts.length === 2, 'Expected two details contexts under different parent contexts.');
  assert(new Set(detailsContexts.map((node) => node.id)).size === 2, 'Expected nested details contexts to have distinct ids.');

  const saveNodes = snapshot.nodes.filter((node) => node.type === 'action' && node.key === 'save');
  assert(saveNodes.length === 2, 'Expected two save actions under nested details contexts.');
  assert(new Set(saveNodes.map((node) => node.id)).size === 2, 'Expected nested save actions to have distinct ids.');
  assert(new Set(saveNodes.map((node) => node.contextId)).size === 2, 'Expected nested save actions to stay attached to distinct details contexts.');

  console.log(JSON.stringify({
    ok: true,
    summary: formatGraphDebugSummary(snapshot),
    nodeCount: snapshot.nodes.length,
    edgeCount: snapshot.edges.length,
    searchActionIds: actionNodes.map((node) => node.id),
    detailsContextIds: detailsContexts.map((node) => node.id),
    saveActionIds: saveNodes.map((node) => node.id),
  }, null, 2));
}

main();
