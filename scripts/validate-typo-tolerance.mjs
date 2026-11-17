// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
// Systematic coverage for the typo-tolerant matching tier (core/cge/queryEngine.ts:
// hasFullTokenFuzzyOverlap, damerauLevenshteinDistance, maxAllowedEditDistance).
//
// Researched before implementing (fork agent, 2026-11-13): chose true Damerau-Levenshtein
// (handles adjacent-letter transposition as a single edit - the most common real typo shape)
// over SymSpell (its precomputed-dictionary speedup targets large dictionaries; Cinder
// matches against a handful to a few hundred node keys/aliases per page, so that problem
// doesn't exist here) and over Jaro-Winkler (easy to hand-implement subtly wrong, no clear
// accuracy win at these word lengths). Tolerance is scaled by word length (0 edits <=3
// chars, 1 edit 4-6 chars, 2 edits 7+ chars) specifically so short words can only match
// themselves exactly - this script's "short word safety" section is there because an
// unscaled flat tolerance is exactly the kind of looseness that caused prior real bugs this
// session (an unrelated short term fuzzy-matching an unrelated node).
import { JSDOM } from 'jsdom';
import { CinderSemanticRuntime, classifyRunResult } from '../packages/cinder/dist/index.js';

function installDomGlobals(dom) {
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLInputElement = dom.window.HTMLInputElement;
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
        <input cinder-field="crop" />
        <input cinder-field="state" />
        <button cinder-action="search">Search</button>
        <button cinder-action="save">Save</button>
      </div>
    </main>
  `;
}

// Real typo shapes (transposition and single-letter deletion) on longer words - must
// resolve, but ONLY as resolved_fuzzy, never resolved_exact (a typo match claiming full
// certainty would be a regression of the honest-signaling principle this session is built on).
const typoShouldResolveFuzzy = [
  { input: 'set corp to soybean', target: 'crop' }, // transposition: crop -> corp
  { input: 'serach', target: 'search' }, // transposition: search -> serach
  { input: 'serch', target: 'search' }, // deletion: search -> serch
  { input: 'saerch', target: 'search' }, // transposition: search -> saerch
];

// Short words (<=3 chars) must NOT fuzzy-match anything - zero tolerance is the whole
// point of length-scaling. None of these have any real target in the fixture; they must
// come back unknown, not accidentally resolve to something via the fuzzy tier.
const shortWordsMustNotResolve = ['go', 'at', 'on', 'it'];

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

  for (const testCase of typoShouldResolveFuzzy) {
    const resolved = runtime.resolve(testCase.input);
    const outcome = resolved.intent === 'unknown' ? 'not_resolved' : (resolved.confidence >= 0.85 ? 'resolved_exact' : 'resolved_fuzzy');

    if (outcome !== 'resolved_fuzzy') {
      failures.push(`Expected "${testCase.input}" to resolve as resolved_fuzzy, got "${outcome}" (intent: ${resolved.intent}).`);
      continue;
    }

    if (resolved.target !== testCase.target) {
      failures.push(`Expected "${testCase.input}" to target "${testCase.target}", got "${resolved.target}".`);
    }
  }

  for (const input of shortWordsMustNotResolve) {
    const resolved = runtime.resolve(input);
    if (resolved.intent !== 'unknown') {
      failures.push(`Expected short word "${input}" to stay unresolved (zero fuzzy tolerance), but it resolved as "${resolved.intent}" -> "${resolved.target}".`);
    }
  }

  // A typo that's genuinely equidistant between two real candidates must still fall to
  // unknown via the existing ambiguity gap-check, not silently pick one - the fuzzy tier
  // must not bypass that existing safety net. Verified by hand: "line" -> "pine" is one
  // substitution (l->p), "line" -> "wine" is also one substitution (l->w) - a true tie, not
  // an assumption (an earlier version of this test used "submit"/"summit" against "submot",
  // which turned out to NOT actually be equidistant - submit is 1 edit away, summit is 2 -
  // so only submit legitimately matched. Left as a reminder: verify edit distances by hand,
  // don't eyeball "looks like a typo of both").
  const ambiguousDom = new JSDOM(`
    <main><div cinder-context="c">
      <button cinder-action="pine">Pine</button>
      <button cinder-action="wine">Wine</button>
    </div></main>
  `, { url: 'http://localhost/' });
  installDomGlobals(ambiguousDom);
  const ambiguousRuntime = new CinderSemanticRuntime();
  await ambiguousRuntime.init({
    semantic: { scanOnInit: false, observeMutations: false },
    ai: { enabled: false, mode: 'local', endpoint: '', apiKey: '' },
  });
  await ambiguousRuntime.scan(ambiguousDom.window.document);
  const ambiguousResult = ambiguousRuntime.resolve('line');
  if (ambiguousResult.intent === 'trigger_action') {
    failures.push(`Expected a typo equidistant between "pine" and "wine" to be flagged ambiguous (unknown), but it confidently picked "${ambiguousResult.target}".`);
  }
  ambiguousRuntime.destroy();

  runtime.destroy();

  if (failures.length > 0) {
    console.error('[validate-typo-tolerance] failed:\n' + failures.join('\n'));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({
    ok: true,
    summary: {
      typoCasesChecked: typoShouldResolveFuzzy.length,
      shortWordSafetyCasesChecked: shortWordsMustNotResolve.length,
      ambiguousTypoOutcome: ambiguousResult.intent,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-typo-tolerance] failed:', error);
  process.exitCode = 1;
});
