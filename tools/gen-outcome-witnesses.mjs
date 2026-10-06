import { runNpm } from './portable.mjs';

process.env.UPDATE_OUTCOME_WITNESSES = '1';
const result = runNpm(
  ['test', '--', 'packages/core/src/events/reach.test.ts'],
  { cwd: process.cwd() },
);
if (!result.ok) {
  process.exitCode = 1;
}
