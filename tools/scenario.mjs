import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNpm } from './portable.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const result = runNpm(['exec', '--', 'tsx', '--tsconfig', 'tsconfig.base.json',
  'packages/core/src/fixtures/scenarios.ts', ...process.argv.slice(2)], { cwd: root });
if (!result.ok) process.exitCode = 1;
