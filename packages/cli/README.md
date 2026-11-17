# @usecinder/cli

Automates the Cinder tagging checklist (`docs/prompts/cinder-tagging-checklist.md`) against a
real running instance of your app, instead of a developer having to run each audit by hand.

```sh
npx @usecinder/cli integrate http://localhost:3000
```

This crawls every same-origin page reachable from that URL (one hard navigation per page, with
a settle pause before auditing - the same "let the accessible name settle" lesson the manual
checklist already teaches), runs both of Cinder's tagging audits
(`auditUntaggedElements`/`auditLabelQuality`) on each page, and writes one consolidated
`cinder-integration-report.md` - meant to be handed directly to a coding agent (Claude Code,
Cursor, or similar) to review and apply.

## If your app requires login

Without a session, every page behind an auth wall just redirects to your login page and audits
that instead - the report says so explicitly rather than silently auditing the wrong thing. Export
an authenticated session first:

```ts
// once, interactively or in a setup script
const context = await browser.newContext();
// ... log in ...
await context.storageState({ path: "auth.json" });
```

```sh
npx @usecinder/cli integrate http://localhost:3000/app --storage-state auth.json
```

## Options

```
cinder integrate <url> [options]

  --max-pages <n>       Stop after this many pages (default: 25).
  --settle-ms <n>       Pause after each page load before auditing it (default: 400).
  --storage-state <f>   Path to a Playwright storage-state JSON file for an authenticated session.
  --out <file>          Where to write the report (default: cinder-integration-report.md).
```

This only reads your app - it never edits source files itself. Deciding which findings are real
and applying them is left to you and your coding agent, the same judgment call every other
Cinder audit tool already requires.

## `install-skill`: so this doesn't have to be rediscovered every time

```sh
npx @usecinder/cli install-skill
```

Installs the real Claude Code Skill into `.claude/skills/cinder/SKILL.md` (so any Claude Code
session opened in this repo picks up the tagging checklist automatically from then on) and
appends a short, clearly-delimited section to `AGENTS.md` (a convention several coding agents
already read) pointing a future agent - any agent, not only Claude Code - at the same checklist.

Never silently clobbers something it doesn't own: a different, already-customized
`.claude/skills/cinder/SKILL.md` is left alone unless `--force` is passed, and an `AGENTS.md`
that already has a Cinder section (found by its own marker comment, never guessed) is always
left untouched regardless of `--force` - edit it directly instead of re-running this.

```
cinder install-skill [options]

  --target <dir>   Repo root to install into (default: current directory).
  --force          Overwrite an existing, different .claude/skills/cinder/SKILL.md.
```
