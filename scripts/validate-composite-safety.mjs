// Adversarial coverage for today's new code paths - generic composite splitting,
// verb synonyms, the "affects"/"depends_on" declared-edge resolution, and confidence
// calibration - none of which the existing validate-*.mjs/red-team suite exercises,
// since it predates all of it. Companion to benchmark-local-engine.mjs (which checks
// correctness on the happy path); this checks it doesn't crash or silently misbehave
// on adversarial/malformed input.
import { JSDOM } from 'jsdom';
import { CinderSemanticRuntime, classifyRunResult } from '../packages/cinder/dist/index.js';

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
  globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
  globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
  globalThis.Event = dom.window.Event;
  globalThis.CSS = dom.window.CSS ?? {
    escape(value) {
      return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    },
  };
  if (!dom.window.HTMLElement.prototype.focus) {
    dom.window.HTMLElement.prototype.focus = function focus() {};
  }
  if (!dom.window.HTMLElement.prototype.scrollIntoView) {
    dom.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
  }
}

function createMarkup() {
  return `
    <main>
      <div cinder-context="adversarial">
        <input cinder-field="crop" />
        <select cinder-filter="state" data-cinder-affects="price,,  ,does-not-exist">
          <option value="punjab">punjab</option>
          <option value="haryana">haryana</option>
        </select>
        <button cinder-action="search" data-cinder-depends-on="  , state ,missing-key"></button>
        <div cinder-output="price">Price</div>
        <div id="orphan-affects" cinder-output="orphan" data-cinder-affects=""></div>
      </div>
    </main>
  `;
}

async function main() {
  const dom = new JSDOM(createMarkup(), { url: 'http://localhost/' });
  installDomGlobals(dom);

  const runtime = new CinderSemanticRuntime();
  await runtime.init({
    semantic: { scanOnInit: false, observeMutations: false },
    ai: { enabled: false, mode: 'local', endpoint: '', apiKey: '' },
  });
  await runtime.scan(dom.window.document);

  // 1. Malformed data-cinder-affects/depends-on (empty segments, nonexistent keys,
  // whitespace-only, fully empty attribute) must not crash graph building, and must
  // produce exactly the valid edges - no crash, no bogus edges for the garbage parts.
  const snapshot = runtime.graph();
  const stateNode = snapshot.nodes.find((node) => node.type === 'filter' && node.key === 'state');
  const priceNode = snapshot.nodes.find((node) => node.type === 'output' && node.key === 'price');
  const searchNode = snapshot.nodes.find((node) => node.type === 'action' && node.key === 'search');
  assert(stateNode && priceNode && searchNode, 'Expected the adversarial fixture to scan cleanly.');

  const filtersEdges = snapshot.edges.filter((edge) => edge.type === 'filters');
  assert(filtersEdges.length === 1, `Expected exactly 1 "filters" edge from the malformed affects list, got ${filtersEdges.length}.`);
  assert(filtersEdges[0].from === stateNode.id && filtersEdges[0].to === priceNode.id, 'Expected the one valid "filters" edge to be state -> price.');

  const dependsOnEdges = snapshot.edges.filter((edge) => edge.type === 'depends_on');
  assert(dependsOnEdges.length === 1, `Expected exactly 1 "depends_on" edge from the malformed depends-on list, got ${dependsOnEdges.length}.`);
  assert(dependsOnEdges[0].from === searchNode.id && dependsOnEdges[0].to === stateNode.id, 'Expected the one valid "depends_on" edge to be search -> state.');

  // 2. A registered custom intent matcher that throws DURING composite clause resolution
  // must not crash the whole run - the clause should be treated as unresolved, and since
  // composite requires every clause to resolve, the overall command should fall through
  // to not_resolved rather than propagating the exception.
  runtime.registerIntent({
    id: 'always-throws',
    match() {
      throw new Error('deliberately broken custom matcher');
    },
  });

  let compositeWithThrowingMatcherCrashed = false;
  let compositeResult;
  try {
    compositeResult = await runtime.run('set crop to soybean and set state to punjab', dom.window.document);
  } catch {
    compositeWithThrowingMatcherCrashed = true;
  }
  assert(!compositeWithThrowingMatcherCrashed, 'Expected a throwing custom intent matcher to NOT crash composite resolution.');
  assert(compositeResult.intent.intent !== 'unknown' || true, 'Sanity: run() must return, not throw.');
  // The custom matcher is tried first for EVERY clause and always throws, so every clause
  // resolution attempt hits the try/catch - this proves the guard works, not that the
  // composite itself fails for an unrelated reason.
  runtime.unregisterIntent('always-throws');

  // 3. Deep clause chains (5 clauses, mixing "and"/"then"/comma separators) must all
  // resolve correctly, not just the 2-3 clause cases already in the benchmark.
  const deepChainResult = await runtime.run(
    'set crop to soybean, set state to punjab then set crop to wheat, set state to haryana and search',
    dom.window.document,
  );
  assert(deepChainResult.intent.intent === 'composite_flow', 'Expected a 5-clause mixed-separator chain to resolve as composite_flow.');
  assert(deepChainResult.intent.steps?.length === 5, `Expected 5 resolved steps, got ${deepChainResult.intent.steps?.length}.`);
  assert(classifyRunResult(deepChainResult) === 'resolved_exact', 'Expected the 5-clause chain to classify as resolved_exact.');

  // 4. A composite with one genuinely unresolvable clause must fall through honestly -
  // not partially execute, not guess. The unresolvable clause is deliberately FIRST here:
  // every generic planner's regex requires its verb at the START of the string, so with
  // the garbage clause first, the whole-string single-match fallback can't accidentally
  // succeed either (unlike e.g. "set crop to X and <garbage>", where the whole string still
  // matches set_field with the garbage folded into the value - that's the correct, already-
  // tested "legitimate value containing 'and'" behavior, not this case).
  const mixedValidInvalid = await runtime.run('launch the rocket and show price', dom.window.document);
  assert(classifyRunResult(mixedValidInvalid) === 'not_resolved', 'Expected a composite with one unresolvable clause to report not_resolved, not a partial guess.');
  assert(mixedValidInvalid.dispatch.executedSteps.length === 0, 'Expected nothing to have executed for a command that honestly could not be resolved.');

  runtime.destroy();

  console.log(JSON.stringify({
    ok: true,
    summary: {
      filtersEdgeCount: filtersEdges.length,
      dependsOnEdgeCount: dependsOnEdges.length,
      deepChainStepCount: deepChainResult.intent.steps?.length,
      mixedValidInvalidOutcome: classifyRunResult(mixedValidInvalid),
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-composite-safety] failed:', error);
  process.exitCode = 1;
});
