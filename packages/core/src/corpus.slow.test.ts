import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { saveGame } from '@ed/core';
import { corpusStats, playedFresh, playedRun, simulationKey } from './corpus.js';

const REPO = join(import.meta.dirname, '../../..');

const bundle = loadContent();

/**
 * ── IS A REMEMBERED RUN THE SAME RUN? ─────────────────────────────────────
 *
 * `corpus.ts` reads a played millennium back through `saveGame`/`loadGame`
 * instead of replaying it, which is only sound if the world that comes back
 * is the world that went in. Nothing else in the repository asks that
 * question of a whole played run: `save.test.ts` round-trips a world built
 * for the purpose, and `digest` is computed FROM `saveGame`'s output, so by
 * construction it cannot see a field the format never knew about.
 *
 * THAT LAST GAP IS THE ONE THIS FILE IS REALLY FOR, and CLAUDE.md names it:
 * add a field to `WorldState` and `createWorld`, forget `SavedGameS` and
 * `saveGame`, and the field is not in the format, so it is not in the digest,
 * so every round-trip test still passes while the field silently resets on
 * load — "which looks exactly like a subsystem that stopped working two
 * centuries in".
 *
 * So the comparison here is between two WORLDS, field by field, not between
 * two saves. A field that never reaches the format shows up as a difference
 * between the world that was played and the world that was remembered,
 * because only one of them ever had it.
 *
 * The speed work paying a correctness dividend is the point: the corpus is
 * only worth having if this passes, and this passing is worth having whether
 * or not anybody wanted the corpus.
 */

/**
 * A value with every object key in sorted order, Maps and Sets flattened, and
 * class instances reduced to their name.
 *
 * Key ORDER is the one thing that legitimately differs. `JSON.stringify`
 * preserves insertion order, a live object gets its keys in the order the run
 * assigned them, and `loadGame` rebuilds them in schema order — so a played
 * branch serialises `…grievance, extinct, recalled` and a remembered one
 * `…grievance, recalled, extinct`, with identical values. Comparing raw JSON
 * reports all 541 people as different; comparing this reports nothing,
 * because nothing is.
 */
function canonical(v: unknown, depth = 0): unknown {
  if (depth > 8) return '…';
  if (v instanceof Map) {
    return ['Map', [...v.entries()]
      .map(([k, x]) => [String(k), canonical(x, depth + 1)] as const)
      .sort((a, b) => a[0].localeCompare(b[0]))];
  }
  if (v instanceof Set) return ['Set', [...v].map(String).sort()];
  if (Array.isArray(v)) return v.map((x) => canonical(x, depth + 1));
  if (v && typeof v === 'object') {
    // `PersonStore` and friends are behaviour, not data; their contents are
    // compared through `saveGame` below.
    if (v.constructor && v.constructor.name !== 'Object') return `[${v.constructor.name}]`;
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, canonical(o[k], depth + 1)]));
  }
  return v;
}

const SEED = 100;
const YEARS = 458;

describe('a remembered run is the run that was played', () => {
  /**
   * Warm it first, then read it back, then play the same seed for real. The
   * order matters: a corpus that never hit would make every assertion below
   * compare a fresh run against another fresh run and pass while proving
   * nothing.
   */
  const before = corpusStats();
  // The first call may play or may hit; the second must hit either way.
  playedRun(bundle, SEED, YEARS);
  const readBack = playedRun(bundle, SEED, YEARS);
  const played = playedFresh(bundle, SEED, YEARS);
  const after = corpusStats();

  it('and the corpus was actually consulted', () => {
    expect(
      after.hits - before.hits,
      'the corpus never hit, so everything below compares two fresh runs and proves nothing',
    ).toBeGreaterThan(0);
    expect(readBack.world.year).toBe(1042 + YEARS);
  });

  /**
   * EVERY FIELD ON THE WORLD, not every field the save format knows about.
   * This is the guard `digest` structurally cannot be.
   */
  it('every field on the world survives the round trip', () => {
    const differing: string[] = [];
    for (const key of Object.keys(played.world).sort()) {
      const a = JSON.stringify(canonical((readBack.world as unknown as Record<string, unknown>)[key]));
      const b = JSON.stringify(canonical((played.world as unknown as Record<string, unknown>)[key]));
      if (a !== b) differing.push(`  ${key}:\n    remembered ${a?.slice(0, 200)}\n    played     ${b?.slice(0, 200)}`);
    }
    expect(
      differing,
      'a world field did not survive being saved and loaded. If the field is new, it '
      + 'probably reaches WorldState and createWorld but not SavedGameS and '
      + 'saveGame/loadGame — which does not fail anywhere else, it just resets the '
      + 'field silently on load:\n' + differing.join('\n'),
    ).toEqual([]);
  });

  it('and the two worlds hold the same keys', () => {
    // A field missing entirely, rather than merely reset, is the other half.
    expect(Object.keys(readBack.world).sort()).toEqual(Object.keys(played.world).sort());
  });

  /**
   * The people, the chronicle and the decision log, through the format that
   * carries them. `saveGame` is the only view of `PersonStore`'s contents
   * that is plain data.
   */
  it('the people, chronicle and decision log come back identical', () => {
    const strip = (s: ReturnType<typeof saveGame>) => {
      const { savedAt: _savedAt, ...rest } = s;
      return JSON.stringify(canonical(rest));
    };
    expect(strip(saveGame(readBack))).toEqual(strip(saveGame(played)));
  });

  it('and it is not vacuous — the run it compared had a house in it', () => {
    expect(played.world.people.all().length).toBeGreaterThan(100);
    expect(played.world.decisionLog.length).toBeGreaterThan(10);
    expect(played.world.chronicle.length).toBeGreaterThan(10);
  });
});

describe('the corpus cannot serve a stale run', () => {
  /**
   * The key is a hash of the simulation sources as well as the content, so a
   * change to either makes every existing entry unreachable rather than
   * merely suspect. Hashing content alone would leave the corpus
   * authoritative across a change to `sim.ts` — the suite would keep
   * asserting against runs the current code no longer produces, which is this
   * repository's signature failure installed as infrastructure.
   */
  /**
   * THE EXCLUSION THE KEY RESTS ON.
   *
   * `tools/` is left out of the hash because it drives runs without defining
   * them — gates, the harness, the digest, the corpus warmer. That is true
   * today and nothing but this test keeps it true. The day something on the
   * simulation path imports a tool, the corpus would start serving runs the
   * current code does not produce, and no other instrument in the repository
   * could tell.
   */
  it('nothing on the simulation path imports from tools/', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'dist') continue;
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) { walk(path); continue; }
        if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
        // POSIX separators before the match: on Windows this path is
        // `...\\src\\tools\\...` and the exclusion silently matched nothing.
        if (path.replace(/\\/g, '/').includes('/src/tools/')) continue;
        // `index.ts` re-exports `testFamilies` for the editor. A re-export is
        // not a dependency: nothing it pulls in runs during a simulation.
        if (entry === 'index.ts') continue;
        const text = readFileSync(path, 'utf8');
        if (/from '\.{1,2}\/tools\//.test(text)) offenders.push(path.slice(REPO.length + 1));
      }
    };
    walk(join(REPO, 'packages/core/src'));
    walk(join(REPO, 'packages/schema/src'));

    expect(
      offenders,
      'these are on the simulation path and import from tools/, so tools/ can now change '
      + 'what a run does — and corpus.ts leaves tools/ out of its key. Either move the '
      + 'shared code out of tools/, or stop excluding it in hashSources().',
    ).toEqual([]);
  });

  it('keys on the simulation sources, not only on the content', () => {
    const key = simulationKey();
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    // Stable within a process, and cheap enough to ask twice.
    expect(simulationKey()).toBe(key);
  });

  /**
   * And the escape hatch works, because a cache you cannot turn off is a
   * cache you cannot debug.
   */
  it('ED_RUN_CORPUS=off plays instead of remembering', () => {
    const before = corpusStats();
    const previous = process.env.ED_RUN_CORPUS;
    process.env.ED_RUN_CORPUS = 'off';
    try {
      const ctx = playedRun(bundle, 4242, 5);
      expect(ctx.world.year).toBe(1047);
    } finally {
      if (previous === undefined) delete process.env.ED_RUN_CORPUS;
      else process.env.ED_RUN_CORPUS = previous;
    }
    const after = corpusStats();
    expect(after.hits).toBe(before.hits);
    expect(after.misses).toBeGreaterThan(before.misses);
  });
});

/**
 * ── A SHORT LINE IS NOT A LONG LINE CUT EARLY ─────────────────────────────
 *
 * The key was `(code, content, from, years, seed)`, and `play` booted every
 * run as a Long Line. So `gate:replay` asked for "a Short Line" by length and
 * measured the first 301 years of a Long one — nine clauses, no `settled`,
 * and every `campaignProgress` condition reading a different fraction — while
 * the same tool's library table seeded a real Short Line. Nothing threw.
 *
 * Warm the Short entry FIRST: under the old key the Long request below is a
 * hit on it, and comes back a Short world.
 */
describe('the campaign is part of what a run is', () => {
  const SEED_BOTH = 4243;
  const SPAN = 5;

  it('a Short Line comes back a Short Line, played or remembered', () => {
    const before = corpusStats();
    playedRun(bundle, SEED_BOTH, SPAN, 1042, 'short');
    const remembered = playedRun(bundle, SEED_BOTH, SPAN, 1042, 'short');
    expect(corpusStats().hits - before.hits).toBeGreaterThan(0);
    expect(remembered.world.campaign).toBe('short');
    expect(playedFresh(bundle, SEED_BOTH, SPAN, 1042, 'short').world.campaign).toBe('short');
  });

  it('and the same seed and span as a Long Line is not served the Short entry', () => {
    playedRun(bundle, SEED_BOTH, SPAN, 1042, 'short');
    expect(playedRun(bundle, SEED_BOTH, SPAN, 1042, 'long').world.campaign).toBe('long');
    // The default is still the Long Line every existing caller means.
    expect(playedRun(bundle, SEED_BOTH, SPAN).world.campaign).toBe('long');
  });
});
