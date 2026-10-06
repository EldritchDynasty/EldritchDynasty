/**
 * WHAT A TEST FILE COSTS — ALL OF IT, NOT JUST THE PART INSIDE `it()`.
 *
 * ── WHY THE OBVIOUS INSTRUMENT IS THE WRONG ONE ───────────────────────────
 *
 * Vitest's own JSON reporter gives each file the span from its first test
 * STARTING to its last one ENDING. Measured against this repository that is
 * not the cost of the file, and the gap is not small:
 *
 *   the whole suite, by the JSON reporter   28.3 min of test time
 *   the same run, by the clock              ~62 min on four cores
 *
 * Roughly half the work is outside every test body. `arcs.slow.test.ts` is
 * the clearest case: it collects `const BATCH = runBatch(COVERAGE_SEEDS)` at
 * MODULE SCOPE — 360 thousand-year runs, deliberately, so that four
 * assertions share one batch instead of playing it four times. The JSON
 * reporter attributes every second of that to nothing at all and reports the
 * file at 55 seconds.
 *
 * A packing built on those numbers would put the batch files together and be
 * confidently wrong, which is the same shape as the path-hash sharding it
 * replaces — a number that looks like a duration and is a fact about
 * something else. So this reporter records the four spans vitest actually
 * tracks per file and adds them:
 *
 *   prepare      standing the worker up
 *   environment  jsdom, where a suite asks for one
 *   collect      importing the module — where a module-scope batch lives
 *   tests        the test bodies
 *
 * `tools/cost.mjs` attaches this, `tools/shards.mjs` packs from what it
 * writes, and `lanes.test.ts` fails the build when the packing drifts.
 */
import { writeFileSync } from 'node:fs';

export default class DurationReporter {
  onInit(ctx) {
    this.ctx = ctx;
    // Where to write, taken from the reporter's own output file so that
    // nothing here has to agree with a path spelled out somewhere else.
    this.out = ctx.config.outputFile?.['duration-reporter']
      ?? ctx.config.outputFile
      ?? 'test-durations.raw.json';
    if (typeof this.out !== 'string') this.out = 'test-durations.raw.json';
  }

  /**
   * IT COUNTS THE TESTS TOO, AND THAT IS NOT A CONVENIENCE.
   *
   * `cost.mjs` used to read "Tests N passed" back out of the DEFAULT
   * reporter's summary with a regular expression. Attaching this reporter
   * beside it took `--outputFile`, the default reporter stopped printing what
   * that regex wanted, and AGENTS.md's `npm test` line silently kept saying
   * "1,961 tests in 132 files, ~30 min" against a measured 2,528 in 157 and
   * about fourteen minutes.
   *
   * Which is this whole epic in miniature: a tool for keeping a number true,
   * quietly failing to write it, with the stale number left in place and
   * nothing saying so. A reporter already holds the tasks — so it counts them
   * here, and nothing has to parse anybody's prose.
   */
  onTestRunEnd(testModules = []) {
    // Vitest 4 removed `onFinished` and its raw file tasks (#506). A reporter
    // still declaring only that hook is never called, writes nothing, and
    // `cost.mjs` reads the stale table back as if it were this run's.
    const rows = {};
    let tests = 0;
    for (const m of testModules) {
      if (!m.moduleId) continue;
      tests += [...m.children.allTests()].length;
      const d = m.diagnostic();
      const parts = {
        prepare: d.prepareDuration ?? 0,
        environment: d.environmentSetupDuration ?? 0,
        setup: d.setupDuration ?? 0,
        collect: d.collectDuration ?? 0,
        tests: d.duration ?? 0,
      };
      rows[m.moduleId] = {
        ...parts,
        total: Math.round(Object.values(parts).reduce((a, b) => a + b, 0)),
      };
    }
    writeFileSync(this.out, `${JSON.stringify({
      summary: { files: Object.keys(rows).length, tests },
      files: rows,
    }, null, 2)}\n`);
  }
}
