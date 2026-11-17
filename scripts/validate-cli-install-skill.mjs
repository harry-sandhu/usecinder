// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
// Coverage for @usecinder/cli's install-skill command (packages/cli/src/core/installSkill.ts) -
// installs the real Claude Code Skill into a target repo's .claude/skills/cinder/ and appends
// a short section to AGENTS.md. The real risk here isn't "does it write a file" - it's "does
// it ever silently clobber something it doesn't own" - a developer's own customized skill, or
// unrelated content already in their AGENTS.md - so most of these cases are about NOT writing,
// not about writing.
import { readFile, mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { installSkillFiles } from '../packages/cli/dist/index.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function freshTempDir(name) {
  const dir = join('/tmp', `cinder-cli-install-skill-test-${name}-${Date.now()}`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  return dir;
}

async function main() {
  // 1. A fresh install writes both files.
  const dir1 = await freshTempDir('fresh');
  const result1 = await installSkillFiles(dir1);
  assert(result1.skillWritten === true, 'Expected a fresh install to write the skill file.');
  assert(result1.agentsMdWritten === true, 'Expected a fresh install to write AGENTS.md.');
  const skillContent = await readFile(result1.skillPath, 'utf8');
  assert(skillContent.includes('name: cinder') && skillContent.includes('description:'), 'Expected real YAML frontmatter in the installed skill.');
  assert(skillContent.includes('npx @usecinder/cli integrate'), 'Expected the real CLI command to appear in the installed skill.');

  // 2. Re-running on the exact same state is a no-op in both files, and says why.
  const result2 = await installSkillFiles(dir1);
  assert(result2.skillWritten === false && result2.skillSkippedReason === 'already up to date', 'Expected re-running to skip an already-up-to-date skill file.');
  assert(result2.agentsMdWritten === false && result2.agentsMdSkippedReason?.includes('already exists'), 'Expected re-running to skip an AGENTS.md that already has the Cinder section.');

  // 3. A DIFFERENT existing skill file (the developer customized it) is left completely
  // untouched without --force - this must never silently clobber a real customization.
  const dir3 = await freshTempDir('customized');
  const customSkillPath = join(dir3, '.claude', 'skills', 'cinder', 'SKILL.md');
  await mkdir(join(dir3, '.claude', 'skills', 'cinder'), { recursive: true });
  await writeFile(customSkillPath, '---\nname: cinder\ndescription: my own customized version\n---\nmy own content', 'utf8');
  const result3 = await installSkillFiles(dir3);
  assert(result3.skillWritten === false && result3.skillSkippedReason?.includes('--force'), 'Expected a different existing skill file to be left alone without --force.');
  const unchangedContent = await readFile(customSkillPath, 'utf8');
  assert(unchangedContent.includes('my own customized version'), 'Expected the customized skill file to be genuinely untouched.');

  // 4. The SAME customized file, WITH --force, is overwritten with the real packaged skill.
  const result4 = await installSkillFiles(dir3, { force: true });
  assert(result4.skillWritten === true, 'Expected --force to overwrite a different existing skill file.');
  const overwrittenContent = await readFile(customSkillPath, 'utf8');
  assert(!overwrittenContent.includes('my own customized version') && overwrittenContent.includes('npx @usecinder/cli integrate'), 'Expected --force to actually replace the content with the real packaged skill.');

  // 5. An AGENTS.md with real, unrelated content (for some other tool) gets the Cinder section
  // APPENDED, never overwriting what was already there.
  const dir5 = await freshTempDir('existing-agents-md');
  const existingAgentsMdContent = '# Agents\n\nThis repo uses SomeOtherTool. Run `some-other-tool check` before committing.\n';
  await writeFile(join(dir5, 'AGENTS.md'), existingAgentsMdContent, 'utf8');
  const result5 = await installSkillFiles(dir5);
  assert(result5.agentsMdWritten === true, 'Expected a real append when AGENTS.md exists but has no Cinder section yet.');
  const mergedContent = await readFile(result5.agentsMdPath, 'utf8');
  assert(mergedContent.includes('SomeOtherTool') && mergedContent.includes('some-other-tool check'), 'Expected the original, unrelated AGENTS.md content to be fully preserved.');
  assert(mergedContent.includes('cinder:agents-md:start') && mergedContent.includes('npx @usecinder/cli integrate'), 'Expected the real Cinder section to be appended.');
  assert(mergedContent.indexOf('SomeOtherTool') < mergedContent.indexOf('cinder:agents-md:start'), 'Expected the original content to come BEFORE the appended Cinder section, not replace it.');

  // 6. An AGENTS.md that already has the Cinder marker is left byte-for-byte untouched, even
  // with --force (force only ever applies to the skill file, never to AGENTS.md).
  const dir6 = await freshTempDir('agents-md-already-has-cinder');
  const alreadyMarked = '# Agents\n\n<!-- cinder:agents-md:start -->\nsome hand-edited cinder section\n<!-- cinder:agents-md:end -->\n';
  await writeFile(join(dir6, 'AGENTS.md'), alreadyMarked, 'utf8');
  const result6 = await installSkillFiles(dir6, { force: true });
  assert(result6.agentsMdWritten === false, 'Expected an AGENTS.md with an existing Cinder marker to be left untouched even with --force.');
  const stillMarked = await readFile(join(dir6, 'AGENTS.md'), 'utf8');
  assert(stillMarked === alreadyMarked, 'Expected the hand-edited Cinder section to be preserved byte-for-byte.');

  console.log('All @usecinder/cli install-skill validations passed.');
}

main();
