---
name: cinder
description: Use this skill whenever working in a repository that has Cinder (the `usecinder` npm package - a semantic command layer letting real users navigate/operate a web app by voice or text) installed, or whenever the user asks to integrate Cinder, tag elements for Cinder, fix Cinder labels, reduce Cinder's cloud-AI usage, or audit/improve how much of the app Cinder can resolve locally. Trigger this proactively after adding new routes, pages, forms, filters, or interactive controls to an app that already uses Cinder, even if the user doesn't explicitly mention Cinder by name - new untagged UI is exactly the gap this skill exists to close.
---

# Cinder integration and tagging checklist

Cinder resolves a user's voice/text command through three tiers: a local deterministic graph
match (free, instant), a local embedding model (free, still instant), and - only when neither of
those can resolve it - a real cloud LLM call (the only tier that costs money or has network
latency). Every element this skill tags, and every weak label it fixes, is pure upside: it
either makes a request resolvable locally that previously had to reach the cloud, or it makes a
request resolvable at all that previously failed outright.

## When there's no Cinder integration here yet

1. Detect the package manager from the lockfile (`package-lock.json` → npm, `pnpm-lock.yaml` →
   pnpm, `yarn.lock` → yarn, `bun.lockb` → bun) and install `usecinder`.
2. Find the app's real entry point and initialize it once:
   ```ts
   import { Cinder } from "usecinder";
   await Cinder.init({ semantic: { scanOnInit: true, observeMutations: true }, ai: { enabled: false, mode: "local" } });
   ```
3. Tag the app's real, obviously-valuable navigation links, primary buttons, search/filter
   inputs, and outputs with `cinder-route`/`cinder-action`/`cinder-field`/`cinder-filter`/
   `cinder-output` attributes plus a real, stable `key` on each.
4. Continue with the checklist below - it finds everything this first pass missed.

## The tagging checklist (run this any time, not just on first integration)

Run this whenever new UI was just added, or whenever asked to "improve Cinder coverage" /
"reduce fallback to the cloud" / "fix Cinder labels" / "tag this for Cinder." Two checks, in
this order - order matters, because a newly-tagged element from step 1 becomes a candidate for
step 2's label check:

### 1. Find untagged elements

Install `@cinder/cli` if it isn't already, then run it against the app's real running dev
server (start the dev server first if needed):

```
npx @cinder/cli integrate <the app's real local dev URL>
```

If the app requires login, every protected route will otherwise just redirect to the login page
and audit that instead - re-run with `--storage-state <file>` pointed at an authenticated
session (export one via Playwright's `context.storageState({ path })` after logging in once).
The tool's own report says plainly if a page redirected, so this is never silently wrong.

This writes `cinder-integration-report.md`: every real page it could reach, with genuine,
app-specific findings - elements that look like they should be tagged but aren't, and labels
that are either missing or just echo the element's own key instead of a real human label.

### 2. Apply the findings - with real judgment, never blindly

For each untagged-element finding: confirm the element's real purpose before tagging it. The
report's `suggestedTag` is a best-effort guess from the element's HTML shape (a real `<a href>`
suggests `cinder-route`, a `<button>` suggests `cinder-action`, and so on) - not a verified
classification. Some findings are correctly NOT a Cinder candidate at all: a cosmetic UI toggle
with no real command semantics, a link to an external site, a dev-tools button. Skip those.
**Never suggest tagging a password field or any other sensitive-value input** - letting a
semantic command engine set a password's value is a real security anti-pattern, not a minor
style issue.

For each weak-label finding: write a real, human label a real user would actually say or
recognize - not a restatement of the key (`"docs-guides"` is not a real label for a route whose
real title is "Guides"). Prefer fixing it at the most central place possible: if this app
derives its Cinder attributes from a shared route/field/action registry file rather than
hand-writing each tag, fix the label there once instead of hunting down every individual tagged
element.

### 3. Re-verify, then confirm it actually works

Re-run step 1 once the fixes are applied - the goal is zero genuine findings left, not zero raw
findings (some raw findings are correctly judged not real candidates, per above). Then confirm
end to end, not just that the audit is clean:

```js
const result = await Cinder.run("open <a route you just tagged>", document);
console.log(result.intent, result.dispatch, result.reflex);
```

If `result.dispatch.handled` is false, or the app didn't visibly do the right thing, the tagging
isn't actually done yet even if the checklist reports clean - go back and check the real key
matches what a user would naturally say, and that `Cinder.init` is genuinely running before any
command does.

## Reducing cloud AI usage further (graph enrichment)

Once the basics are tagged and labeled, the next real lever is teaching Cinder aliases and
relationships it doesn't have yet - synonyms a real user would say that the current labels don't
cover, and real relationships between elements (like which action navigates to which route,
`data-cinder-navigates-to`) that help a cloud fallback disambiguate when it is still needed.

```ts
import { exportGraphForEnrichment } from "usecinder";
const summary = exportGraphForEnrichment(window.Cinder.graph());
```

Review the real graph summary this returns (every real node's key, type, current label/aliases,
and page position), suggest additional aliases and relationships grounded in what the app
actually does - never inferred from naming similarity or DOM proximity alone, that's exactly
the kind of untrustworthy guess this is supposed to avoid - and hand the result to the user as a
`CinderColdGraphCatalog` for them to review before calling `Cinder.registerColdGraph(catalog)`.
Nothing here should ever activate without a human looking at it first.
