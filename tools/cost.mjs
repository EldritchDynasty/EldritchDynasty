#!/usr/bin/env node
/**
 * WHAT THE COMMANDS COST, MEASURED RATHER THAN REMEMBERED.
 *
 * `codemap.test.ts` already enforces that a command's cost is stated in
 * exactly ONE place, after `npm run test:fast` was documented as "~3s", "~2s",
 * "two seconds" and "about eight seconds" in four files while actually taking
 * a hundred. That rule works and is not what this is for.
 *
 * What it does not do is check whether the surviving copy is TRUE. It was not:
 * AGENTS.md said ~27s against a measured 68.07s, and `npm test` said ~25 min
 * against a measured 18.
 *
 * And the numbers rot without anybody touching them. Measured on one branch in
 * one day:
 *
 *   09:46  npm test  1,748 tests in 126 files   1085.92s
 *   19:00  npm test  1,767 tests in 126 files   1133.23s   ← same branch
 *
 * Nothing about that branch changed between those runs. Four other commits
 * landed on `main` and it rebased. So the figure is invalidated by whoever
 * lands NEXT, not by whoever wrote it, and the agent who has to notice is
 * whichever one rebases afterwards. Corrected by hand three times in one
 * session; all three were stale again before the branch landed.
 *
 * So: measure, and write the measurement down.
 *
 *   npm run cost              # measure test:fast, print what AGENTS.md should say
 *   npm run cost -- --write   # and rewrite the command block to match
 *
 * `check` and `test` are NOT measured by default: they take half an hour, and
 * a tool nobody can afford to run is a tool nobody runs. `--full` includes
 * them, for the once-a-fortnight case where the big numbers have drifted.
 *
 * ── AND IT EMITS THE PER-FILE TABLE, WHICH IS THE POINT NOW ───────────────
 *
 * Issue #146: three files carried timing blocks, all three said "treat a
 * timing comment as perishable, re-measure before quoting", and all three had
 * rotted anyway — `check.yml` by a factor of nearly four, in the direction
 * that hid a 68-minute build. The warning is not the mechanism.
 *
 * So the measurement stops being prose. `--full --write` records what every
 * test FILE cost into `tools/test-durations.json`, and two things read it:
 * the shard packing in `tools/shards.mjs`, and the balance rule in
 * `lanes.test.ts` that fails the build when the shards drift apart. A figure
 * something reads is data, and data that is wrong fails a test — which is
 * this repository's own argument against specifications, applied to its own
 * timing comments.
 *
 *   npm run cost                          # test:fast, print what AGENTS.md should say
 *   npm run cost -- --write               # and rewrite the command block to match
 *   npm run cost -- --full --write        # the whole suite, and the per-file table
 *   npm run cost -- --report <file>       # read a vitest JSON report already on disk
 *                                         # instead of spending another half hour
 *
 * WHAT THE PER-FILE FIGURE IS, EXACTLY: prepare + environment + setup +
 * collect + tests, from `tools/duration-reporter.mjs`.
 *
 * It is NOT vitest's own JSON reporter, and the difference is the whole
 * reason that file exists. That reporter spans first-test-start to
 * last-test-end, so work at MODULE scope is attributed to nothing — it put
 * the suite at 28.3 minutes of a run that took about 62, and reported
 * `arcs.slow.test.ts` at 55 seconds when the batch it collects is 360
 * thousand-year runs. Packing from those numbers would have been confidently
 * wrong in the same shape as the path-hash sharding it replaces.
 */
import { execFileSync } from 'node:child_process';
import { npmInvocation } from './portable.mjs';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { DURATIONS_FILE, packShards, shardCosts } from './shards.mjs';

const REPO = join(import.meta.dirname, '..');
const AGENTS_MD = join(REPO, 'AGENTS.md');
const WRITE = process.argv.includes('--write');
const FULL = process.argv.includes('--full');
/** A vitest JSON report already on disk, so a half-hour run is spent once. */
const REPORT = (() => {
  const i = process.argv.indexOf('--report');
  return i === -1 ? null : process.argv[i + 1];
})();

/** How many shards CI runs, read off the workflow rather than assumed. */
function shardCount() {
  const wf = readFileSync(join(REPO, '.github/workflows/check.yml'), 'utf8');
  return /^\s*shard:\s*\[([^\]]+)\]/m.exec(wf)?.[1].split(',').length ?? 4;
}

/**
 * Per-file cost, keyed by repo-relative POSIX path — the key the packing and
 * the balance rule both use.
 *
 * Reads what `tools/duration-reporter.mjs` writes, which is prepare +
 * environment + setup + collect + tests. NOT vitest's JSON reporter, which
 * spans first-test-start to last-test-end and therefore attributes a
 * module-scope batch to nothing: it put the whole suite at 28.3 minutes of a
 * run that took about 62, and reported `arcs.slow.test.ts` — 360
 * thousand-year runs collected at module scope — at 55 seconds. See that
 * file's header.
 */
function perFile(raw) {
  const out = {};
  for (const [file, parts] of Object.entries(raw.files ?? raw)) {
    const key = relative(REPO, file).split(sep).join('/');
    out[key] = Math.max(0, Math.round(parts.total ?? 0));
  }
  return out;
}

/**
 * Mark the one run whose purpose is to replace stale duration data.
 *
 * `lanes.test.ts` normally fails once too many new suites are absent from the
 * committed table. Without this marker that failure prevents the reporter
 * from publishing the table that would repair it: the prescribed command is
 * then an unfixable loop. Only that stale-table assertion observes the marker;
 * every other test still has to pass before `measureFull` will publish data.
 */
export function costMeasurementEnvironment(environment = process.env) {
  return { ...environment, ED_COST_MEASUREMENT: '1' };
}

export function isCostMeasurement(environment = process.env) {
  return environment.ED_COST_MEASUREMENT === '1';
}

/** Run a command, return seconds and vitest's own file/test counts if present. */
export function measure(script, extra = [], environment = process.env) {
  const started = Date.now();
  let out = '';
  let ok = true;
  try {
    // Through `npmInvocation`, because `npm` on Windows is a `.cmd` shim that
    // cannot be spawned without a shell — and the instrument that measures
    // what the commands cost is no use on a machine it cannot run them on.
    const npm = npmInvocation();
    out = execFileSync(
      npm.command,
      [...npm.prefix, 'run', '--silent', script, ...(extra.length ? ['--', ...extra] : [])],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: environment },
    );
  } catch (e) {
    ok = false;
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  const seconds = (Date.now() - started) / 1000;
  const files = /Test Files\s+(\d+) passed/.exec(out)?.[1];
  const tests = /Tests\s+(\d+) passed/.exec(out)?.[1];
  return { script, seconds, files: files && Number(files), tests: tests && Number(tests), ok };
}

const human = (s) => (s < 90 ? `${s.toFixed(0)}s` : `~${Math.round(s / 60)} min`);

export function rewriteCommandCosts(text, results) {
  const fast = results.find((r) => r.script === 'test:fast' && r.ok);
  const full = results.find((r) => r.script === 'test' && r.ok);

  if (fast) {
    text = text.replace(
      /^(npm run test:fast\s+# )[^\n]*/m,
      `$1${human(fast.seconds)}, the fix-and-rerun loop. Skips the *.slow.test.ts suites;`,
    );
  }
  if (full?.tests && full.seconds !== null) {
    text = text.replace(
      /^(npm test\s+# everything: )[^\n]*/m,
      `$1${full.tests.toLocaleString()} tests in ${full.files} files, ${human(full.seconds)}`,
    );
  }
  return text;
}

/**
 * Run the whole suite once, with the JSON reporter attached, and return both
 * the wall clock AND the per-file table.
 *
 * ONE RUN FEEDS BOTH, which is the whole of #146's second half: a wall-clock
 * figure and a per-file table measured on different days can disagree, and
 * nothing would say which was current. Measured together they cannot.
 */
function measureFull() {
  if (REPORT) {
    // A report already on disk. The wall clock is not this tool's to claim in
    // that case — it did not run the suite — so it says so rather than
    // inventing one, and `--write` then leaves the command block alone.
    const raw = JSON.parse(readFileSync(REPORT, 'utf8'));
    const files = perFile(raw);
    return {
      result: {
        script: 'test',
        seconds: null,
        files: raw.summary?.files ?? Object.keys(files).length,
        tests: raw.summary?.tests ?? null,
        ok: true,
      },
      files,
    };
  }
  const dir = mkdtempSync(join(tmpdir(), 'ed-cost-'));
  const out = join(dir, 'durations.json');
  const reporter = join(REPO, 'tools/duration-reporter.mjs');
  let result = null;
  try {
    // Both reporters: the default one still prints the counts `measure` reads
    // back, and ours writes the per-file table. Asking for the table alone
    // would silently break the figure this tool has always produced.
    result = measure(
      'test',
      ['--reporter=default', `--reporter=${reporter}`, `--outputFile=${out}`],
      costMeasurementEnvironment(),
    );
    // A failing suite may still leave a reporter file behind. That is a
    // PARTIAL measurement, not fresh shard data, so never publish it.
    if (!result.ok) return { result, files: null };

    const raw = JSON.parse(readFileSync(out, 'utf8'));
    // The COUNTS come from the reporter, not from a regex over the default
    // reporter's summary — see that file's `onTestRunEnd`. The regex version
    // stopped matching the moment a second reporter was attached, and left a
    // stale line in AGENTS.md without failing anything.
    if (raw.summary) {
      result.files = raw.summary.files;
      result.tests = raw.summary.tests;
    }
    return { result, files: perFile(raw) };
  } catch {
    console.error('cost: the suite ran but no per-file report came back; table skipped.');
    // Do not rerun the whole suite here. A reporter failure must not turn one
    // expensive measurement into two, and there is no trustworthy table to write.
    return {
      // Even if the suite itself exited zero, the requested measurement did
      // not complete: without the reporter output there is no full result to
      // publish. Fail closed and make the caller retry deliberately.
      result: result
        ? { ...result, ok: false }
        : { script: 'test', seconds: null, files: null, tests: null, ok: false },
      files: null,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * What the committed table says the shards will cost, and how far apart.
 *
 * Printed on every run, measured or not, because the number this reports is
 * the one that was wrong for a month: `check.yml` argued that balancing the
 * shards would buy nothing, off a floor that had halved underneath it.
 */
function reportShards(files) {
  const n = shardCount();
  const costs = shardCosts(Object.keys(files), n, files);
  const packed = packShards(Object.keys(files), n, files);
  const total = Object.values(files).reduce((a, b) => a + b, 0);
  const max = Math.max(...costs);
  const min = Math.min(...costs);
  const longest = Math.max(...Object.values(files));
  const worst = Object.entries(files).sort((a, b) => b[1] - a[1]).slice(0, 5);

  console.log(`\n  packed into ${n} shards (what CI's matrix says):\n`);
  costs.forEach((c, i) => {
    console.log(`    shard ${i + 1}/${n}  ${human(c / 1000).padStart(8)}   ${packed[i].length} files`);
  });
  console.log(`\n    spread    ${(max / min).toFixed(2)}x   longest over shortest`);
  console.log(`    floor     ${human(longest / 1000)}   the single longest FILE — no shard count cuts this`);
  console.log(`    perfect   ${human(total / n / 1000)}   total test time over ${n}`);
  console.log('\n  the five dearest files:');
  for (const [f, ms] of worst) console.log(`    ${human(ms / 1000).padStart(8)}  ${f}`);
  if (longest > total / n) {
    console.log('\n  THE LONGEST FILE IS OVER A SHARD\'S FAIR SHARE. Vitest parallelises per');
    console.log('  FILE, so no packing and no shard count can get below it. AGENTS.md has the');
    console.log('  fix and its one prohibition: split it BY TEST, never by seed range.');
  }
}

function main() {
  const results = [];
  let table = null;

  if (!REPORT) {
    const environment = FULL ? costMeasurementEnvironment() : process.env;
    results.push(measure('test:fast', [], environment));
  }
  if (FULL || REPORT) {
    const full = measureFull();
    results.push(full.result);
    table = full.files;
    if (!REPORT) results.push(measure('typecheck'), measure('validate'));
  }

  console.log(REPORT ? `read from ${REPORT}:\n` : 'measured on this container, just now:\n');
  for (const r of results) {
    const counts = r.tests ? `  ${r.tests} tests in ${r.files} files` : '';
    const clock = !r.ok ? '  FAILED' : r.seconds === null ? '       —' : human(r.seconds).padStart(8);
    console.log(`  npm run ${r.script.padEnd(10)} ${clock}${counts}`);
  }

  const fast = results.find((r) => r.script === 'test:fast' && r.ok);
  const full = results.find((r) => r.script === 'test' && r.ok);

  // The committed table if this run did not measure one — so `npm run cost`
  // with no arguments still reports the shard spread, which costs nothing and
  // is the number that went unwatched.
  const shown = table ?? (() => {
    try {
      return JSON.parse(readFileSync(join(REPO, DURATIONS_FILE), 'utf8')).files;
    } catch {
      return null;
    }
  })();
  if (shown && Object.keys(shown).length) reportShards(shown);

  if (!WRITE) {
    console.log('\n`--write` to put these into AGENTS.md\'s command block'
      + (table ? ` and ${DURATIONS_FILE}.` : '.'));
    if (results.some((r) => !r.ok)) process.exitCode = 1;
    return;
  }

  const original = readFileSync(AGENTS_MD, 'utf8');
  let text = rewriteCommandCosts(original, results);
  const before = original.length;
  if (text.length === before && text === readFileSync(AGENTS_MD, 'utf8')) {
    // `--report` measures no wall clock, so it has nothing to say about the
    // command block and must not claim it rewrote one. A tool that reports
    // work it did not do is the same lie as a figure that is out of date.
    console.log('\nAGENTS.md unchanged — this run measured no wall clock to put in it.');
  } else {
    writeFileSync(AGENTS_MD, text);
    console.log(`\nAGENTS.md rewritten (${before} → ${text.length} bytes).`);
  }

  if (table) {
    const n = shardCount();
    const costs = shardCosts(Object.keys(table), n, table);
    writeFileSync(join(REPO, DURATIONS_FILE), `${JSON.stringify({
      // Everything below is DATA that something reads — see `tools/shards.mjs`
      // and the balance rule in `lanes.test.ts`. Do not hand-edit it; re-run
      // `npm run cost -- --full --write`. A hand-kept number here is the
      // timing comment this file exists to replace, wearing JSON.
      note: 'Generated by `npm run cost -- --full --write`. Per-file cost in ms: '
        + 'prepare + environment + setup + collect + tests, from '
        + 'tools/duration-reporter.mjs — NOT vitest\'s own JSON reporter, which '
        + 'spans first-test-start to last-test-end and so attributes a module-scope '
        + 'batch to nothing. Read by tools/shards.mjs to pack the CI shards, and by '
        + 'packages/core/src/lanes.test.ts to fail the build when they drift apart. '
        + 'Never hand-edited.',
      measured: new Date().toISOString().slice(0, 10),
      shards: n,
      shardCostsMs: costs,
      totalMs: Object.values(table).reduce((a, b) => a + b, 0),
      files: Object.fromEntries(Object.entries(table).sort(([a], [b]) => (a < b ? -1 : 1))),
    }, null, 2)}\n`);
    console.log(`${DURATIONS_FILE} rewritten — ${Object.keys(table).length} files.`);
  }
  console.log('Run `npx vitest run packages/core/src/codemap.test.ts packages/core/src/lanes.test.ts`'
    + ' — they hold the budget and the balance.');

  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith('cost.mjs')) main();
