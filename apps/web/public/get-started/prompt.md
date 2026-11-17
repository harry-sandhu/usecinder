# Cinder setup

Add Cinder - a semantic command layer that lets real users navigate and operate this web app by
voice or text, resolved locally first and only falling back to a cloud model when genuinely
needed - to this application.

Run every step yourself. Do not just print these instructions for the user to follow, and do
not ask the user to run the commands below - that defeats the point of this file.

## 1. Install the browser SDK

Detect the package manager already in use from the lockfile present in the repo root
(`package-lock.json` -> npm, `pnpm-lock.yaml` -> pnpm, `yarn.lock` -> yarn, `bun.lockb` -> bun),
then install the one required package:

- npm: `npm install usecinder`
- pnpm: `pnpm add usecinder`
- yarn: `yarn add usecinder`
- bun: `bun add usecinder`

`usecinder` is the whole browser runtime (the exported singleton is still called `Cinder` -
only the npm package name is `usecinder`). Nothing else is required for the local-first path -
install `@cinder/server` later, and only if this app wants cloud fallback for requests local
resolution can't handle.

## 2. Initialize the runtime once, at the app's real entry point

Find where this app actually mounts (`main.tsx`/`main.ts`, the root layout, `_app.tsx`, or
equivalent - whatever this framework really uses, never force a React-shaped snippet into a
Vue or plain-HTML app) and initialize Cinder there, once:

```ts
import { Cinder } from "usecinder";

await Cinder.init({
  semantic: {
    scanOnInit: true,
    observeMutations: true,
  },
  ai: {
    enabled: false,
    mode: "local",
  },
});
```

Keep `ai.enabled: false` for now - the local-first path (tier 1: the deterministic graph, tier
2: client-side embeddings) should work cleanly before anything talks to a network. `Cinder` is
already a real singleton exported by the package - never construct it, never reassign it to
`window.Cinder` yourself; the browser SDK does that already for its own debugging/tooling use.

## 3. Tag the real, high-value entry points

Add `cinder-route`, `cinder-action`, `cinder-field`, `cinder-filter`, and `cinder-output`
attributes (plus a real, stable `key` on each) to this app's actual primary navigation links,
its most important buttons, its main search/filter inputs, and the data a real user would
genuinely want to ask for - a handful of the most obviously valuable ones first, not an
exhaustive sweep. Step 4 finds everything this step missed.

```html
<a href="/reports" cinder-route="reports">Reports</a>
<button cinder-action="refresh-data">Refresh</button>
<input cinder-field="search" placeholder="Search..." />
<div tabindex="0" cinder-output="price">...</div>
```

## 4. Run the real tagging checklist against the running app

Install `@cinder/cli` and run it against this app's own real dev server (start the dev server
first if it isn't already running):

```
npx @cinder/cli integrate <this app's real local dev URL>
```

This crawls every real same-origin page it can reach and writes one consolidated
`cinder-integration-report.md` - genuine, app-specific untagged-element and weak-label findings,
not a generic checklist. Read that file and apply the fixes it lists to the real source files,
using your own judgment on each one exactly as the report itself says: confirm an element's real
purpose before tagging it (a cosmetic toggle or an external link is correctly NOT a Cinder
candidate), and write real human labels, not restatements of a key.

If the app requires login, re-run with `--storage-state <file>` pointed at an authenticated
session - otherwise every protected page just redirects to the login page and that's all that
gets audited. The tool's own report will say plainly if this happened.

## 5. Confirm it actually works

With the dev server running and the page loaded, run a real command through the full pipeline
in the browser console (or via whatever this agent's own browser automation is) and confirm it
actually did the right thing, not just that it returned without an error:

```js
const result = await Cinder.run("open <a real route you just tagged>", document);
console.log(result.intent, result.dispatch, result.reflex);
```

If `result.dispatch.handled` is false or the app didn't visibly navigate, re-check step 2 (is
`Cinder.init` actually running before the command does) and step 3 (is the target genuinely
tagged, with a real, matching key) before concluding anything is broken in Cinder itself.

## 6. Install the Cinder skill, so this doesn't have to be rediscovered next time

```
npx @cinder/cli install-skill
```

This writes `.claude/skills/cinder/SKILL.md` (so any Claude Code session opened in this repo
picks it up automatically from now on) and adds a short section to `AGENTS.md` pointing a future
agent - any agent, not only this one - at step 4's checklist, so new UI added later gets tagged
without needing this whole file re-fetched and re-run from scratch. Safe to run even if either
file already exists: an existing, different skill file is left alone unless `--force` is given,
and an `AGENTS.md` that already has a Cinder section is never touched again - it says so either
way, so check the command's own output rather than assuming.

## Summary

Report back to the user: which package manager and framework were detected, where `Cinder.init`
was wired in, how many real findings `cinder integrate` produced and how many were fixed, the
result of the step 5 confirmation (what command was run, and whether it actually dispatched
correctly), and whether step 6 installed the skill/`AGENTS.md` section or found them already
present. Point them at `https://usecinder.dev/docs` for anything past this first proof - cloud
fallback, speech input, the full semantic tag reference, and the graph-enrichment tooling that
reduces live AI usage over time.
