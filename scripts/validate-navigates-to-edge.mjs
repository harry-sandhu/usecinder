// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
// Coverage for the new "navigates_to" edge (docs/known-limitations.md #2): an action node that
// declares data-cinder-navigates-to="<route-key>" gets a real graph edge to that route, exposed
// via getNavigationTargetOf (core/cag/graphBuilder.ts). Same author-declared-only design as
// addAffectsEdges/addDependsOnEdges - never inferred from DOM position - but with its own
// resolver, since a route target typically has NO contextId while the declaring action does,
// so the same-context constraint resolveDeclaredEdgeTargets uses for affects/dependsOn would
// never match a route at all.
import { JSDOM } from 'jsdom';
import { CinderSemanticRuntime, getNavigationTargetOf } from '../packages/cinder/dist/index.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function installDomGlobals(dom) {
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
  globalThis.HTMLInputElement = dom.window.HTMLInputElement;
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

function createDom() {
  const dom = new JSDOM(`
    <main>
      <section id="loans-list" cinder-route="loans-list">
        <div id="loans-list-rows" cinder-context="loans-list-rows">
          <button id="view-loan" cinder-action="view-loan" data-cinder-navigates-to="loan-detail">View details</button>
          <button id="refresh" cinder-action="refresh">Refresh</button>
          <button id="bad-target" cinder-action="bad-target" data-cinder-navigates-to="no-such-route">Broken link</button>
        </div>
      </section>

      <section id="loan-detail" cinder-route="loan-detail">
        <div id="loan-detail-body" cinder-context="loan-detail-body">
          <button id="back" cinder-action="back" data-cinder-navigates-to="loans-list">Back to list</button>
        </div>
      </section>
    </main>
  `, { url: 'http://localhost/' });

  installDomGlobals(dom);
  return dom;
}

async function main() {
  const dom = createDom();
  const runtime = new CinderSemanticRuntime();

  await runtime.init({
    semantic: { scanOnInit: false, observeMutations: false },
    ai: { enabled: false, mode: 'local', endpoint: '', apiKey: '' },
  });

  await runtime.scan(dom.window.document);
  const graph = runtime.graph();

  const viewLoan = graph.nodes.find((node) => node.type === 'action' && node.key === 'view-loan');
  const loanDetail = graph.nodes.find((node) => node.type === 'route' && node.key === 'loan-detail');
  const loansList = graph.nodes.find((node) => node.type === 'route' && node.key === 'loans-list');
  const refresh = graph.nodes.find((node) => node.type === 'action' && node.key === 'refresh');
  const badTarget = graph.nodes.find((node) => node.type === 'action' && node.key === 'bad-target');
  const back = graph.nodes.find((node) => node.type === 'action' && node.key === 'back');

  // 1. A declared, real target produces a real edge, even though the target route has no
  // contextId of its own and lives in a completely different part of the graph - the whole
  // point of navigates_to having its own resolver instead of reusing the same-context one.
  assert(graph.edges.some((edge) => edge.type === 'navigates_to' && edge.from === viewLoan.id && edge.to === loanDetail.id), 'Expected a real navigates_to edge from the action to its declared route.');
  const resolvedTarget = getNavigationTargetOf(graph, viewLoan.id);
  assert(resolvedTarget?.key === 'loan-detail', 'Expected getNavigationTargetOf to resolve the real route node.');

  // 2. An action with no data-cinder-navigates-to at all (the normal case - most actions don't
  // navigate anywhere) must have no edge and no guessed target.
  assert(!graph.edges.some((edge) => edge.type === 'navigates_to' && edge.from === refresh.id), 'Expected no navigates_to edge for an action that never declared one.');
  assert(getNavigationTargetOf(graph, refresh.id) === undefined, 'Expected getNavigationTargetOf to return undefined for an action with no declared target.');

  // 3. A declared target that doesn't resolve to any real route (typo/stale key) must be
  // silently dropped, never guessed at or pointed somewhere wrong.
  assert(!graph.edges.some((edge) => edge.type === 'navigates_to' && edge.from === badTarget.id), 'Expected no navigates_to edge when the declared target key does not resolve to a real route.');

  // 4. The reverse direction (loan-detail's own "Back" action) proves this isn't a one-off -
  // two different actions in two different routes each get their own correct edge.
  assert(graph.edges.some((edge) => edge.type === 'navigates_to' && edge.from === back.id && edge.to === loansList.id), 'Expected the reverse navigation edge to also resolve correctly.');

  console.log('All navigates_to edge validations passed.');
}

main();
