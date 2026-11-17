import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

/**
 * The Claude Code Skill (and the AGENTS.md section below) ship as a bundled asset inside this
 * package - not generated on the fly - so the installed content is exactly what was reviewed
 * and tested, the same reasoning @cinder/cli's own report-building logic already follows for
 * its own output.
 */
const AGENTS_MD_MARKER_START = "<!-- cinder:agents-md:start -->";
const AGENTS_MD_MARKER_END = "<!-- cinder:agents-md:end -->";

function getSkillAssetPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "skill-assets", "cinder", "SKILL.md");
}

async function readFileIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

function buildAgentsMdBlock(): string {
  return [
    AGENTS_MD_MARKER_START,
    "## Cinder",
    "",
    "This repo uses Cinder (`cinder`), a semantic command layer that lets real users navigate " +
      "and operate this app by voice or text. After adding new routes, pages, forms, filters, " +
      "or interactive controls, run the real tagging checklist against the running dev server:",
    "",
    "```",
    "npx @cinder/cli integrate <the app's real local dev URL>",
    "```",
    "",
    "Apply the findings in the resulting `cinder-integration-report.md` with real judgment - " +
      "never blindly apply a suggested tag, and never tag a password or other sensitive-value " +
      "field. Full detail: `.claude/skills/cinder/SKILL.md`, or " +
      "https://usecinder.dev/get-started/prompt.md.",
    AGENTS_MD_MARKER_END,
  ].join("\n");
}

export interface InstallSkillResult {
  skillPath: string;
  skillWritten: boolean;
  skillSkippedReason?: string;
  agentsMdPath: string;
  agentsMdWritten: boolean;
  agentsMdSkippedReason?: string;
}

/**
 * Installs the Cinder Skill into a target repo's `.claude/skills/cinder/` (the real, current
 * Claude Code Skill format - YAML frontmatter + Markdown body, project-scoped so it's only
 * active in repos that actually use Cinder) and appends a short, clearly-delimited section to
 * the repo's `AGENTS.md` (creating it if it doesn't exist) - a convention multiple coding
 * agents already read, not a Claude-specific one.
 *
 * Never overwrites content it doesn't own: an existing, different SKILL.md is left alone
 * unless `force` is passed, and an AGENTS.md that already has a Cinder section (found by its
 * marker, not by guessing) is left completely untouched - editing it directly is the right
 * move at that point, not re-running this installer.
 */
export async function installSkillFiles(
  targetDir: string,
  options: { force?: boolean } = {},
): Promise<InstallSkillResult> {
  const skillContent = await readFile(getSkillAssetPath(), "utf8");
  const skillPath = join(targetDir, ".claude", "skills", "cinder", "SKILL.md");
  const existingSkill = await readFileIfExists(skillPath);

  let skillWritten = false;
  let skillSkippedReason: string | undefined;

  if (existingSkill === skillContent) {
    skillSkippedReason = "already up to date";
  } else if (existingSkill !== undefined && !options.force) {
    skillSkippedReason = "a different version already exists - pass --force to overwrite";
  } else {
    await mkdir(dirname(skillPath), { recursive: true });
    await writeFile(skillPath, skillContent, "utf8");
    skillWritten = true;
  }

  const agentsMdPath = join(targetDir, "AGENTS.md");
  const existingAgentsMd = await readFileIfExists(agentsMdPath);
  const agentsMdBlock = buildAgentsMdBlock();

  let agentsMdWritten = false;
  let agentsMdSkippedReason: string | undefined;

  if (existingAgentsMd === undefined) {
    await writeFile(agentsMdPath, `${agentsMdBlock}\n`, "utf8");
    agentsMdWritten = true;
  } else if (existingAgentsMd.includes(AGENTS_MD_MARKER_START)) {
    agentsMdSkippedReason = "a Cinder section already exists - edit it directly to change it";
  } else {
    const separator = existingAgentsMd.endsWith("\n\n") ? "" : existingAgentsMd.endsWith("\n") ? "\n" : "\n\n";
    await writeFile(agentsMdPath, `${existingAgentsMd}${separator}${agentsMdBlock}\n`, "utf8");
    agentsMdWritten = true;
  }

  return { skillPath, skillWritten, skillSkippedReason, agentsMdPath, agentsMdWritten, agentsMdSkippedReason };
}
