// Coverage for the Graph Enrichment AI's producer half (docs/mvp-phase-plan.md Phase 12,
// docs/known-limitations.md #2/#7): exportGraphForEnrichment (core/tools/graphEnrichment.ts)
// turns a real scanned snapshot into an LLM-readable summary, and registerColdGraph (the
// ALREADY-EXISTING, already-tested consumer) merges a hand-built CinderColdGraphCatalog - built
// here to stand in for what a real enrichment LLM would actually produce - back onto the real
// graph. The point of this test is proving the full loop works end to end: export, suggest,
// register, re-scan, and see the suggestions land on the SAME real nodes, not duplicates.
import { JSDOM } from 'jsdom';
import { CinderSemanticRuntime, exportGraphForEnrichment } from '../packages/cinder/dist/index.js';

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
      <section id="crop-prices" cinder-route="crop-prices">
        <div id="crop-prices-filters" cinder-context="crop-prices-filters">
          <select id="crop-filter" cinder-filter="crop">
            <option value="">Select crop</option>
            <option value="soybean">Soybean</option>
          </select>
          <button id="view-detail" cinder-action="view-detail" data-cinder-navigates-to="crop-detail">View detail</button>
        </div>
      </section>
      <section id="crop-detail" cinder-route="crop-detail">
        <div id="crop-detail-body" cinder-context="crop-detail-body">
          <div id="price-output" tabindex="0" cinder-output="price">Price</div>
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

  // 1. Export must describe the real app plainly - real keys/labels/position, and the real
  // navigates_to edge already declared (known-limitations.md #2), with no "app" root noise.
  const exported = exportGraphForEnrichment(runtime.graph());
  assert(!exported.nodes.some((node) => node.type === 'app'), 'Expected the app root node to be excluded from the enrichment export.');
  const cropFilterSummary = exported.nodes.find((node) => node.key === 'crop' && node.type === 'filter');
  assert(cropFilterSummary?.routeKey === 'crop-prices', 'Expected the exported filter to carry its real route key.');
  assert(exported.edges.some((edge) => edge.type === 'navigates_to' && edge.from === 'view-detail' && edge.to === 'crop-detail'), 'Expected the real navigates_to edge to appear in the export, by key not internal id.');
  assert(!exported.edges.some((edge) => edge.type === 'contains' || edge.type === 'scoped_to'), 'Expected purely structural edges to be excluded from the enrichment export - already implied by contextPath/routeKey.');

  // 2. A hand-built catalog standing in for a real enrichment LLM's output - pure alias
  // enrichment on an existing real node (the Phase 12 "entity alias enrichment" example shape)
  // plus a suggested relationship the developer would review before this ever gets registered.
  //
  // Each node/ref MUST echo back the exact routeKey/contextPath the export gave for that key -
  // real node ids are scoped by type:routeKey+contextPath:key (hybridGraph.ts's makeNodeId), so
  // an entry naming only the bare key (no scope) targets a DIFFERENT, root-scoped id and
  // creates a duplicate instead of enriching the real node. Caught by this very test on the
  // first attempt (a catalog entry without contextPath did exactly that) - which is why
  // docs/prompts/cinder-graph-enrichment.md calls this out as the one way this goes wrong.
  const viewDetailSummary = exported.nodes.find((node) => node.key === 'view-detail' && node.type === 'action');
  const priceOutputSummary = exported.nodes.find((node) => node.key === 'price' && node.type === 'output');
  const suggestedCatalog = {
    id: 'enrichment-2026-11-16',
    nodes: [
      { type: 'filter', key: 'crop', aliases: ['commodity', 'produce'], routeKey: cropFilterSummary.routeKey, contextPath: cropFilterSummary.contextPath },
      { type: 'action', key: 'view-detail', aliases: ['see details', 'open detail'], routeKey: viewDetailSummary.routeKey, contextPath: viewDetailSummary.contextPath },
    ],
    edges: [
      {
        type: 'relates_to',
        from: { type: 'filter', key: 'crop', routeKey: cropFilterSummary.routeKey, contextPath: cropFilterSummary.contextPath },
        to: { type: 'output', key: 'price', routeKey: priceOutputSummary.routeKey, contextPath: priceOutputSummary.contextPath },
      },
    ],
  };

  runtime.registerColdGraph(suggestedCatalog);
  const enrichedGraph = runtime.graph();

  // 3. The suggested aliases must land on the SAME real node, not a duplicate - the whole
  // reason this design reuses registerColdGraph instead of inventing new merge code.
  const cropNodes = enrichedGraph.nodes.filter((node) => node.type === 'filter' && node.key === 'crop');
  assert(cropNodes.length === 1, `Expected exactly one "crop" filter node after enrichment, found ${cropNodes.length}.`);
  assert(cropNodes[0].aliases.includes('commodity') && cropNodes[0].aliases.includes('produce'), 'Expected the suggested aliases to be merged onto the real crop filter node.');

  const actionNodes = enrichedGraph.nodes.filter((node) => node.type === 'action' && node.key === 'view-detail');
  assert(actionNodes.length === 1, `Expected exactly one "view-detail" action node after enrichment, found ${actionNodes.length}.`);
  // Aliases are normalized to canonical kebab-case by the engine (normalizeSemanticKey) - "see
  // details" becomes "see-details" - so the real stored form, not the raw suggested string, is
  // what must be checked here.
  assert(actionNodes[0].aliases.includes('see-details'), 'Expected the suggested action alias to be merged onto the real action node.');

  // 4. The suggested relationship must also resolve onto the real nodes, not get silently
  // dropped or create phantom nodes of its own.
  const priceOutput = enrichedGraph.nodes.find((node) => node.type === 'output' && node.key === 'price');
  assert(enrichedGraph.edges.some((edge) => edge.type === 'relates_to' && edge.from === cropNodes[0].id && edge.to === priceOutput.id), 'Expected the suggested relates_to edge to resolve onto the real crop filter and price output nodes.');

  console.log('All graph enrichment validations passed.');
}

main();
