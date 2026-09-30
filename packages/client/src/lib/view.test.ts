import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadContent } from '@ed/content';
import { autoResolveAll, bootstrap, resolveChoice, resolveRecord, stepYear, testRng, viewOf } from '@ed/core';
import type { SimCtx } from '@ed/core';

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

/**
 * PLAYED, NOT MERELY RUN (#341). `discrepancyId` sits only on an embellished
 * page, and the chronicler that `runYears` plays embellishes about one run in
 * three — so when #341's content re-rolled both seeds, neither reached it, and
 * re-seeding would only have bought time until the next content change. This
 * player answers each choice with its first available option through the
 * player's own path, which is what raises a Record block, and writes every
 * Record larger. The optional fields are then reached by construction rather
 * than by the dice.
 */
function play(ctx: SimCtx, years: number): void {
  const rng = testRng('view-fixture');
  for (let y = 0; y < years; y++) {
    stepYear(ctx, false);
    for (let guard = 0; ctx.world.pendingDecisions.length && guard < 50; guard++) {
      const d = ctx.world.pendingDecisions[0]!;
      if (d.kind === 'record' && resolveRecord(ctx, d.id, 'embellish').ok) continue;
      const first = d.kind === 'choice' ? d.choices.find((c) => c.available) : undefined;
      if (first && resolveChoice(ctx, d.id, first.id, rng).ok) continue;
      autoResolveAll(ctx, rng);
    }
  }
}

function agedViews(): Record<string, unknown>[] {
  return VIEW_SEEDS.map((seed) => {
    const ctx = bootstrap(loadContent(), seed, 1042);
    play(ctx, 400);
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
  // Issue #326. The echo line's own words are drawn; this is which sentence
  // frame produced them, kept so the repetition instrument can count copies
  // without reading English (#276). A reader has no use for the frame's name.
  echoFrame: 'which echo sentence frame wrote a line; structure for the repetition instrument, never prose',
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
