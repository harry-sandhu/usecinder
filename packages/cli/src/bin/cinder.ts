#!/usr/bin/env node
import { writeFile } from "fs/promises";
import { resolve } from "path";
import { crawlAndAudit } from "../core/crawl.js";
import { installSkillFiles } from "../core/installSkill.js";
import { buildIntegrationReport } from "../core/report.js";

const HELP_TEXT = `Cinder CLI

Usage:
  cinder integrate <url> [options]
  cinder install-skill [options]

integrate: crawls a real running instance of your app (same-origin pages only, starting from
<url>), runs both of Cinder's tagging-checklist audits on every page it finds, and writes one
consolidated report - meant to be handed to a coding agent (Claude Code, Cursor, or similar)
to apply, closing the loop between "install Cinder" and "every page is actually tagged"
without a developer having to run each audit by hand first.

install-skill: installs the Cinder Skill into this repo's .claude/skills/cinder/ (so Claude
Code picks it up automatically whenever working in this repo) and adds a short section to
AGENTS.md (a convention several coding agents already read) pointing at the same checklist -
so an agent working here knows to run it after adding new UI, without being told each time.

integrate Options:
  --max-pages <n>       Stop after this many pages (default: 25).
  --settle-ms <n>       Pause after each page load before auditing it (default: 400). Real
                        testing found rapid sequential navigation can catch a page before its
                        accessible name settles - don't lower this unless you've verified it's
                        still accurate.
  --storage-state <f>   Path to a Playwright storage-state JSON file (cookies + localStorage)
                        for an already-authenticated session. Without this, any page behind a
                        login wall will just redirect to your login page and audit THAT instead
                        of the real app - found by actually running this against a real app.
                        Export one with \`await context.storageState({ path })\` after logging
                        in once, or via \`npx playwright open <url>\`.
  --out <file>          Where to write the report (default: cinder-integration-report.md).

This only reads your app - it never edits source files itself. Deciding which findings are
real and applying them is left to you and your coding agent, the same judgment call every
other Cinder audit tool already requires (see docs/prompts/cinder-tagging-checklist.md).

install-skill Options:
  --target <dir>   Repo root to install into (default: current directory).
  --force          Overwrite an existing, different .claude/skills/cinder/SKILL.md. Without
                    this, a different existing version is left alone - never silently
                    overwritten. An AGENTS.md that already has a Cinder section (found by its
                    own marker, not guessed) is always left untouched regardless of this flag;
                    edit it directly instead.
`;

interface ParsedArgs {
  command?: string;
  url?: string;
  maxPages: number;
  settleMs: number;
  out: string;
  storageStatePath?: string;
  target: string;
  force: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const result: ParsedArgs = {
    command,
    maxPages: 25,
    settleMs: 400,
    out: "cinder-integration-report.md",
    target: process.cwd(),
    force: false,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];

    if (!arg) {
      continue;
    }

    if (arg === "--max-pages") {
      result.maxPages = Number(rest[++index]) || result.maxPages;
    } else if (arg === "--settle-ms") {
      result.settleMs = Number(rest[++index]) || result.settleMs;
    } else if (arg === "--out") {
      result.out = rest[++index] ?? result.out;
    } else if (arg === "--storage-state") {
      result.storageStatePath = rest[++index];
    } else if (arg === "--target") {
      result.target = rest[++index] ?? result.target;
    } else if (arg === "--force") {
      result.force = true;
    } else if (!result.url && !arg.startsWith("--")) {
      result.url = arg;
    }
  }

  return result;
}

async function runIntegrate(args: ParsedArgs): Promise<void> {
  if (!args.url) {
    console.error("Usage: cinder integrate <url> [options]\n\nRun `cinder --help` for details.");
    process.exitCode = 1;
    return;
  }

  console.log(`Crawling ${args.url} (up to ${args.maxPages} pages)...`);

  const pages = await crawlAndAudit({
    startUrl: args.url,
    maxPages: args.maxPages,
    settleMs: args.settleMs,
    storageStatePath: args.storageStatePath,
    onPageVisited: (url, index, total) => {
      console.log(`  [${index}/${total}] ${url}`);
    },
  });

  const redirectedCount = pages.filter((page) => page.redirectedFrom).length;

  if (redirectedCount > 0 && !args.storageStatePath) {
    console.log(`\n${redirectedCount} page(s) redirected elsewhere (likely an auth wall) - see --storage-state in \`cinder --help\`.`);
  }

  const report = buildIntegrationReport(pages);
  const outPath = resolve(process.cwd(), args.out);
  await writeFile(outPath, report, "utf8");

  const totalUntagged = pages.reduce((sum, page) => sum + page.untagged.length, 0);
  const totalWeakLabels = pages.reduce((sum, page) => sum + page.weakLabels.length, 0);

  console.log(`\nScanned ${pages.length} page(s): ${totalUntagged} untagged element finding(s), ${totalWeakLabels} weak-label finding(s).`);
  console.log(`Report written to ${outPath}`);
  console.log("Hand that file to your coding agent to review and apply.");
}

async function runInstallSkill(args: ParsedArgs): Promise<void> {
  const result = await installSkillFiles(resolve(args.target), { force: args.force });

  if (result.skillWritten) {
    console.log(`Wrote ${result.skillPath}`);
  } else {
    console.log(`Skipped ${result.skillPath} (${result.skillSkippedReason})`);
  }

  if (result.agentsMdWritten) {
    console.log(`Updated ${result.agentsMdPath}`);
  } else {
    console.log(`Skipped ${result.agentsMdPath} (${result.agentsMdSkippedReason})`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.command || args.command === "--help" || args.command === "-h") {
    console.log(HELP_TEXT);
    return;
  }

  if (args.command === "integrate") {
    await runIntegrate(args);
    return;
  }

  if (args.command === "install-skill") {
    await runInstallSkill(args);
    return;
  }

  console.error(`Unknown command "${args.command}".\n`);
  console.log(HELP_TEXT);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error("cinder integrate failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
