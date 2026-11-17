// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
// Coverage for apps/web/public/get-started/prompt.md - the agent-fetchable onboarding file at
// https://usecinder.dev/get-started/prompt.md, mirroring the same pattern Neon ships at
// https://neon.com/get-started/prompt.md (fetched and followed directly this session). A
// coding agent fetches this file and runs it, so a quiet regression here (a wrong package
// name, a stale API shape) would mislead every agent that follows it, not just a human reader -
// this checks the real, current package/API facts it depends on stay true, not just that the
// file exists.
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';

const PROMPT_PATH = new URL('../apps/web/public/get-started/prompt.md', import.meta.url);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function installDomGlobals(dom) {
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Event = dom.window.Event;
  globalThis.CSS = dom.window.CSS ?? {
    escape(value) {
      return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    },
  };
}

async function main() {
  const content = readFileSync(PROMPT_PATH, 'utf8');

  // 1. The real, current package/API names this file tells an agent to use must actually be
  // real - not stale names from an earlier design that got renamed since.
  assert(content.includes('npm install usecinder'), 'Expected the real package name "usecinder" (not a stale/renamed package) in the install step.');
  assert(content.includes('import { Cinder } from "usecinder"'), 'Expected the real, documented singleton import shape.');
  assert(content.includes('npx @cinder/cli integrate'), 'Expected the real @cinder/cli command this session actually built and tested.');
  assert(content.includes('--storage-state'), 'Expected the real auth-wall flag found necessary by live testing against rupeey.');
  assert(content.includes('npx @cinder/cli install-skill'), 'Expected the real install-skill command.');
  assert(content.includes('.claude/skills/cinder/SKILL.md') && content.includes('AGENTS.md'), 'Expected the real file paths install-skill actually writes.');

  // 2. The exact `Cinder.init` snippet given must be real, valid usage - prove it by actually
  // running it against a real cinder build, the same way a following agent would, rather than
  // just checking the text looks plausible.
  const snippetMatch = content.match(/```ts\nimport \{ Cinder \} from "usecinder";\n\nawait Cinder\.init\(\{[\s\S]*?\}\);\n```/);
  assert(snippetMatch, 'Expected to find the Cinder.init code snippet in the expected shape.');

  const dom = new JSDOM('<main></main>', { url: 'http://localhost/' });
  installDomGlobals(dom);
  const { Cinder } = await import('../packages/cinder/dist/index.js');
  const initCall = snippetMatch[0].replace(/```ts\n|```/g, '').replace('import { Cinder } from "usecinder";\n\n', '');
  // eslint-disable-next-line no-new-func
  const runInitSnippet = new Function('Cinder', `return (async () => { ${initCall} })();`);
  await runInitSnippet(Cinder);
  assert(Cinder.status() === 'ready', 'Expected the exact snippet given in the prompt to actually initialize the runtime successfully.');

  // 3. The real public docs URL given at the end must point at this app's real domain, not a
  // placeholder or a typo'd one.
  assert(content.includes('https://usecinder.dev/docs'), 'Expected the real docs URL.');

  console.log('All get-started/prompt.md validations passed.');
}

main();
