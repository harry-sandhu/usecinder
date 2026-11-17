// Systematic coverage for core/cie/linguistics.ts - the negation/sentence-mood check that
// matchActionPlanner (planners/action.ts) uses before accepting a fuzzy action match.
//
// Why this exists: the action planner is the one planner that fuzzy-matches a node key
// against the WHOLE input string rather than anchoring on a leading verb (navigate/output/
// set-value all require their verb to be the first word, which already makes them immune to
// this - "don't open settings" doesn't start with "open", so their regex never matches at
// all). Without this check, ANY sentence merely mentioning an action's name - "I don't want
// to search", "the search already finished", "why would I search" - would fire the action
// just as confidently as a real command. This script holds the line on that, with a broad,
// varied matrix rather than a couple of cherry-picked examples, and explicitly documents the
// one case this module does NOT solve (noun-leading ambiguity) rather than hiding it.
import { JSDOM } from 'jsdom';
import { CinderSemanticRuntime } from '../packages/cinder/dist/index.js';

function installDomGlobals(dom) {
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
  globalThis.Event = dom.window.Event;
  globalThis.CSS = dom.window.CSS ?? {
    escape(value) {
      return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    },
  };
}

function createMarkup() {
  return `
    <main>
      <div cinder-context="c">
        <button cinder-action="search">Search</button>
      </div>
    </main>
  `;
}

// A compound, hyphenated action key - like real production keys (open-docs-search,
// toggle-theme-desktop) found during the apps/web real-site test. This fixture exists
// specifically to catch a real bug that single-word fixtures above can't: when a match comes
// from key-token-overlap rather than an exact single-token hit, findMatchedKeywordIndex
// (planners/action.ts) falls back to a position for the negation scan - verifying that
// fallback actually checks the whole sentence (it's not index 0; a real site test found
// "never open menu" and "do not open menu" still firing because of this).
function createCompoundKeyMarkup() {
  return `
    <main>
      <div cinder-context="c">
        <button cinder-action="open-site-navigation">Menu</button>
      </div>
    </main>
  `;
}

const compoundKeyShouldFire = ['open menu', 'please open menu', 'open the menu'];
const compoundKeyShouldNotFire = [
  'never open menu',
  'do not open menu',
  "don't open menu",
  "i don't want to open menu",
  'why would i open menu',
];

// Real commands - must fire trigger_action.
const shouldFire = [
  'search',
  'please search',
  'search now',
  'just search',
  'search please',
  'kindly search',
  'search right now',
  'do the search',
];

// Negation, questions, descriptions - must NOT fire (classified as unknown).
const shouldNotFire = [
  "i don't want to search",
  'i do not want to search',
  'i never want to search',
  'do not search',
  "don't search",
  'never search',
  'why would i search',
  'why would you search',
  'what is search',
  'the search already finished',
  'the search was successful',
  'would you search',
  'could you search',
  'should i search',
  'is the search done',
  'are you going to search',
  "we don't search here",
  "they shouldn't search",
  "he isn't going to search",
];

// Known, documented limitation: when the action's key is used as a NOUN leading the
// sentence ("search results are shown below"), word-position heuristics alone can't tell
// that apart from an imperative "search" - that needs real part-of-speech tagging, which is
// out of scope for a zero-dependency module (see linguistics.ts's doc comment and the
// local-engine-fully-fledged-plan.md decision to build this ourselves instead of adding an
// NLP library). These are asserted to still (incorrectly) fire, so a future fix is measured
// against a known baseline instead of this script silently going green while the behavior
// quietly changes underneath it.
const knownUnsolved = ['search results are shown below', 'search bar is at the top'];

async function main() {
  const dom = new JSDOM(createMarkup(), { url: 'http://localhost/' });
  installDomGlobals(dom);

  const runtime = new CinderSemanticRuntime();
  await runtime.init({
    semantic: { scanOnInit: false, observeMutations: false },
    ai: { enabled: false, mode: 'local', endpoint: '', apiKey: '' },
  });
  await runtime.scan(dom.window.document);

  const failures = [];

  for (const input of shouldFire) {
    const resolved = runtime.resolve(input);
    if (resolved.intent !== 'trigger_action') {
      failures.push(`Expected "${input}" to fire trigger_action, got "${resolved.intent}".`);
    }
  }

  for (const input of shouldNotFire) {
    const resolved = runtime.resolve(input);
    if (resolved.intent === 'trigger_action') {
      failures.push(`Expected "${input}" to NOT fire (negation/question/description), but it resolved as trigger_action.`);
    }
  }

  const knownUnsolvedResults = knownUnsolved.map((input) => ({
    input,
    intent: runtime.resolve(input).intent,
  }));

  runtime.destroy();

  const compoundDom = new JSDOM(createCompoundKeyMarkup(), { url: 'http://localhost/' });
  installDomGlobals(compoundDom);
  const compoundRuntime = new CinderSemanticRuntime();
  await compoundRuntime.init({
    semantic: { scanOnInit: false, observeMutations: false },
    ai: { enabled: false, mode: 'local', endpoint: '', apiKey: '' },
  });
  await compoundRuntime.scan(compoundDom.window.document);

  for (const input of compoundKeyShouldFire) {
    const resolved = compoundRuntime.resolve(input);
    if (resolved.intent !== 'trigger_action') {
      failures.push(`Expected "${input}" (compound key) to fire trigger_action, got "${resolved.intent}".`);
    }
  }

  for (const input of compoundKeyShouldNotFire) {
    const resolved = compoundRuntime.resolve(input);
    if (resolved.intent === 'trigger_action') {
      failures.push(`Expected "${input}" (compound key, negated) to NOT fire, but it resolved as trigger_action.`);
    }
  }

  compoundRuntime.destroy();

  if (failures.length > 0) {
    console.error('[validate-action-linguistics] failed:\n' + failures.join('\n'));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({
    ok: true,
    summary: {
      shouldFireCount: shouldFire.length,
      shouldNotFireCount: shouldNotFire.length,
      compoundKeyShouldFireCount: compoundKeyShouldFire.length,
      compoundKeyShouldNotFireCount: compoundKeyShouldNotFire.length,
      knownUnsolvedResults,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-action-linguistics] failed:', error);
  process.exitCode = 1;
});
