// Systematic coverage for the number-word parser (core/cie/numberWords.ts) and its wiring
// into matchSetValuePlanner (planners/setValue.ts).
//
// Confirmed via tier-1 research (fork agent, 2026-11-13): number-word-to-digit parsing is a
// standard, expected NLU primitive (Amazon Lex ships AMAZON.Number as a built-in slot type
// for exactly this) and is small enough to hand-roll zero-dependency, unlike date-phrase
// parsing (explicitly scoped out - see docs/local-engine-fully-fledged-plan.md §11).
import { JSDOM } from 'jsdom';
import { CinderSemanticRuntime } from '../packages/cinder/dist/index.js';
import { parseNumberWords } from '../packages/cinder/dist/core/cie/numberWords.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function installDomGlobals(dom) {
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLInputElement = dom.window.HTMLInputElement;
  globalThis.Event = dom.window.Event;
  globalThis.CSS = dom.window.CSS ?? {
    escape(value) {
      return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    },
  };
}

const shouldParse = [
  ['zero', 0],
  ['one', 1],
  ['five', 5],
  ['nine', 9],
  ['ten', 10],
  ['eleven', 11],
  ['nineteen', 19],
  ['twenty', 20],
  ['twenty one', 21],
  ['twenty-one', 21],
  ['ninety nine', 99],
  ['a hundred', 100],
  ['one hundred', 100],
  ['one hundred and five', 105],
  ['one hundred five', 105],
  ['two hundred twenty two', 222],
  ['nine hundred ninety nine', 999],
  ['a thousand', 1000],
  ['one thousand', 1000],
  ['two thousand', 2000],
  ['two thousand five', 2005],
  ['two thousand and five', 2005],
  ['twenty thousand', 20000],
  ['twenty thousand five hundred', 20500],
  ['a million', 1000000],
  ['two million three hundred thousand', 2300000],
];

// Must be REJECTED (undefined), not half-converted - strictness is the point: a value that
// isn't a clean, complete number phrase should stay as the user typed it.
const shouldReject = ['five apples', 'five five', 'twenty eleven', 'hundred', 'thousand', '', 'soybean', 'and five', 'five and'];

function createMarkup() {
  return `
    <main>
      <div cinder-context="c">
        <input cinder-field="quantity" />
        <input cinder-field="crop" />
      </div>
    </main>
  `;
}

async function main() {
  const failures = [];

  for (const [input, expected] of shouldParse) {
    const actual = parseNumberWords(input);
    if (actual !== expected) {
      failures.push(`Expected parseNumberWords("${input}") to be ${expected}, got ${actual}.`);
    }
  }

  for (const input of shouldReject) {
    const actual = parseNumberWords(input);
    if (actual !== undefined) {
      failures.push(`Expected parseNumberWords("${input}") to be rejected (undefined), got ${actual}.`);
    }
  }

  const dom = new JSDOM(createMarkup(), { url: 'http://localhost/' });
  installDomGlobals(dom);
  const runtime = new CinderSemanticRuntime();
  await runtime.init({
    semantic: { scanOnInit: false, observeMutations: false },
    ai: { enabled: false, mode: 'local', endpoint: '', apiKey: '' },
  });
  await runtime.scan(dom.window.document);

  const integrationCases = [
    { input: 'set quantity to five', target: 'quantity', value: '5' },
    { input: 'set quantity to twenty two', target: 'quantity', value: '22' },
    { input: 'set quantity to 7', target: 'quantity', value: '7' },
    { input: 'set crop to soybean', target: 'crop', value: 'soybean' },
    { input: 'set quantity to five apples', target: 'quantity', value: 'five apples' },
  ];

  for (const testCase of integrationCases) {
    const resolved = runtime.resolve(testCase.input);
    if (resolved.target !== testCase.target || resolved.value !== testCase.value) {
      failures.push(`Expected "${testCase.input}" -> target "${testCase.target}" value "${testCase.value}", got target "${resolved.target}" value "${resolved.value}".`);
    }
  }

  runtime.destroy();

  if (failures.length > 0) {
    console.error('[validate-number-words] failed:\n' + failures.join('\n'));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({
    ok: true,
    summary: {
      shouldParseCount: shouldParse.length,
      shouldRejectCount: shouldReject.length,
      integrationCasesChecked: integrationCases.length,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('[validate-number-words] failed:', error);
  process.exitCode = 1;
});
