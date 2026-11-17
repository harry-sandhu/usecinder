import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();

const checks = [
  {
    path: 'src/pages/HomePage.tsx',
    requiredSnippets: [
      'websites you control',
      'install the sdk, add tags',
      'fallback only when needed',
    ],
  },
  {
    path: 'src/content/docs/api/index.mdx',
    requiredSnippets: [
      'Cinder.registerRoute()',
      'Cinder.registerDomAdapter()',
      'Cinder.registerIntent()',
      'Cinder.setContextProvider()',
      'Cinder.on()',
      'Cinder.off()',
    ],
  },
  {
    path: 'src/content/docs/guides/index.mdx',
    requiredSnippets: [
      '/docs/guides/using-route-registry',
      '/docs/guides/using-dom-adapters',
      '/docs/guides/writing-custom-intents',
      '/docs/guides/injecting-runtime-context',
      '/docs/guides/understanding-fallback-telemetry',
      '/docs/guides/tag-only-integration-patterns',
    ],
  },
  {
    path: 'src/content/docs/concepts/ai-fallback.mdx',
    requiredSnippets: [
      'fallback:start',
      'fallback:end',
      'timeout',
      'normalized',
      'used',
    ],
  },
  {
    path: 'src/content/docs/guides/debugging.mdx',
    requiredSnippets: [
      'Cinder.lastScan()',
      'active route',
      'active context',
      'fallback metadata',
      'Cinder.dispatch(intent, document)',
    ],
  },
  {
    path: 'src/content/docs/server/infer-endpoint.mdx',
    requiredSnippets: [
      '400 Bad Request',
      '502 Bad Gateway',
      'Authorization: Bearer <API_KEY>',
    ],
  },
  {
    path: 'src/content/docs/known-limitations.mdx',
    requiredSnippets: [
      'websites you control',
      'custom widgets may still need adapters',
      'fallback is bounded',
    ],
  },
];

const problems = [];

for (const check of checks) {
  const filePath = path.join(root, check.path);
  const source = await readFile(filePath, 'utf8');
  const normalizedSource = source.toLowerCase();

  for (const snippet of check.requiredSnippets) {
    if (!normalizedSource.includes(snippet.toLowerCase())) {
      problems.push(`${check.path} is missing expected phrase: ${snippet}`);
    }
  }
}

if (problems.length > 0) {
  console.error('[validate:docs-freshness] docs freshness drift detected:');
  for (const problem of problems) {
    console.error(`- ${problem}`);
  }
  process.exitCode = 1;
} else {
  console.log(`[validate:docs-freshness] ok (${checks.length} freshness checks)`);
}
