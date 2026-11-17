# Prompt: the Cinder tagging checklist

Hand this file to a coding agent working in a repository that uses Cinder. It runs Cinder's
full tagging-quality checklist against a real running instance of the app and fixes everything
it finds, in order:

1. Elements that should be tagged with a `cinder-*` attribute but aren't tagged at all.
2. Elements that are tagged but have no real, useful label.

Both checks are real Cinder capabilities (`auditUntaggedElements` and `auditLabelQuality`,
exported from the `cinder` package) - built because this exact gap was found while testing
Cinder's own demo apps: a real CRM had 40 real navigation links with no accessible label, and
a route only reachable through a JS callback had no way to get a real label at all.

## Why order matters

Fix untagged elements FIRST. A newly-tagged element becomes a candidate for the label audit;
checking labels before tagging everything would mean re-running the whole checklist anyway once
new tags are added. Doing it in this order means one pass through each real page is enough.

## Step 1: find untagged elements

A bare `import 'cinder'` does not resolve inside a literal browser console or inside
`page.evaluate()` - neither is a bundled module context (found by trying it, not assumed). This
function only inspects DOM structure, not live reactive state, so get the real rendered markup
out of the browser and run the real function against it wherever you're actually working:

```js
// 1. In the browser, after the real page has rendered:
const html = document.documentElement.outerHTML;
```

```js
// 2. Wherever you're actually running (Node, a script, an agent's own tool-use):
import { JSDOM } from 'jsdom';
import { auditUntaggedElements } from 'cinder'; // or '../node_modules/cinder/dist/index.js'
const dom = new JSDOM(html);
const findings = auditUntaggedElements(dom.window.document);
```

Each finding looks like:

```json
{ "tagName": "a", "accessibleText": "Reports", "selectorHint": "#reports-link", "suggestedTag": "cinder-route" }
```

`suggestedTag` is a best-effort guess from the element's shape (a real `<a href>` that isn't
`#`/`javascript:` suggests `cinder-route`; a `<button>` suggests `cinder-action`; a `<select>`
or checkbox/radio `<input>` suggests `cinder-filter`; a text `<input>`/`<textarea>` suggests
`cinder-field`) - **confirm it, don't apply it blindly**. The element's real purpose in the app
is what decides the right tag, not its HTML shape alone. Some findings are correctly NOT a
Cinder candidate at all (a cosmetic toggle with no real command semantics, a link to an external
site) - skip those; the audit flags "untagged interactive element," not "definitely needs
Cinder."

Run this on every real page of the app, not just one - an element only shows up if it's
currently in the DOM. A single-page sweep across many routes in a row works for THIS check
(unlike the label audit below, nothing here depends on the DOM settling after navigation), but
pause briefly between page loads so each page's content has actually rendered before scanning.

For each genuine finding: add the real `cinder-route` / `cinder-action` / `cinder-field` /
`cinder-filter` / `cinder-output` attribute (plus a real `key`) to the real source element,
along with a real `aria-label` if it doesn't already have an accessible name - that second part
is exactly what Step 2 below checks for, so getting it right here avoids a second round trip.

## Step 2: find weak labels

See `docs/prompts/fix-weak-cinder-labels.md` for the full, detailed version of this step -
summarized here. Same real-import constraint as Step 1 above: get the plain graph snapshot out
of the browser, then run the real function wherever you're actually working.

```js
// In the browser: const snapshotJson = JSON.stringify(window.Cinder.graph());
import { auditLabelQuality } from 'cinder';
const findings = auditLabelQuality(JSON.parse(snapshotJson));
```

**Important caution** (from that prompt, repeated because it matters): a rapid, scripted sweep
through many routes in a row can produce false positives - some apps' navigation takes slightly
longer to settle its accessible name after rapid client-side route changes than after a single,
isolated navigation. Re-verify every finding with an isolated check (a neutral page, a pause, a
single navigation, a pause, then read the graph) before trusting it.

For each genuine finding, write a real label and apply it. Prefer fixing it at the most central
place possible - if the app derives its Cinder attributes from a shared route/field registry
(a `routes.ts`-style file, common in apps built against this SDK), a label added there via
`CinderRouteDefinition.label` (or the field/action/filter/output equivalent, if the app's
registry has one) fixes every element built from that one registration, instead of hunting down
each individual tagged element in JSX. `CinderRouteDefinition.label` is used as a fallback
whenever the real tagged element (if any) has no accessible name of its own, and does nothing
when a real one already exists - so it's always safe to set.

## Step 3: re-verify everything

Re-run both audits (Step 1's untagged scan and Step 2's isolated-checked label scan). The goal
is zero genuine findings left in either - not zero RAW findings, since both audits are advisory
and some raw findings are correctly not real issues (see each step's own notes on what to skip).
