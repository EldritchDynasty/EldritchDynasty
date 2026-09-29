#!/usr/bin/env node
/**
 * Gate-lane wall-clock guard (#333).
 *
 * Test-file timing became data in #146; gate timing stayed prose and drifted
 * by 2.5-4x without anything failing. CI calls this after each gate lane with
 * the wall clock it just observed. A stale committed baseline therefore fails
 * the same run that proves it stale.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..');
export const GATE_DURATIONS_FILE = 'tools/gate-durations.json';

export function readGateDurations() {
  return JSON.parse(readFileSync(join(REPO, GATE_DURATIONS_FILE), 'utf8'));
}

export function checkGateDuration(lane, seconds, config = readGateDurations()) {
  const spec = config.lanes?.[lane];
  if (!spec) {
    throw new Error(`gate-duration: lane "${lane}" has no committed duration in ${GATE_DURATIONS_FILE}`);
  }
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`gate-duration: invalid elapsed seconds "${seconds}"`);
  }

  const limit = spec.seconds * config.maxFactor;
  return {
    lane,
    seconds,
    baselineSeconds: spec.seconds,
    factor: seconds / spec.seconds,
    maxFactor: config.maxFactor,
    limitSeconds: limit,
    ok: seconds <= limit,
  };
}

function human(seconds) {
  return seconds < 90 ? `${seconds.toFixed(0)}s` : `${(seconds / 60).toFixed(1)}m`;
}

function main() {
  const [mode, lane, rawSeconds] = process.argv.slice(2);
  if (mode !== '--check' || !lane || rawSeconds === undefined) {
    console.error('usage: node tools/gate-duration.mjs --check <lane> <elapsed-seconds>');
    process.exitCode = 2;
    return;
  }

  const result = checkGateDuration(lane, Number(rawSeconds));
  console.log(
    `gate-duration: ${lane} ${human(result.seconds)}; committed ${human(result.baselineSeconds)}; ` +
    `${result.factor.toFixed(2)}x (limit ${result.maxFactor.toFixed(2)}x / ${human(result.limitSeconds)})`,
  );

  if (!result.ok) {
    console.error(
      `gate-duration: ${lane} exceeded its committed timing by more than ${result.maxFactor.toFixed(2)}x.\n` +
      'Measure the lane, attribute the growth, then update tools/gate-durations.json deliberately.',
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && process.argv[1].endsWith('gate-duration.mjs')) main();
