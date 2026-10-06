import { configDefaults, defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { DurationSequencer } from './tools/shards.mjs';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** Where the suites that mount a component live. See `projects` below. */
export const DOM_SUITES = '**/packages/client/src/components/**/*.test.ts';

/**
 * TWO SPEEDS, AND THE FILENAME SAYS WHICH.
 *
 * `*.slow.test.ts` is a suite that plays whole games — the ones that assert
 * the SHAPE OF A HEALTHY RUN, which is the only way to catch a house that
 * quietly empties or a scene that never fires. Forty-three of them cost about
 * forty minutes of CPU between them, and there is no cheaper way to get what
 * they check.
 *
 * Everything else asserts a mechanism against a world built by
 * `core/src/testing.ts` and finishes in seconds. That is the loop you want
 * while fixing a bug: `npm run test:fast`. What it costs is stated once, in
 * AGENTS.md's command block, and measured by `npm run cost` — see below. Run
 * the whole suite before you claim anything works; `npm run check` does.
 *
 * ── AND THE NUMBERS ARE NOT IN THIS COMMENT ANY MORE ──────────────────────
 *
 * They were, and they rotted. Twice. "45 files in about 26 seconds" for a lane
 * that had reached 84; a floor named after two files that had not been the
 * floor for months; and then, after a re-measurement that fixed both, a
 * per-file floor of 451s quoted in a build where one shard had reached 67m47s.
 * Each version of this comment told the next reader to treat it as perishable,
 * and each one was believed anyway — because a comment cannot notice that it
 * has stopped being true, and nothing else was looking.
 *
 * So what a file costs is DATA now: `tools/test-durations.json`, written by
 * `npm run cost -- --full --write`. `tools/shards.mjs` packs CI's shards from
 * it and `lanes.test.ts` fails the build when the packing goes lopsided, so a
 * figure that goes stale makes a test fail instead of making an argument
 * wrong. See `sequence.sequencer` below, and issues #143 and #146.
 *
 * What stays in prose here is the part a number cannot carry: which lane a
 * suite belongs in, and why.
 *
 * A new suite that plays a whole game takes the `.slow` suffix. One that does
 * not, does not. `lanes.test.ts` enforces that now, because for months it was
 * only ever asked for: seven suites sat in the fast lane playing millennia and
 * took it to a hundred seconds, and every one of them passed the whole time.
 *
 * IT ENFORCES A SECOND RULE NOW, because the first one is not enough. A suite
 * can drive a batch through somebody ELSE's loop and the text-level net sees
 * nothing: `gates.test.ts` contains no `newGame`, no `advance` and no
 * `runYears`, and cost 61 seconds — 41% of the whole fast lane — because the
 * runs happen inside the gate functions it calls. Driving a batch through a
 * `tools/` module is now something a fast-lane suite has to DECLARE, with what
 * it drives; see `DRIVES_A_BATCH` in `lanes.test.ts`.
 *
 * TWO THINGS ABOUT THE SLOW LANE ARE WORTH KNOWING BEFORE ADDING TO IT.
 * VITEST PARALLELISES PER FILE, so the longest single file is a floor that
 * nothing else can get under — not the other workers, not a shard count, not
 * the sequencer below. `record` held that position at 451s (240 runs of 458
 * years for two assertions) until it was rewritten to read its runs back;
 * `ledger` and `branches` held it before that. All three were fixed the same
 * way and it is the only way: SPLIT THE FILE BY TEST. Never by seed range —
 * these are batch statistics, and taking seeds out of a batch changes what the
 * batch claims. Which file holds the floor today is in the durations table,
 * and `npm run cost` prints it along with what each shard would cost.
 *
 * And the per-file fixed cost is the Zod pass over the content bundle, about
 * 200ms, since `@ed/content` caches the YAML parse — across the fast lane that
 * fixed cost is the majority of the lane's wall clock, not the tests. It is
 * also why an unmeasured file is packed with a floor rather than as free; see
 * `UNMEASURED_MS`.
 */
export const SLOW_SUITES = 'packages/**/*.slow.test.ts';

/**
 * `--exclude` REACHES EVERY PROJECT, BECAUSE VITEST 4 DOES NOT SEND IT THERE.
 *
 * Vitest 4 forwards a fixed list of CLI options into inline `projects`, and
 * `exclude` is not on it (#506). So `test:fast`'s `--exclude` on the slow
 * suites excluded them from the root project — which runs no files — and the
 * "fast" lane quietly played every `*.slow.test.ts` in the repository: past
 * ten minutes on a lane that takes two, with nothing in the output saying the
 * flag had been dropped. `configureVitest` runs once per project after they
 * resolve and before any file is globbed, which is the one point where the
 * CLI's patterns can still be handed down. `lanes.test.ts` asserts this lane
 * excludes what it says it does.
 */
const cliExcludeReachesProjects = {
  name: 'ed:cli-exclude-reaches-projects',
  configureVitest({ vitest, project }: { vitest: { config: { cliExclude?: string[] } }; project: { config: { exclude: string[] } } }) {
    for (const glob of vitest.config.cliExclude ?? []) {
      if (!project.config.exclude.includes(glob)) project.config.exclude.push(glob);
    }
  },
};

export default defineConfig({
  /**
   * THE VUE PLUGIN IS HERE FOR THE CLIENT'S COMPONENT TESTS.
   *
   * `packages/client` is 3,350 lines of Vue and, until now, every guard over
   * it was a text-level one: `verbs.test.ts` greps the templates to prove
   * each session verb reaches something a player can click. That catches an
   * unwired verb and nothing else — whether the click does the right thing
   * has never been asked of a rendered component.
   *
   * Component suites opt into a browser with `@vitest-environment jsdom` in a
   * docblock at the top of the file. Node stays the default, because 122 of
   * the 125 suites do not want a DOM and jsdom costs about 300ms per file to
   * stand up.
   */
  plugins: [vue(), cliExcludeReachesProjects],
  resolve: {
    alias: {
      '@ed/schema': r('./packages/schema/src/index.ts'),
      '@ed/core': r('./packages/core/src/index.ts'),
      '@ed/content': r('./packages/content/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    /**
     * NO WALL-CLOCK LIMIT, WHICH IS WHAT EVERY SUITE HERE WAS WRITTEN AGAINST.
     *
     * Nearly every test and `beforeAll` in this repository is SYNCHRONOUS —
     * it plays years or a batch of runs and then asserts. Vitest 2 never
     * failed one of those for taking long. Vitest 4 does (#506): it times the
     * call and fails it AFTER it has finished if it ran past the limit, so
     * the 5s/10s defaults turned six fast-lane suites red on the day of the
     * upgrade, and would have turned red whichever ones a busy runner slowed
     * down on any day after. A sync test cannot be interrupted, so a limit on
     * one is not a guard against a hang; it is a load-dependent coin. A real
     * hang is still bounded, by the CI job's own timeout.
     */
    testTimeout: 0,
    hookTimeout: 0,
    /**
     * ISOLATION OFF, AND INVARIANT 8 IS WHY IT IS SAFE.
     *
     * Vitest gives each test FILE a fresh module registry by default, so the
     * whole `@ed/core` graph is rebuilt per file. 85 of the test files import
     * the barrel, and the cost showed up as `collect`: 64.5s of an 82.8s fast
     * lane was module construction rather than assertions.
     *
     * The reason that default exists is module-level mutable state — one file
     * mutating a counter another file reads. This repository already forbids
     * exactly that, in invariant 8: "Id sequences live on WorldState.counters,
     * never at module scope — a module-level counter is shared by every
     * simulation in the process." A grep over `packages/core/src` finds none.
     *
     * So the precondition holds by RULE rather than by luck, and the rule is
     * older than this setting. The repository had already paid for the
     * optimisation; it was not collecting it.
     *
     * MEASURED, on a four-core container, `npm run test:fast`:
     *   isolate: true    82.77s   (collect 64.50s)
     *   isolate: false   see AGENTS.md's command block
     *
     * If a suite ever needs a fresh registry, it says so per-file with
     * `// @vitest-environment` or its own describe-level setup, rather than by
     * turning this back on for all 132.
     *
     * Set per project, below, because a top-level `isolate` overrides both.
     */
    /**
     * ── EXCEPT A DOM, WHICH IS MODULE-LEVEL STATE BY CONSTRUCTION ──────────
     *
     * Vue's DOM renderer takes `document` once, when it is first imported. A
     * jsdom suite gets a fresh `document` per FILE, so with the registry shared,
     * the second jsdom file in a worker renders into the FIRST file's document:
     * the elements exist, `html()` shows them, and every class selector over
     * them finds nothing. On main, three suites passed only because they landed
     * on separate workers — run serially, 25 of their tests failed — and adding
     * a fourth (#269) tipped the scheduling.
     *
     * So the suites that mount a component (`DOM_SUITES`) run in the `threads`
     * pool, isolated per file; everything else keeps the shared registry.
     * `lanes.test.ts` fails the build if a suite mounts one anywhere else.
     *
     * Two PROJECTS, because vitest 4 removed `poolMatchGlobs` and
     * `poolOptions` (#506). Left in place they are ignored without a word,
     * and every file — the DOM suites included — lands in one pool on one
     * isolation setting, which is the #269 bug again with nothing to say so.
     * `extends: true` gives both projects the plugin, the aliases and the
     * environment above; the sequencer below stays global, so the shards are
     * still packed over the whole file list rather than per project.
     */
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['packages/**/*.test.ts'],
          exclude: [...configDefaults.exclude, DOM_SUITES],
          pool: 'forks',
          isolate: false,
        },
      },
      {
        extends: true,
        test: { name: 'dom', include: [DOM_SUITES], pool: 'threads', isolate: true },
      },
    ],
    sequence: {
      /**
       * ── THE SHARDS ARE PACKED BY DURATION, NOT BY PATH HASH ─────────────
       *
       * Vitest's own `--shard=i/n` hashes each file's PATH, sorts by the hash
       * and slices into equal COUNTS. That is deterministic and completely
       * duration-blind, and on run 185 it produced a build where `test 2/4`
       * took 67m47s while the other three took 3m02s, 10m45s and 4m03s: one
       * shard held a 68-minute build open while seven jobs sat idle. No test
       * was slow that had not been slow the week before — the hashes simply
       * fell that way, and adding one file anywhere re-rolls them.
       *
       * `tools/shards.mjs` bin-packs by recorded cost instead, off the table
       * `npm run cost -- --write` measures into `tools/test-durations.json`.
       * The whole argument for it, the determinism requirement it must not
       * break, and the one thing sharding cannot fix at all — a single file
       * longer than a shard's fair share — are documented there.
       *
       * `lanes.test.ts` is what keeps it working. It re-packs the real file
       * list and fails the build when the shards come out further apart than
       * a stated factor, because the way this regressed last time was every
       * shard green, the build three times longer, and nothing saying so.
       */
      sequencer: DurationSequencer,
    },
  },
});
