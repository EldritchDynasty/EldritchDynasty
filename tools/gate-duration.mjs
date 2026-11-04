#!/usr/bin/env node
/**
 * Gate-lane wall-clock guard (#333).
 *
 * Test-file timing became data in #146; gate timing stayed prose and drifted
 * by 2.5-4x without anything failing. CI calls this after each gate lane with
 * the wall clock it just observed. A stale committed baseline therefore fails
 * the same run that proves it stale.
 *
 * A BASELINE BELONGS TO A RUNNER CLASS, KEYED BY LOGICAL CPUS (#1947).
 * GitHub's standard Linux runner has 4 CPUs for a public repository and 2
 * for a private one, and the gates fan out over workers, so the same commit
 * runs longer on the smaller class. The day the repository went private,
 * batch measured 12.9m against its 9.0m (4-CPU) baseline on code identical
 * to main, and the guard would have refused every pull request for a cause
 * no diff contained. `seconds` is the class named by the file's `cpus`;
 * `byCpus` holds what was measured on any other class. A class with no
 * measurement is reported as NOT JUDGED rather than judged against another
 * class's number: a 4-CPU budget cannot say whether a 2-CPU run regressed.
 */
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..');
export const GATE_DURATIONS_FILE = 'tools/gate-durations.json';

export function readGateDurations() {
  return JSON.parse(readFileSync(join(REPO, GATE_DURATIONS_FILE), 'utf8'));
}

/**
 * The committed seconds for this lane on a host with `cpus` logical CPUs, or
 * undefined when that runner class was never measured. A file with no `cpus`
 * predates runner classes and has one baseline for every host.
 */
export function baselineFor(spec, config, cpus) {
  if (config.cpus === undefined || cpus === config.cpus) return spec.seconds;
  return spec.byCpus?.[String(cpus)]?.seconds;
}

export function checkGateDuration(lane, seconds, config = readGateDurations(), cpus = availableParallelism()) {
  const spec = config.lanes?.[lane];
  if (!spec) {
    throw new Error(`gate-duration: lane "${lane}" has no committed duration in ${GATE_DURATIONS_FILE}`);
  }
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`gate-duration: invalid elapsed seconds "${seconds}"`);
  }

  const baseline = baselineFor(spec, config, cpus);
  if (baseline === undefined) {
    return {
      lane, seconds, cpus, judged: false, ok: true,
      baselineSeconds: null, factor: null, maxFactor: config.maxFactor, limitSeconds: null,
    };
  }
  const limit = baseline * config.maxFactor;
  return {
    lane,
    seconds,
    cpus,
    judged: true,
    baselineSeconds: baseline,
    factor: seconds / baseline,
    maxFactor: config.maxFactor,
    limitSeconds: limit,
    ok: seconds <= limit,
  };
}

/**
 * Describe the actual gates run, not the nominal lane. A 0/0 proof-reuse
 * success is not timing evidence for a full 12-gate batch (#2528).
 *
 * This is diagnostic only: the budget and its 1.25× enforcement remain in
 * checkGateDuration and never depend on this optional report.
 */
export function summarizeGateTimingReport(report, lane) {
  if (report?.version !== 2 || report.lane !== lane || !Array.isArray(report.gates)
    || !Number.isFinite(report.totalSeconds) || report.totalSeconds < 0) {
    throw new Error('gate-duration: malformed or wrong-lane gate timing report');
  }
  const seen = new Set();
  for (const row of report.gates) {
    if (!row || typeof row.gate !== 'string' || !row.gate
      || seen.has(row.gate) || !Number.isFinite(row.seconds) || row.seconds < 0
      || typeof row.ok !== 'boolean') {
      throw new Error('gate-duration: invalid or duplicate per-gate timing');
    }
    seen.add(row.gate);
  }
  const slowest = [...report.gates].sort((a, b) => b.seconds - a.seconds
    || a.gate.localeCompare(b.gate)).slice(0, 3);
  return {
    gateCount: report.gates.length,
    totalSeconds: report.totalSeconds,
    slowest,
    cpuModel: report.host?.cpuModel || 'unknown CPU',
    logicalCpus: report.host?.logicalCpus ?? 'unknown',
  };
}

function human(seconds) {
  return seconds < 90 ? `${seconds.toFixed(0)}s` : `${(seconds / 60).toFixed(1)}m`;
}

function main() {
  const [mode, lane, rawSeconds, ...options] = process.argv.slice(2);
  const timingsFile = options.length === 2 && options[0] === '--timings-json' && options[1]
    ? options[1] : undefined;
  if (mode !== '--check' || !lane || rawSeconds === undefined
    || (options.length > 0 && !timingsFile)) {
    console.error('usage: node tools/gate-duration.mjs --check <lane> <elapsed-seconds> [--timings-json <file>]');
    process.exitCode = 2;
    return;
  }

  // Report a comparable evidence count and the dominant costs even on a
  // failing budget. The optional report must not weaken or veto the guard.
  if (timingsFile) {
    try {
      const summary = summarizeGateTimingReport(JSON.parse(readFileSync(timingsFile, 'utf8')), lane);
      console.log(
        `gate-duration: evidence ${summary.gateCount} executed gates, ${human(summary.totalSeconds)} reported; ` +
        `${summary.cpuModel} × ${summary.logicalCpus} logical CPUs`,
      );
      if (summary.gateCount === 0) {
        console.log('gate-duration: proof-only 0/0 run is NOT a full-batch timing comparison');
      }
      for (const gate of summary.slowest) {
        const share = summary.totalSeconds > 0
          ? ` (${(100 * gate.seconds / summary.totalSeconds).toFixed(1)}% of executed-gate time)` : '';
        console.log(`gate-duration: slow gate ${gate.gate} ${human(gate.seconds)}${share}`);
      }
    } catch (error) {
      console.log(`::warning::gate-duration: cannot read timing diagnostic ${timingsFile}: ${error.message}`);
    }
  }
  const result = checkGateDuration(lane, Number(rawSeconds));
  if (!result.judged) {
    console.log(
      `gate-duration: ${lane} ${human(result.seconds)} on a ${result.cpus}-CPU host — NOT JUDGED: ` +
      `${GATE_DURATIONS_FILE} has no baseline for that runner class.`,
    );
    console.log(
      `::warning::gate-duration: ${lane} has no ${result.cpus}-CPU baseline. Record this run's ` +
      `${result.seconds.toFixed(0)}s, with its run, job and host, under lanes.${lane}.byCpus["${result.cpus}"].`,
    );
    return;
  }
  console.log(
    `gate-duration: ${lane} ${human(result.seconds)}; committed ${human(result.baselineSeconds)}; ` +
    `${result.factor.toFixed(2)}x (limit ${result.maxFactor.toFixed(2)}x / ${human(result.limitSeconds)}) ` +
    `on a ${result.cpus}-CPU host`,
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
