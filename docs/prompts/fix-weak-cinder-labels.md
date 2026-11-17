# Prompt: find and fix weak Cinder labels

Hand this file to a coding agent working in a repository that uses Cinder. It finds real
`cinder-route` / `cinder-action` / `cinder-field` / `cinder-filter` / `cinder-output` tagged
elements whose accessible label carries no real information - either missing entirely, or
identical to the element's own key - and fixes them in the real source code.

## Why this matters

Cinder's tier 3 (cloud LLM) fallback, and tier 2's own embedding-based matching, both rely on a
tagged element's real, human-facing label to tell it apart from similar-sounding candidates. A
bare key like `some-page-variant-a` carries no information a model (or a human) can use to tell
it apart from `some-page-variant-b` - but a real distinguishing label does. When an element's
label is missing, Cinder's scanner falls back to echoing the key back as the label, which looks
like a label but carries zero extra information - no amount of prompt engineering on Cinder's
side can fix that; it has to be fixed in the tagged app itself, by giving the real element a
real `aria-label` (or an associated `<label>` element).

**Important caution, found by real testing**: a rapid, scripted sweep that calls
`Cinder.run(...)` to navigate through many routes in quick succession, then immediately reads
`window.Cinder.graph()`, can produce FALSE findings - some apps' navigation/sidebar components
take a little longer to settle their accessible name after a rapid sequence of client-side route
changes than they do after a single, isolated navigation. Before trusting any finding, verify
it with a fresh, isolated check: navigate to a neutral page, wait for the page to fully settle,
run ONE single navigation to the flagged route, wait again, and only then read the graph. If the
label looks correct in that isolated check, the original sweep finding was a false positive from
navigating too fast, not a real content gap - drop it rather than "fixing" something that was
never actually broken.

## Step 1: run the audit

If the target app already imports `cinder` (the npm package), the cleanest way to get a
snapshot is live, from a real running instance of the app. These two steps run in DIFFERENT
places, not the same one - a bare `import 'cinder'` does not resolve inside a literal browser
console or inside `page.evaluate()`, since neither is a bundled module context (found by trying
it, not assumed):

```js
// 1. In the browser console, or Playwright's page.evaluate(), on a page where Cinder has
// scanned - plain JSON data out, nothing to import here:
const snapshotJson = JSON.stringify(window.Cinder.graph());
```

```js
// 2. Wherever you're actually running (Node, a script, an agent's own tool-use) - the real
// function, a real import:
import { auditLabelQuality } from 'cinder'; // or '../node_modules/cinder/dist/index.js'
const findings = auditLabelQuality(JSON.parse(snapshotJson));
```

Each finding looks like:

```json
{ "nodeId": "route:__root__:some-page-variant-a", "key": "some-page-variant-a", "type": "route", "issue": "label_echoes_key", "currentLabel": "some-page-variant-a", "selectorHint": "#primary-navigation > a[cinder-route=\"some-page-variant-a\"]" }
```

- `issue: "missing_label"` - the element has no accessible name Cinder could find at all.
- `issue: "label_echoes_key"` - it has one, but it's just the key with separators normalized
  away (e.g. "Some Page Variant A" for key `some-page-variant-a`) - functionally the same
  problem. Re-verify this one especially carefully (see the caution above) before trusting it -
  it's the category a rapid sweep was found most likely to flag by mistake.

If the app can't easily be run live, scan the snapshot a test harness already produces (e.g. a
JSDOM-based scan in this repo's own test scripts), or fall back to a manual source search for
`cinder-route=`, `cinder-action=`, `cinder-field=`, `cinder-filter=`, `cinder-output=` and check
each one by eye for a real, adjacent `aria-label` or associated `<label>`.

**Triage**: prioritize `route`, `action`, `field`, `filter`, and `output` findings - these are
real command targets a user's request gets matched against. `context` findings are lower
priority - contexts are structural groupings, not things a user directly asks for by name, so a
missing context label is far less likely to cause a wrong or declined resolution.

## Step 1.5: re-verify each finding in isolation before acting on it

For every finding from a scripted sweep, re-check it on its own: from a neutral starting page,
wait for it to settle, perform ONE single navigation to the flagged route, wait again, then
read `window.Cinder.graph()` once more for that one node. Drop any finding that comes back
clean in this isolated check - see the caution above for why a sweep can report these falsely.
Only carry forward findings that are STILL present after this isolated re-check into Step 2.

## Step 2: find the real source for each finding

Use `selectorHint` (when present) and the element's `key` to locate the real source. Search the
codebase for the literal key as it would appear in a `cinder-route="<key>"`-style attribute (or
however this specific app spreads Cinder attributes - some apps build them via a helper
function rather than writing the literal attribute inline, so also check for the key appearing
as a route path, slug, or id elsewhere that a helper might derive the attribute from).

## Step 3: write a real label and apply it

For each finding, write a short, specific, human-readable label - not a slug, not the key
reformatted, an actual description of what the element does or where it goes, in the same style
in the surrounding app has sibling elements of the SAME type already doing well. Prefer reusing
data the app already has close at hand over inventing new text - a page's own title, a route's
own human-written alias, a button's own call-to-action copy - rather than guessing blind.

Apply it as a real `aria-label` attribute (or, if the element already has visible text that
would make a good label on its own, verify that text is actually reaching the DOM - sometimes
the bug is that a prop meant to carry the real title never gets threaded through to where the
attributes are spread).

Do not invent facts about what an element does to write its label - if its real purpose isn't
recoverable from the surrounding code/content, say so rather than guessing at a plausible-looking
description.

## Step 4: re-verify

Re-run Step 1's audit (or re-scan the live app) and confirm the specific findings you fixed no
longer appear. Don't just assume the edit worked - a prop that still isn't threaded through
correctly, or a label set on the wrong element, will look fixed in the source diff but not
actually change what Cinder's scanner sees.
