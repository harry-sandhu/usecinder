# Prompt: Cinder graph enrichment

Hand this file to a coding agent working in a repository that uses Cinder. It runs an offline,
developer-reviewed enrichment pass over the app's real Cinder graph: suggesting aliases people
would actually say, and relationships between real elements, so more of their future requests
resolve locally (tier 1/2) instead of needing a cloud model call (tier 3) at all.

This is the long-planned "Graph Enrichment AI" (`docs/mvp-phase-plan.md` Phase 12,
`docs/known-limitations.md` #2/#7) - a one-time, developer-run analysis step, never a live,
runtime AI guess. Nothing it suggests takes effect until a human reviews it and the app calls
`Cinder.registerColdGraph(catalog)`.

## Why this is safe

Every suggestion is author-reviewed before it does anything, same principle as
`data-cinder-affects`/`data-cinder-depends-on`/`data-cinder-navigates-to`: this codebase does
not guess live relationships from DOM position or vibes. The only difference here is WHO
proposes the suggestion (an LLM, working offline, from a plain export) instead of a developer
typing an attribute - the review-before-activation step is identical either way.

## Step 1: export the real graph

`exportGraphForEnrichment` only needs plain snapshot data, not a live DOM, so get the snapshot
out of the real running app and run the real function wherever you actually are (Node, a
script, an agent's own tool-use) rather than inside the page itself - a bare `import 'cinder'`
does not resolve in a literal browser console or inside `page.evaluate()`, since neither is a
bundled module context (found by trying it, not assumed):

```js
// 1. In the browser (devtools console, or Playwright's page.evaluate()) - plain data out:
const snapshotJson = JSON.stringify(window.Cinder.graph());
```

```js
// 2. Wherever you're actually running (Node, a script) - the real function, real import:
import { exportGraphForEnrichment } from 'cinder'; // or '../node_modules/cinder/dist/index.js'
const summary = exportGraphForEnrichment(JSON.parse(snapshotJson));
```

`summary.nodes` is every real (non-root) node: `key`, `type`, current `label`/`aliases` (so you
don't re-suggest what's already there), and its position (`contextPath`/`routeKey`).
`summary.edges` is every real, semantically meaningful edge already in the graph (`filters`,
`depends_on`, `navigates_to`, `relates_to` - not `contains`/`scoped_to`, which are purely
structural and already implied by `contextPath`/`routeKey`).

Run this on every real page of the app, the same way as the tagging checklist
(`docs/prompts/cinder-tagging-checklist.md`) - a node only shows up if it's currently in the
scanned graph.

## Step 2: suggest aliases and relationships

For each node, suggest real synonyms a real user would actually say - not formal restatements
of the label. Good: `{ "entity": "crop", "aliases": ["commodity", "produce", "product"] }`.
Bad: `{ "entity": "crop", "aliases": ["agricultural-crop-entity"] }` - nobody says that.

For relationships, only suggest ones you can justify from the real page structure you can see
(the live app, not just the export) - e.g. an action whose real on-click handler clearly
navigates to a route that has no `data-cinder-navigates-to` yet, or two fields that visibly
filter the same real output together. **Never suggest a relationship you inferred purely from
naming similarity or DOM proximity** - that's exactly the untrustworthy inference this project
has already decided against (see `addAffectsEdges`'s own doc comment in
`packages/cinder/src/core/cag/graphBuilder.ts`). If you're not sure a relationship is real,
leave it out rather than guess.

## Step 3: output a real `CinderColdGraphCatalog`

```json
{
  "id": "enrichment-2026-11-16",
  "nodes": [
    { "type": "filter", "key": "crop", "aliases": ["commodity", "produce"], "routeKey": "crop-prices", "contextPath": ["crop-prices-filters"] }
  ],
  "edges": [
    { "type": "relates_to", "from": { "type": "filter", "key": "crop", "routeKey": "crop-prices", "contextPath": ["crop-prices-filters"] }, "to": { "type": "output", "key": "price", "routeKey": "crop-prices", "contextPath": ["crop-prices-filters"] } }
  ]
}
```

**Critical, found by real testing (not a style preference): every node and edge endpoint MUST
echo the exact `routeKey`/`contextPath` the Step 1 export gave for that key.** Real node IDs are
scoped by `type` + `routeKey`/`contextPath` + `key` (`makeNodeId` in
`packages/cinder/src/core/cag/hybridGraph.ts`). A suggestion naming only the bare `key` with no
scope targets a *different*, root-scoped node - it won't error, it will silently create a
duplicate instead of enriching the real one. Copy `routeKey`/`contextPath` verbatim from the
matching entry in `summary.nodes`, never guess or omit them.

One more real, non-obvious thing worth knowing before reviewing output: aliases are stored in
canonical kebab-case (`normalizeSemanticKey` lowercases and hyphenates), so a suggested
`"see details"` ends up stored as `"see-details"` - this is expected engine behavior, not a bug
in the suggestion.

## Step 4: human review, then activate

A developer reviews the catalog - same bar as reviewing a PR: does each alias sound like
something a real user would say, does each relationship reflect something actually true about
the app. Only once approved:

```js
window.Cinder.registerColdGraph(catalog);
```

This merges aliases onto the real nodes they target (never creating a duplicate when the scope
is right - verified by `scripts/validate-graph-enrichment.mjs`) and adds the suggested edges as
real graph edges, available to tier 1/2 resolution and tier 3's prompt (`graph.nodeDetails`)
alike from the next scan onward.

## Step 5: measure, don't just assume it helped

Re-run the app's real fallback-rate measurement (the same kind of manual-or-real-tier-3
resolution tracking used in `docs/known-limitations.md` #4) before and after activating the
catalog. The exit criterion for this whole capability (`docs/mvp-phase-plan.md` Phase 12) is a
measurable drop in how often real requests reach tier 3, not just "the catalog looks
reasonable."
