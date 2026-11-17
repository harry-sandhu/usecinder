import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function resolveTypeScriptCli() {
  try {
    return require.resolve('typescript/bin/tsc');
  } catch (error) {
    throw new Error(
      'Could not resolve typescript/bin/tsc from apps/web. Ensure TypeScript is installed for the web workspace build environment.',
    );
  }
}

function runTsc(tsconfigPath) {
  const tscCliPath = resolveTypeScriptCli();
  execFileSync(process.execPath, [tscCliPath, '-p', tsconfigPath], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
}

function main() {
  runTsc(path.join(repoRoot, 'packages/shared/tsconfig.json'));
  runTsc(path.join(repoRoot, 'packages/cinder/tsconfig.json'));
}

main();
