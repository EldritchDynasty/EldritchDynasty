import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadContent } from '@ed/content';
import { bootstrap, runYears, viewOf } from '@ed/core';

const SRC = join(import.meta.dirname, '..');

/**
 * EVERY FIELD ON THE READ MODEL REACHES A TEMPLATE (issue #47).
 *
 * `verbs.test.ts` walks the verbs; this walks the other half. The epic that
 * asked for it says why:
 *
 *   > A field nothing reads is a bug, not a stub (invariant 11); a view field
 *   > nothing draws is the same bug one layer out. `ascension.best` exists
 *   > because invariant 14 insists the house remembers its high-water mark,
 *   > and no pixel anywhere prints it. Nothing throws. It looks precisely like
 *   > a working game.
 *
 * Five of that epic's twelve issues were this exact bug — `assize.pressure`,
 * `ascension.best`, `foremost.power`, `foremost.spells`, and the whole
 * chronicle beyond the last sixty lines — and every one of them was found by
 * a person reading the code months later rather than by anything mechanical.
 * This is the tripwire that would have caught them on the day they landed.
 *
 * It is a tripwire and not a proof: it asks whether the NAME appears in a
 * template, which a field could satisfy by coincidence. That is the same
 * bargain `verbs.test.ts` strikes, and it costs nothing against the failure
 * it catches, which is a field nobody drew at all.
 */
function templates(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) templates(path, out);
    else if (entry.endsWith('.vue')) out.push(path);
  }
  return out;
}

const drawn = templates(SRC).map((p) => readFileSync(p, 'utf8')).join('\n');

/**
 * Views taken off runs old enough to have filled their optional fields — a
 * guardian, an Age, a tale in circulation, a secret out of the house, an
 * embellished page. A fresh world would leave half of these absent and the
 * walk would never see them.
 *
 * TWO seeds, unioned, and the walk reads EVERY element of every array
 * (issue #336). The fixture used to be one seed read through the first
 * element of each list, and when content moved it was re-seeded until the
 * field it had just surfaced went away again — 1043 reached `discrepancyId`,
 * so the file moved to 1044, which by `68a69db` carried the field too and
 * still passed, because its first chronicle entry was not embellished. An
 * optional field lives on SOME elements; a walk of one element is blind to
 * exactly the fields this tripwire exists for. `REACHED` below says which
 * optional fields the fixture must actually carry, so a fixture that stops
 * reaching one fails by name instead of passing by vacuum.
 *
 * Played once per file: the walk and its guards share one key set.
 */
const VIEW_SEEDS = [1043, 1044];

function agedViews(): Record<string, unknown>[] {
  return VIEW_SEEDS.map((seed) => {
    const ctx = bootstrap(loadContent(), seed, 1042);
    runYears(ctx, 400);
    return viewOf(ctx) as unknown as Record<string, unknown>;
  });
}

/** Every key name the read model actually carries, nested fields included. */
function keysOf(o: unknown, depth = 0, out = new Set<string>()): Set<string> {
  if (depth > 4 || o === null || typeof o !== 'object') return out;
  if (Array.isArray(o)) {
    // EVERY element, not the first (issue #336). One element is the shape only
    // when no field is optional, and an optional field — a page's
    // `discrepancyId`, a `cause`, `claims` — is exactly the kind that sits on
    // the fortieth entry and not the first.
    for (const item of o) keysOf(item, depth, out);
    return out;
  }
  for (const [key, value] of Object.entries(o)) {
    out.add(key);
    // `attrs` maps are keyed by CONTENT ids — `mind`, `charm`, `thermal` — and
    // those are authored data, not fields of this read model. Walking into one
    // would have the test demand a template mentioning every attribute in the
    // game by name.
    if (key === 'attrs') continue;
    keysOf(value, depth + 1, out);
  }
  return out;
}

/**
 * Fields the client deliberately does not draw, each with the reason.
 *
 * It is kept short, and honest below rather than by
 * intention: the first draft of it had twelve entries and eleven of them were
 * excusing fields the client already drew. An exceptions list nobody checks
 * grows until it is the whole read model, and then the tripwire is a comment.
 */
const NOT_DRAWN: Record<string, string> = {
  outcomeId: 'which branch of a template resolved. The player meets the prose; the id is for replay',
  blocked: 'the precise gate string is for tooling/deep inspection; the header draws diagnosis text and hint instead',
  // Decided in issue #336. `applyRecord` sets it on every embellished page and
  // nowhere else, so it is present exactly when `record === 'embellish'`,
  // which `Entry.vue` already marks "as the house tells it". The id itself is
  // a key into `world.discrepancies`, which no view carries: there is nothing
  // for it to link to, and a mark keyed off the Discrepancy's STATE would tell
  // the player whether the page had been disproved — a reading of truth this
  // layer does not give (AGENTS.md → Do not). A page is disputed; it is never
  // labelled a lie.
  discrepancyId: 'an embellished page\'s key into world.discrepancies. The mark "as the house tells it" already draws the fact; the state behind the key is not the page\'s to show',
  // Surfaced by #336's full walk: it sits on a few members, never the first.
  succession: 'drawing the heir and the possible heirs on the tree is #268\'s client slice (Tree.vue / Member.vue); delete this entry when it lands',
};

/**
 * Fields the fixture must carry, the optional ones above all. If a content
 * change leaves the runs without one of them, this fails naming it — the fix
 * is a fixture that reaches it again, never a quieter walk.
 */
const REACHED = [
  'guardian', 'ascension', 'assize', 'chronicle', 'halls',
  'outcomeId', 'discrepancyId', 'claims', 'record',
];

describe('the walk itself (issue #336)', () => {
  it('finds a key that only a later element of an array carries', () => {
    const found = keysOf({ pages: [{ year: 1100 }, { year: 1101 }, { year: 1102, discrepancyId: 'x' }] });
    expect([...found].sort()).toEqual(['discrepancyId', 'pages', 'year']);
  });
});

describe('every field on the read model reaches a template', () => {
  const keys = [...agedViews().reduce((all, v) => keysOf(v, 0, all), new Set<string>())].sort();

  it('walks views with their optional fields actually set', () => {
    // A guard on the guard: if the walk ever comes back thin, everything below
    // passes by vacuum.
    expect(keys.length).toBeGreaterThan(60);
    for (const expected of REACHED) {
      expect(keys, `the fixture no longer reaches ${expected}`).toContain(expected);
    }
  });

  it.each(keys.filter((k) => !(k in NOT_DRAWN)))(
    'a template draws `%s`',
    (key) => {
      expect(
        new RegExp(`\\b${key}\\b`).test(drawn),
        `nothing in packages/client draws \`${key}\` — draw it, or say why not in NOT_DRAWN`,
      ).toBe(true);
    },
  );

  /**
   * And the exceptions stay honest, in both directions.
   *
   * A name that leaves the read model should leave this list, and — the half
   * that matters — a name that somebody DOES draw should leave it too. An
   * excuse nobody rechecks is how a list of one becomes a list of forty, at
   * which point the tripwire above is a comment.
   */
  it('does not excuse a field the read model no longer has', () => {
    const stale = Object.keys(NOT_DRAWN).filter((k) => !keys.includes(k));
    expect(stale, 'these are excused and no longer on the view').toEqual([]);
  });

  it('does not excuse a field that is drawn anyway', () => {
    const needless = Object.keys(NOT_DRAWN).filter((k) => new RegExp(`\\b${k}\\b`).test(drawn));
    expect(needless, 'these are drawn, so the excuse is stale — delete it').toEqual([]);
  });
});
