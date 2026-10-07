import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packShards, shardCosts, UNMEASURED_MS } from '../../../tools/shards.mjs';
import { CAMPAIGN_YEARS } from './campaign.js';

const REPO = join(import.meta.dirname, '../../..');
const costTool = (await import(pathToFileURL(join(REPO, 'tools/cost.mjs')).href)) as {
  costMeasurementEnvironment: (environment?: Record<string, string | undefined>)
    => Record<string, string | undefined>;
  isCostMeasurement: (environment?: Record<string, string | undefined>) => boolean;
};
const { costMeasurementEnvironment, isCostMeasurement } = costTool;

/**
 * WHICH LANE A SUITE IS IN, ENFORCED RATHER THAN ASKED FOR.
 *
 * `vitest.config.ts` has said "a new suite that runs a century takes the
 * `.slow` suffix" since the two lanes were split. Nothing checked it, and
 * SEVEN suites did not: ascension, relationships, table, session-api, assize,
 * session and attention between them turned the fix-and-rerun loop from the
 * documented three seconds into a hundred, with `ascension.test.ts` alone
 * running twenty-four thousand-year games inside it.
 *
 * Nothing about that was visible. Every one of those suites passed, every
 * time; the only symptom was a loop nobody wanted to run, and three documents
 * quoting a number that had been wrong for months.
 *
 * So the rule is a test now. It is deliberately STRUCTURAL rather than a
 * stopwatch: a timing assertion in CI fails on a noisy machine and gets
 * muted, and the thing worth guarding is not a particular second count but
 * the reason for it — a suite that simulates centuries is not a loop.
 *
 * If a suite needs a millennium, it does not need an exemption. It needs the
 * suffix, and it keeps every assertion it had when it moves. Where the line
 * sits, and why it is drawn at whole games rather than at a year count, is on
 * `MILLENNIUM` below.
 */

/** A literal span of years handed to the clock. */
const SPANS = [
  /\badvance\(\s*(\d+)\s*\)/g,
  /\brunYears\(\s*[A-Za-z_$][\w$]*\s*,\s*(\d+)\s*\)/g,
];

/** A run to the end of the world, spelled out as a year subtraction. */
const TO_THE_END = /\badvance\(\s*(?:\d{4}|END_YEAR)\s*-/;

/**
 * A loop that opens whole games. `[^{}]` keeps this inside one block: the
 * first cut of it allowed any 900 characters and matched a loop here against
 * a `newGame` three tests further down, which flagged two suites that cost
 * about a second each.
 */
const BATCH = /for\s*\([^)]*\)\s*\{[^{}]{0,400}\bnewGame\s*\(/g;

/**
 * The campaign term, rather than the old millennium-shaped proxy. What
 * actually cost the lane its ninety seconds was whole GAMES driven by
 * content, and batches of them. That is what this catches.
 *
 * It is a coarse net, not a cost model. A suite that finds a slow way to
 * spend a minute without tripping either rule is still in the wrong lane, and
 * the timing table in `vitest.config.ts` is where that gets noticed.
 */
const LONG_RUN = CAMPAIGN_YEARS;

function testFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(REPO, dir))) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const rel = `${dir}/${entry}`;
    if (statSync(join(REPO, rel)).isDirectory()) testFiles(rel, out);
    else if (entry === 'lanes.test.ts') continue;
    else if (entry.endsWith('.test.ts') && !entry.endsWith('.slow.test.ts')) out.push(rel);
  }
  return out;
}

/**
 * Comments describe the rule; only code pays for it. This file is skipped
 * outright by `testFiles` — a guard that has to spell out the patterns it
 * looks for will always contain them, and its own failure message was the
 * first thing it caught.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\n]*?\/\/[^\n]*$/gm, '');
}

function centuryScale(source: string): string[] {
  const text = stripComments(source);
  const found: string[] = [];

  for (const re of SPANS) {
    for (const m of text.matchAll(re)) {
      const years = Number(m[1]);
      if (years >= LONG_RUN) found.push(`${m[0]} — ${years} years`);
    }
  }
  if (TO_THE_END.test(text)) found.push('advance(term - …) — a run to the end');
  const batches = [...text.matchAll(BATCH)].length;
  if (batches > 0) found.push(`${batches} × newGame inside a loop — a batch of runs`);

  return [...new Set(found)];
}

/**
 * ── THE SECOND WAY INTO THE WRONG LANE: SOMEBODY ELSE'S LOOP ──────────────
 *
 * Everything above reads a suite's own text for a span or a batch. That is
 * the whole net, and `gates.test.ts` walked straight through it: no
 * `newGame`, no `advance`, no `runYears` anywhere in the file — and 61.1
 * seconds, 41% of the entire fast lane, because the runs happen INSIDE the
 * gate functions it calls. The rule was enforced and the lane was still
 * wrong, which is this repository's favourite shape of bug.
 *
 * A stopwatch is still the wrong instrument, for the reason given at the top
 * of this file. So the rule is DECLARATION rather than duration: a fast-lane
 * suite may drive a batch through somebody else's entry point, but it has to
 * say so here, with what it drives. A file that quietly starts playing
 * millennia through a gate fails this until a person writes down the cost —
 * and writing it down is where somebody asks whether it belongs in the loop.
 *
 * WHICH MODULES COUNT IS NOT A LIST ANYBODY MAINTAINS, same as everywhere
 * else in this file: a module under `tools/` (or `harness.ts`) that contains
 * `bootstrap`, `runYears`, `newGame` or `TEST_FAMILIES` exists to drive
 * batches, and importing from one is what gets declared. File-level on
 * purpose — an earlier cut of this resolved individual function names and
 * flagged `gen-docs.ts`, whose local `table()` helper collides with a
 * `table()` in a file that does play. A generic name is not evidence.
 */
const BATCH_SEED = /\b(bootstrap|runYears|newGame|TEST_FAMILIES)\b/;

/**
 * The fast-lane suites allowed to drive a batch through a tools module, and
 * what each of them actually drives. Costs measured 2026-09-06 on a four-core
 * container, alongside the rest of the suite.
 *
 * `gates.test.ts` is the reason this exists and is also the answer to it: a
 * gate nobody has watched refuse is indistinguishable from a gate that cannot
 * refuse, so proving each one still has teeth means running it — at two seeds
 * and five years, which is far too small to mean anything about the game and
 * exactly the right size to mean something about the gate.
 */
const DRIVES_A_BATCH: Record<string, string> = {
  'packages/core/src/events/reach.test.ts':
    'the six shared TEST_FAMILIES are hand-built witness worlds; plays no years — 13.3s hosted',
  'packages/core/src/ascension.test.ts':
    'one hand-built test family to check the Unmaking cast; plays no years',
  'packages/core/src/gates.test.ts':
    'every gate, at 2 runs x 5 years, to prove each still refuses what it must — 16s '
    + '(was 61s: gate 2 rebuilt six worlds per event, and gate 9 replayed one batch per set of floors)',
  'packages/core/src/fecundity-drag.test.ts':
    'drag-gate structural helpers only: founder phasing and bundle calibration; no campaign batch — 1.4s hosted',
  'packages/core/src/blood.test.ts':
    'the blood gate\'s founder recipe, one built house, no played years — 1.9s',
  'packages/core/src/bearing-gate.test.ts':
    'the bearing verdict over hand-built columns; plays nothing — 0.0s',
  'packages/core/src/ending-gate.test.ts':
    'the ending verdict over hand-built runs; plays nothing — 0.0s',
  'packages/core/src/short-line-gate.test.ts':
    'the Short-Line verdict over hand-built runs; imports the ending runner but plays nothing — 0.0s',
  'packages/core/src/bottleneck-gate.test.ts':
    'the founding bottleneck verdict over hand-built runs; plays nothing — 0.0s',
  'packages/core/src/war-gate.test.ts':
    'the war verdict over hand-built runs; plays nothing — 0.0s',
  'packages/core/src/tools/replay-divergence.test.ts':
    'the run-two comparator and report rows over hand-built decision streams; plays nothing — 0.0s',
  'packages/core/src/tools/stall.test.ts':
    'one 3-year density run proving table-order failure wiring; the rest is hand-built — 0.2s',
};

function batchDrivingModules(): Set<string> {
  const out = new Set<string>();
  const dirs = ['packages/core/src/tools'];
  const extra = ['packages/core/src/harness.ts'];
  const candidates = [
    ...dirs.flatMap((d) => readdirSync(join(REPO, d))
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => `${d}/${f}`)),
    ...extra,
  ];
  for (const rel of candidates) {
    if (BATCH_SEED.test(readFileSync(join(REPO, rel), 'utf8'))) {
      out.add(rel.slice(rel.lastIndexOf('/') + 1).replace(/\.ts$/, ''));
    }
  }
  return out;
}

/** The tools modules a suite imports from, by stem. */
function importsOfBatchDrivers(source: string, drivers: Set<string>): string[] {
  const text = stripComments(source);
  const found = new Set<string>();
  for (const m of text.matchAll(/from\s*'([^']+)'/g)) {
    const spec = m[1]!;
    const stem = spec.slice(spec.lastIndexOf('/') + 1).replace(/\.js$/, '');
    if (drivers.has(stem)) found.add(stem);
  }
  return [...found];
}

describe('the two lanes', () => {
  const files = testFiles('packages');

  it('finds the fast lane at all', () => {
    // A scan that silently walks nothing passes every assertion below it.
    expect(files.length).toBeGreaterThan(30);
    expect(files).toContain('packages/core/src/session-api.test.ts');
  });

  for (const file of files) {
    it(`${file} does not play whole games`, () => {
      const reasons = centuryScale(readFileSync(join(REPO, file), 'utf8'));
      expect(
        reasons,
        `${file} plays whole games in the fast lane. Move those tests to a ` +
        `'.slow.test.ts' sibling — they keep every assertion when they go:\n` +
        reasons.map((r) => `  ${r}`).join('\n'),
      ).toEqual([]);
    });
  }

  describe('and the batches driven through somebody else\'s loop', () => {
    const drivers = batchDrivingModules();

    it('finds the batch-driving modules at all', () => {
      // A scan that matches nothing declares every suite innocent.
      expect(drivers.has('gates')).toBe(true);
      expect(drivers.has('harness')).toBe(true);
      // And does not sweep in a tools module that drives nothing.
      expect(drivers.has('gen-docs')).toBe(false);
      expect(drivers.has('prose-lint')).toBe(false);
    });

    for (const file of files) {
      it(`${file} declares any batch it drives`, () => {
        const driven = importsOfBatchDrivers(readFileSync(join(REPO, file), 'utf8'), drivers);
        if (!driven.length) {
          expect(
            DRIVES_A_BATCH[file],
            `${file} declares that it drives a batch and no longer does. Drop its `
            + 'entry from DRIVES_A_BATCH — a declaration nobody has to earn is a '
            + 'permission slip.',
          ).toBeUndefined();
          return;
        }
        expect(
          DRIVES_A_BATCH[file],
          `${file} drives a batch through ${driven.join(', ')} — those modules play `
          + 'whole games on its behalf, and nothing above this can see it.\n'
          + 'If it belongs in the fast lane, say what it drives and what that costs '
          + 'in DRIVES_A_BATCH. If it does not, it takes the .slow suffix.',
        ).toBeTypeOf('string');
      });
    }
  });
});

/**
 * ── AND WHICH SHARD A SUITE IS IN ─────────────────────────────────────────
 *
 * Everything above is about the two LANES — fast and slow, decided by a
 * filename. This is the other half of the same failure, one level down.
 *
 * Run 185 (`main`, green, 4601428): `test 2/4` took 67m47s while the other
 * three shards took 3m02s, 10m45s and 4m03s. Every job in that build started
 * within three seconds of every other, so nothing was queuing — one shard held
 * a 68-minute build open while seven jobs sat finished and idle. Total test
 * work was 85m37s; balanced, that is about 21 minutes a shard, and the build
 * floor becomes the `batch` gate lane. Forty-six minutes a build, and no test
 * deleted.
 *
 * NOTHING REPORTED IT, and that is the part this file is for. Vitest shards by
 * a hash of the file PATH, so which suites a shard draws is re-rolled every
 * time a test file is added anywhere in the repository. Every shard was green.
 * `check.yml` carried a paragraph arguing that balancing them would buy
 * nothing, which had been true at run 125 and was three times out by run 185.
 * A timing comment cannot notice that it has stopped being true.
 *
 * So the packing is data now (`tools/test-durations.json`, written by
 * `npm run cost -- --full --write`), the sequencer reads it
 * (`tools/shards.mjs`), and this is the rule that fails when it drifts. The
 * same argument as `DRIVES_A_BATCH` above: not a stopwatch, which would fail
 * on a noisy runner and be muted within a fortnight, but a claim about
 * COMMITTED DATA, which is free to check and cannot be noisy.
 */
const DURATIONS = join(REPO, 'tools/test-durations.json');

/**
 * HOW FAR APART THE SHARDS MAY COME OUT — longest over shortest.
 *
 * DERIVED, not picked. Greedy longest-processing-time packing is guaranteed
 * to land within 4/3 of optimal, and optimal is dead level — every shard at
 * total/n — whenever no single FILE costs more than a shard's fair share.
 * 1.5 is that 1.33 with a little room for the fact that the durations are a
 * measurement and not a constant.
 *
 * So this number is not really a tolerance for bad packing. It is a detector
 * for THE ONE THING PACKING CANNOT FIX: vitest parallelises per file, so a
 * file bigger than total/n is a floor no packing and no shard count gets
 * under, and it is the only way a spread above 4/3 can happen. When this
 * fails, the fix is never to raise it — it is in AGENTS.md, with its one
 * prohibition: split the file BY TEST, never by seed range.
 *
 * MEASURED 2026-09-20, after #143: spread 1.00x, four shards of about eleven
 * minutes, the longest file (`arcs.slow.test.ts`, 10.6 min) just inside a
 * shard's fair share of 10.9. Before it: 4.12x, one shard of sixty minutes
 * holding a 68-minute build open while three finished in fifteen and idled.
 * A file would have to reach about 22 minutes to trip this — roughly twice
 * the largest one there is, which is the margin and not an accident.
 */
const IMBALANCE = 1.5;

/**
 * How many files may have no recorded duration before the claim above stops
 * meaning anything.
 *
 * Eight, and the arithmetic is the derivation: an unmeasured file is packed
 * at `UNMEASURED_MS` (6s), and eight of those mis-weighted against a shard of
 * about eleven minutes is well under one per cent — invisible to the balance
 * either way. It is also about as many test files as land between two
 * measurements in practice, so adding a suite does not force a fifteen-minute
 * re-measure before the build will go green.
 *
 * Past that, the packing is guessing about enough of the suite that the
 * spread is no longer evidence, and the rule says so instead of passing.
 */
const UNMEASURED_BUDGET = 8;

type Durations = {
  measured: string;
  shards: number;
  files: Record<string, number>;
};

/** Every file vitest would run — both lanes, the same glob as the config. */
function everyTestFile(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(REPO, dir))) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const rel = `${dir}/${entry}`;
    if (statSync(join(REPO, rel)).isDirectory()) everyTestFile(rel, out);
    else if (entry.endsWith('.test.ts')) out.push(rel);
  }
  return out;
}

/** How many shards CI runs, read off the matrix rather than assumed here. */
function shardCount(): number {
  const workflow = readFileSync(join(REPO, '.github/workflows/check.yml'), 'utf8');
  const matrix = /^\s*shard:\s*\[([^\]]+)\]/m.exec(workflow);
  expect(matrix, 'check.yml no longer declares a shard matrix this rule can read').toBeTruthy();
  return matrix![1]!.split(',').length;
}

describe('native merge queue admission', () => {
  const workflow = readFileSync(join(REPO, '.github/workflows/auto-merge-queue.yml'), 'utf8');

  it('uses the queue-specific App permission and native GraphQL mutation', () => {
    expect(workflow).toContain('permission-merge-queues: write');
    expect(workflow).toContain('permission-pull-requests: write');
    expect(workflow).toContain('permission-contents: write');
    expect(workflow).toContain('enqueuePullRequest');
    expect(workflow).toContain('expectedHeadOid');
    expect(workflow).not.toContain('/merge-async');
  });

  it('trusts a successful completed check workflow instead of racing check-runs indexing', () => {
    expect(workflow).toContain('if [[ "$GITHUB_EVENT_NAME" == "workflow_run" ]]');
    expect(workflow).toContain('required="success"');
    expect(workflow).toContain('the workflow_run event can arrive seconds before that check is');
  });

  it('recovers an empty workflow_run PR association only from the exact same-repo head (#560)', () => {
    expect(workflow).toContain("run_branch=\"$(jq -r '.workflow_run.head_branch // empty'");
    expect(workflow).toContain("run_head=\"$(jq -r '.workflow_run.head_sha // empty'");
    expect(workflow).toContain('gh api --method GET "/repos/$GITHUB_REPOSITORY/pulls"');
    expect(workflow).toContain('-f state=open');
    expect(workflow).toContain('-f base=main');
    expect(workflow).toContain('-f head="$repo_owner:$run_branch"');
    expect(workflow).toContain('.base.ref == "main"');
    expect(workflow).toContain('.head.repo.full_name == $repo');
    expect(workflow).toContain('.head.ref == $branch');
    expect(workflow).toContain('.head.sha == $head');
    expect(workflow).toContain('if length == 1 then .[0].number else empty end');
    expect(workflow).toContain('expected_head="$run_head"');
  });

  it('judges a pull_request by its newest finished CI required run, never a stale one (#493)', () => {
    // sort_by(.completed_at) ranked a still-running check (null) first, so a
    // draft-tier success outranked the full run marking the PR ready started.
    expect(workflow).not.toContain('sort_by(.completed_at)');
    expect(workflow).toContain('sort_by(.id) | last');
    expect(workflow).toContain('elif .status == "completed" then (.conclusion // "") else "pending" end');
  });

  it('waits out "CI required is expected" instead of failing or giving up silently (#493)', () => {
    expect(workflow).toContain('Required status check .*CI required.* is expected');
    // On a pull_request event the workflow_run handoff admits the PR later...
    expect(workflow).toContain('if [[ "$GITHUB_EVENT_NAME" != "workflow_run" ]]; then');
    // ...after that handoff the retry is bounded, keeps the same head, and
    // every other refusal still fails closed.
    expect(workflow).toContain('for delay in 5 10 20; do');
    expect(workflow).toContain('-F expectedHeadOid="$HEAD_SHA"');
    expect(workflow).toContain('echo "::error::GitHub GraphQL merge-queue request failed for PR #$PR_NUMBER:"');
  });
});

describe('the shards are packed by duration', () => {
  const durations: Durations = JSON.parse(readFileSync(DURATIONS, 'utf8'));
  const files = everyTestFile('packages');
  const shards = shardCount();

  it('reads a duration table that describes this repository', () => {
    // A table that has fallen out of step with the tree makes every claim
    // below vacuous — the packing would be over files that no longer exist
    // and the balance a fact about history. Same shape as the two scans
    // above, which assert they matched something before judging anything.
    expect(files.length).toBeGreaterThan(100);
    expect(Object.keys(durations.files).length).toBeGreaterThan(100);
    expect(durations.shards).toBe(shards);
  });

  /**
   * THE PARTITION, WHICH IS A CORRECTNESS CLAIM AND NOT A PERFORMANCE ONE.
   *
   * A packing that dropped a file would run it in NO shard, and a suite that
   * runs nowhere passes. That is the failure this repository has over and over
   * (`docs/FAILURES.md` is the catalogue), and it would arrive here wearing a
   * speed-up — the build green, faster, and missing a suite.
   */
  it('puts every file in exactly one shard', () => {
    const packed = packShards(files, shards, durations.files).flat();
    expect(packed.length).toBe(files.length);
    expect([...packed].sort()).toEqual([...files].sort());
  });

  /**
   * AND EVERY RUNNER HAS TO REACH THE SAME PACKING.
   *
   * Four runners each compute this independently; they are never compared.
   * Two that disagreed would run some files twice and others never, and
   * nothing anywhere would report it. So the packing may not depend on the
   * order the filesystem happened to hand the files over in.
   */
  it('packs the same way whatever order the files arrive in', () => {
    const forward = packShards(files, shards, durations.files);
    const backward = packShards([...files].reverse(), shards, durations.files);
    expect(backward).toEqual(forward);
  });

  it('gives an unmeasured file a cost rather than assuming it is free', () => {
    // Assume zero and every new suite piles into shard 1 — this bug again,
    // arriving by a different door. The floor is stated in `shards.mjs`.
    const packed = packShards(['a.test.ts', 'b.test.ts'], 2, {});
    expect(packed).toEqual([['a.test.ts'], ['b.test.ts']]);
    expect(UNMEASURED_MS).toBeGreaterThan(1000);
  });

  it('lets only a cost measurement pass the stale-table bootstrap', () => {
    const environment = costMeasurementEnvironment({ EXISTING_VALUE: 'kept' });
    expect(environment.EXISTING_VALUE).toBe('kept');
    expect(isCostMeasurement(environment)).toBe(true);
    expect(isCostMeasurement({ ED_COST_MEASUREMENT: '0' })).toBe(false);
    expect(isCostMeasurement({})).toBe(false);
  });

  /**
   * ── THE RULE THIS FILE WAS EXTENDED FOR ───────────────────────────────
   *
   * Free to check, because it is a claim about committed data rather than a
   * stopwatch — which matters, since a timing assertion in CI fails on a
   * noisy runner and is muted within a fortnight. That argument is at the
   * top of this file and it applies here unchanged.
   */
  it('packs the shards within a stated factor of each other', () => {
    const costs = shardCosts(files, shards, durations.files);
    const max = Math.max(...costs);
    const min = Math.min(...costs);
    const longest = Math.max(...Object.values(durations.files));
    const fair = Object.values(durations.files).reduce((a, b) => a + b, 0) / shards;
    const minutes = (ms: number) => `${(ms / 60000).toFixed(1)}m`;

    expect(
      max / min,
      `the shards pack ${(max / min).toFixed(2)}x apart — ` +
      `${costs.map(minutes).join(', ')} — against a limit of ${IMBALANCE}x.\n\n` +
      (longest > fair
        ? `The cause is one FILE, not the packing: the longest is ${minutes(longest)} ` +
          `against a shard's fair share of ${minutes(fair)}, and vitest parallelises\n` +
          `per file, so no packing and no shard count gets under it. Split it BY TEST ` +
          `— never by seed range, these are batch statistics and taking\nseeds out of ` +
          `a batch changes what it claims. Raising the limit here buys a slower build ` +
          `and hides the next one.`
        : `No single file is over a shard's fair share (${minutes(fair)}), so this is ` +
          `the durations table being stale rather than a file being too big:\n` +
          `  npm run cost -- --full --write`),
    ).toBeLessThanOrEqual(IMBALANCE);
  });

  it('has a duration for almost every file it packs', () => {
    // This is the one assertion the prescribed repair command may suppress.
    // Every other suite still runs, and `cost.mjs` refuses to publish the
    // reporter output if any of them fails.
    if (isCostMeasurement()) return;
    // The balance claim below rests on the table describing the tree. A few
    // new files are normal and are absorbed by the floor; a table that has
    // stopped covering the suite makes the claim meaningless, and a rule that
    // quietly stops meaning anything is the thing this file exists about.
    const unmeasured = files.filter((f) => durations.files[f] === undefined);
    expect(
      unmeasured.length,
      `${unmeasured.length} of ${files.length} test files have no recorded duration, so the\n` +
      `shard balance below is a guess about them. Re-measure:\n` +
      `  npm run cost -- --full --write\n` +
      unmeasured.map((f) => `  ${f}`).join('\n'),
    ).toBeLessThanOrEqual(UNMEASURED_BUDGET);
  });
});

/**
 * A SUITE THAT MOUNTS A COMPONENT RUNS ISOLATED (#269).
 *
 * Vue's renderer keeps the `document` it was first imported under, and the
 * shared registry this config runs with hands it to the next jsdom file in the
 * worker, whose elements then land in a document its selectors do not search.
 * `vitest.config.ts` sends the mounting suites to an isolating project by GLOB;
 * a suite that mounts outside that glob would pass alone and fail the day the
 * scheduler put it behind another one.
 */
describe('a suite that mounts a component', () => {
  const config = readFileSync(join(REPO, 'vitest.config.ts'), 'utf8');
  // Spelled in two halves so this file does not read as a suite that mounts.
  const MOUNTS = "from '@vue/" + "test-utils'";
  const glob = /export const DOM_SUITES = '\*\*\/([^*']+)\*\*\/\*\.test\.ts';/.exec(config)?.[1];

  it('names where the mounting suites live, and isolates that pool', () => {
    expect(glob, 'DOM_SUITES is no longer a `**/<dir>/**/*.test.ts` glob this test can read').toBeDefined();
    // Vitest 4 dropped `poolMatchGlobs`/`poolOptions` and ignores them
    // silently (#506), so the split is two projects: the DOM suites in an
    // isolating `threads` project, and excluded from the shared-registry one.
    expect(config).toContain("include: [DOM_SUITES], pool: 'threads', isolate: true");
    expect(config).toContain('exclude: [...configDefaults.exclude, DOM_SUITES]');
    expect(config).not.toMatch(/^\s*(poolMatchGlobs|poolOptions):/m);
  });

  it('lives inside that glob', () => {
    const mounting: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist') continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name.endsWith('.test.ts') && readFileSync(path, 'utf8').includes(MOUNTS)) {
          mounting.push(path.slice(REPO.length + 1).replace(/\\/g, '/'));
        }
      }
    };
    walk(join(REPO, 'packages'));

    expect(mounting.length, 'found no suite that mounts a component — has the walker gone blind?').toBeGreaterThan(0);
    const outside = mounting.filter((f) => !f.startsWith(glob!));
    expect(outside, `these mount a component outside ${glob}, where the registry is shared`).toEqual([]);
  });
});

/**
 * THE FAST LANE EXCLUDES WHAT IT SAYS IT DOES — ASKED OF VITEST, NOT GREPPED.
 *
 * Vitest 4 stopped passing `--exclude` down into `projects` (#506), and the
 * fast lane went on running every `*.slow.test.ts` with no error and a green
 * result at the end of it. Every text-level check above would still have
 * passed: the script said the right thing, and vitest ignored it. So this asks
 * vitest which files `test:fast` would collect, using the script's own glob,
 * and which project each lands in.
 */
describe('the fast lane, as vitest resolves it', () => {
  const script = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).scripts['test:fast'] as string;
  const exclude = /--exclude "([^"]+)"/.exec(script)?.[1];
  const listed = (args: string[]): { file: string; projectName: string }[] => {
    const run = spawnSync(
      process.execPath,
      [join(REPO, 'node_modules/vitest/vitest.mjs'), 'list', '--filesOnly', '--json', ...args],
      { cwd: REPO, encoding: 'utf8' },
    );
    expect(run.status, run.stderr).toBe(0);
    return JSON.parse(run.stdout);
  };

  it('collects no slow suite, and the DOM suites only in the isolating project', () => {
    expect(exclude, '`test:fast` no longer carries an `--exclude "<glob>"` this test can read').toBeDefined();
    const files = listed(['--exclude', exclude!]).map((f) => ({
      path: f.file.replace(/\\/g, '/'),
      project: f.projectName,
    }));
    expect(files.length, 'vitest listed no files at all').toBeGreaterThan(0);
    expect(files.filter((f) => f.path.endsWith('.slow.test.ts')).map((f) => f.path)).toEqual([]);
    const dom = files.filter((f) => f.path.includes('/packages/client/src/components/'));
    expect(dom.length, 'no DOM suite was listed — has DOM_SUITES moved?').toBeGreaterThan(0);
    expect(files.filter((f) => (f.project === 'dom') !== dom.includes(f)).map((f) => f.path)).toEqual([]);
  });
});
