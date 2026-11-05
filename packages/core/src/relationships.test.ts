import { describe, expect, it } from 'vitest';
import { applyEffect } from './events/effects.js';
import { readFileSync } from 'node:fs';
import { loadContent } from '@ed/content';
import { asId, proseOriginalHash, type BranchState, type HouseId, type ProseVariant } from '@ed/schema';
import {
  activeRelationshipThreadHouses, ASSIZE_RESPONSES, addGrudge, beget, bitterestAgainst, bootstrap, contentProseAddress,
  ECHO_AFTER, echoGrudges, edge, eventTitleAddress, externalThreadFor, grudgeAgainstUs, grudgesAgainst, makeRng,
  missingPlainEnglish, newGame, place, relate, sentimentBetween, setProseMode, setProseVariants, testWorld,
  tickFamilyQuarrels, tickRelationships,
} from '@ed/core';
import type { SimCtx } from '@ed/core';
import { coreMessageAddress } from './messages.js';

const bundle = loadContent();

/**
 * HOSTILITY IS AN EDGE, AND THE EDGE OUTLIVES BOTH PARTIES.
 *
 * The whole point of `Grudge.inheritance` is that a feud survives the men who
 * started it — in a game whose time unit is a generation, both parties being
 * dead is the NORMAL case. Nothing here throws when it stops working: the
 * relationships map simply empties, `grudgeAgainstUs` returns 0 forever, and
 * every event gated on a feud goes quiet. That reads exactly like a peaceful
 * century, which is why these assertions exist.
 */

/** A world with nobody in it but the founding cast, and a rival abroad. */
function feuding(seed = 1042): { ctx: SimCtx; us: ReturnType<typeof place>; them: ReturnType<typeof place> } {
  const ctx = bootstrap(bundle, seed, 1042);
  const us = place(ctx, { sex: 'male', age: 40, name: 'Ours' });
  const them = place(ctx, { sex: 'male', age: 40, name: 'Theirs', house: 'house_marrow' });
  return { ctx, us, them };
}

describe('sentiment is directional and bounded', () => {
  it('reads zero between two people who have never met', () => {
    const { ctx, us, them } = feuding();
    expect(sentimentBetween(ctx.world, us.id, them.id)).toBe(0);
    expect(edge(ctx.world, us.id, them.id)).toBeUndefined();
  });

  it('records what one side feels without deciding what the other does', () => {
    const { ctx, us, them } = feuding();
    relate(ctx.world, us.id, them.id, 30, ['affection']);

    expect(sentimentBetween(ctx.world, us.id, them.id)).toBe(30);
    expect(sentimentBetween(ctx.world, them.id, us.id)).toBe(0);
  });

  it('accumulates across calls and clamps at the ends of the scale', () => {
    const { ctx, us, them } = feuding();
    relate(ctx.world, us.id, them.id, 40);
    relate(ctx.world, us.id, them.id, 40);
    expect(sentimentBetween(ctx.world, us.id, them.id)).toBe(80);

    relate(ctx.world, us.id, them.id, 90);
    expect(sentimentBetween(ctx.world, us.id, them.id)).toBe(100);

    relate(ctx.world, us.id, them.id, -500);
    expect(sentimentBetween(ctx.world, us.id, them.id)).toBe(-100);
  });

  it('does not list the same kind of tie twice', () => {
    const { ctx, us, them } = feuding();
    relate(ctx.world, us.id, them.id, 5, ['affection']);
    relate(ctx.world, us.id, them.id, 5, ['affection', 'rival']);

    expect(edge(ctx.world, us.id, them.id)!.kinds).toEqual(['affection', 'rival']);
  });
});

describe('taking a grudge', () => {
  it('marks the edge as a rivalry and clamps severity into range', () => {
    const { ctx, us, them } = feuding();
    const g = addGrudge(ctx, them.id, us.id, { severity: 250, inheritance: 'all_blood' }, 'ev_seal_feud');

    expect(g.severity).toBe(100);
    expect(g.originYear).toBe(ctx.world.year);
    expect(g.originEvent).toBe('ev_seal_feud');
    expect(edge(ctx.world, them.id, us.id)!.kinds).toContain('rival');
  });

  it('names an Assize grudge from the Assize page instead of falling back to the quarrel', () => {
    const { ctx } = feuding(269);
    const response = ASSIZE_RESPONSES.find((candidate) => candidate.id === 'an_older_claim')!;
    const page = 'chr_assize_claim';
    ctx.world.chronicle.push({
      id: page,
      year: ctx.world.year,
      weight: 'line',
      text: response.line(ctx),
      named: false,
    });

    response.apply(ctx, makeRng(269), page);

    const [key, rel] = [...ctx.world.relationships.entries()].find(([, r]) => r.grudges.length > 0)!;
    const grudge = rel.grudges[0];
    expect(grudge?.originPage).toBe(page);
    // The Assize picks its own rival; read which house it chose rather than
    // pinning this seed to one of them.
    const holder = ctx.world.people.get(key.split('->')[0] as never)!;
    const thread = externalThreadFor(ctx, String(holder.houseOfOrigin));
    expect(thread, 'the Assize grudge did not become an external relationship thread').toBeDefined();
    const grudgeFact = thread!.pressures.find((fact) => fact.kind === 'grudge');
    expect(grudgeFact?.detail).toContain('A neighbouring house produced a document about a boundary');
    expect(grudgeFact?.detail).not.toContain('the quarrel');
  });

  it('numbers grudges off the world, not off a module counter', () => {
    // INVARIANT 8. Two worlds in one process must not see each other's ids —
    // the harness runs thousands of runs back to back.
    const a = feuding(7);
    const b = feuding(7);
    const first = addGrudge(a.ctx, a.them.id, a.us.id, { severity: 40, inheritance: 'none' });
    const second = addGrudge(b.ctx, b.them.id, b.us.id, { severity: 40, inheritance: 'none' });

    expect(second.id).toBe(first.id);
  });

  it('is found by whoever is looking for what is held against a man', () => {
    const { ctx, us, them } = feuding();
    const other = place(ctx, { sex: 'female', age: 50, name: 'Athird', house: 'house_calder' });

    addGrudge(ctx, them.id, us.id, { severity: 40, inheritance: 'none' });
    addGrudge(ctx, other.id, us.id, { severity: 10, inheritance: 'none' });
    addGrudge(ctx, us.id, them.id, { severity: 90, inheritance: 'none' });

    expect(grudgesAgainst(ctx.world, us.id).map((g) => g.severity).sort((x, y) => x - y)).toEqual([10, 40]);
  });
});

describe('what is held against the house', () => {
  it('reports nothing when the house has made no enemies', () => {
    const { ctx } = feuding();
    expect(grudgeAgainstUs(ctx.world)).toBe(0);
  });

  it('reports the worst live grudge aimed at anyone of ours', () => {
    const { ctx, us, them } = feuding();
    const cousin = place(ctx, { sex: 'female', age: 25, name: 'Cousin' });

    addGrudge(ctx, them.id, us.id, { severity: 30, inheritance: 'none' });
    addGrudge(ctx, them.id, cousin.id, { severity: 70, inheritance: 'none' });

    expect(grudgeAgainstUs(ctx.world)).toBe(70);
  });

  it('ignores a quarrel between two outsiders', () => {
    const { ctx, them } = feuding();
    const stranger = place(ctx, { sex: 'male', age: 40, name: 'Stranger', house: 'house_calder' });
    addGrudge(ctx, stranger.id, them.id, { severity: 90, inheritance: 'none' });

    expect(grudgeAgainstUs(ctx.world)).toBe(0);
  });

  it('names a living holder for casting, and passes over a dead one', () => {
    const { ctx, us, them } = feuding();
    addGrudge(ctx, them.id, us.id, { severity: 55, inheritance: 'none' });
    expect(bitterestAgainst(ctx.world, ctx.world.playerHouse)).toBe(them.id);

    ctx.world.people.kill(them.id, ctx.world.year, 'a fall');
    expect(bitterestAgainst(ctx.world, ctx.world.playerHouse)).toBeUndefined();
  });

  it('excludes future-dated grudges from live hostility and cast selection (#2712)', () => {
    const { ctx, us, them } = feuding(2712);
    const later = place(ctx, { sex: 'male', age: 35, name: 'Future rival', house: 'house_calder' });
    const present = addGrudge(ctx, them.id, us.id, { severity: 25, inheritance: 'none' });
    const future = addGrudge(ctx, later.id, us.id, { severity: 90, inheritance: 'none' });
    future.originYear = ctx.world.year + 6; // Recovered history from a later year.
    const before = structuredClone([...ctx.world.relationships.values()]);

    expect(grudgesAgainst(ctx.world, us.id).map((g) => g.id)).toEqual([present.id]);
    expect(grudgeAgainstUs(ctx.world)).toBe(25);
    expect(bitterestAgainst(ctx.world, ctx.world.playerHouse)).toBe(them.id);

    ctx.world.year = future.originYear;
    expect(grudgesAgainst(ctx.world, us.id).map((g) => g.id)).toEqual([present.id, future.id]);
    expect(grudgeAgainstUs(ctx.world)).toBe(90);
    expect(bitterestAgainst(ctx.world, ctx.world.playerHouse)).toBe(later.id);
    expect([...ctx.world.relationships.values()]).toEqual(before);
  });

  it('prefers the bitterest of several enemies', () => {
    const { ctx, us, them } = feuding();
    const worse = place(ctx, { sex: 'male', age: 35, name: 'Worse', house: 'house_calder' });
    addGrudge(ctx, them.id, us.id, { severity: 20, inheritance: 'none' });
    addGrudge(ctx, worse.id, us.id, { severity: 80, inheritance: 'none' });

    expect(bitterestAgainst(ctx.world, ctx.world.playerHouse)).toBe(worse.id);
  });
});

describe('the annual upkeep', () => {
  it('cools sentiment toward indifference and forgets it once it is nothing', () => {
    const { ctx, us, them } = feuding();
    relate(ctx.world, us.id, them.id, 2);

    tickRelationships(ctx);
    expect(sentimentBetween(ctx.world, us.id, them.id)).toBeCloseTo(1.99, 2);

    for (let i = 0; i < 400; i++) tickRelationships(ctx);
    expect(edge(ctx.world, us.id, them.id)).toBeUndefined();
  });

  it('wears a slight down to nothing within a lifetime, and a killing does not', () => {
    const { ctx, us, them } = feuding();
    addGrudge(ctx, them.id, us.id, { severity: 10, inheritance: 'none' });

    for (let i = 0; i < 30; i++) tickRelationships(ctx);
    expect(grudgesAgainst(ctx.world, us.id)).toEqual([]);

    addGrudge(ctx, them.id, us.id, { severity: 100, inheritance: 'none' });
    for (let i = 0; i < 30; i++) tickRelationships(ctx);
    expect(grudgesAgainst(ctx.world, us.id).length).toBe(1);
  });

  it('does not decay a recovered future grudge before its origin year (#2770)', () => {
    const { ctx, us, them } = feuding(2770);
    const started = addGrudge(ctx, them.id, us.id, { severity: 10, inheritance: 'none' });
    const future = addGrudge(ctx, them.id, us.id, { severity: 80, inheritance: 'none' });
    const year = ctx.world.year;
    future.originYear = year + 3;

    for (let y = year; y < future.originYear; y++) {
      ctx.world.year = y;
      tickRelationships(ctx);
    }
    expect(started.severity).toBeLessThan(10);
    expect(future.severity).toBe(80);
    expect(grudgesAgainst(ctx.world, us.id)).toEqual([started]);

    ctx.world.year = future.originYear;
    tickRelationships(ctx);
    expect(future.severity).toBeCloseTo(80 - future.decayPerYear);
    expect(grudgesAgainst(ctx.world, us.id)).toEqual([started, future]);
  });

  it('keeps a future-only quarrel dormant across a death, then inherits it on time (#2770)', () => {
    const { ctx, us, them } = feuding(2771);
    const son = place(ctx, { sex: 'male', age: 20, name: 'His heir' });
    beget(ctx, son, undefined, us);
    const future = addGrudge(ctx, them.id, us.id, { severity: 70, inheritance: 'heir_only' });
    future.originYear = ctx.world.year + 2;
    ctx.world.people.kill(us.id, ctx.world.year, 'a fever');

    tickRelationships(ctx);
    expect(edge(ctx.world, them.id, us.id)?.grudges).toEqual([future]);
    expect(edge(ctx.world, them.id, son.id)).toBeUndefined();
    expect(future.severity).toBe(70);

    ctx.world.year = future.originYear;
    tickRelationships(ctx);
    expect(edge(ctx.world, them.id, us.id)).toBeUndefined();
    expect(edge(ctx.world, them.id, son.id)?.grudges).toEqual([future]);
    expect(future.severity).toBeCloseTo(70 - future.decayPerYear);
  });

  it('does not carry a pending grudge along with an inherited present one (#2770)', () => {
    const { ctx, us, them } = feuding(2773);
    const son = place(ctx, { sex: 'male', age: 20, name: 'Current heir' });
    beget(ctx, son, undefined, us);
    const present = addGrudge(ctx, them.id, us.id, { severity: 70, inheritance: 'heir_only' });
    const future = addGrudge(ctx, them.id, us.id, { severity: 90, inheritance: 'none' });
    future.originYear = ctx.world.year + 4;
    ctx.world.people.kill(us.id, ctx.world.year, 'a fever');

    tickRelationships(ctx);
    expect(edge(ctx.world, them.id, son.id)?.grudges).toEqual([present]);
    expect(edge(ctx.world, them.id, us.id)?.grudges).toEqual([future]);
    expect(future.severity).toBe(90);

    ctx.world.year = future.originYear;
    tickRelationships(ctx);
    expect(edge(ctx.world, them.id, us.id)).toBeUndefined();
    expect(edge(ctx.world, them.id, son.id)?.grudges).toEqual([present]);
  });

  it('retains a future-only uninheritable quarrel until its origin year (#2770)', () => {
    const { ctx, us, them } = feuding(2772);
    const future = addGrudge(ctx, them.id, us.id, { severity: 20, inheritance: 'none' });
    future.originYear = ctx.world.year + 2;
    ctx.world.people.kill(us.id, ctx.world.year, 'a fever');

    tickRelationships(ctx);
    expect(edge(ctx.world, them.id, us.id)?.grudges).toEqual([future]);
    ctx.world.year = future.originYear;
    tickRelationships(ctx);
    expect(edge(ctx.world, them.id, us.id)).toBeUndefined();
  });

  it('ends an uninheritable quarrel when either party dies', () => {
    const { ctx, us, them } = feuding();
    addGrudge(ctx, them.id, us.id, { severity: 80, inheritance: 'none' });

    ctx.world.people.kill(us.id, ctx.world.year, 'a fever');
    tickRelationships(ctx);

    expect(edge(ctx.world, them.id, us.id)).toBeUndefined();
  });
});

describe('who takes up his quarrel', () => {
  /** A man with a son, a brother, and a housemate of no relation to either. */
  function withKin(ctx: SimCtx, target: ReturnType<typeof place>, house: string) {
    const parent = place(ctx, { sex: 'male', age: 70, name: `${target.name}Father`, house });
    const son = place(ctx, { sex: 'male', age: 20, name: `${target.name}Son`, house });
    const brother = place(ctx, { sex: 'male', age: 45, name: `${target.name}Brother`, house });
    beget(ctx, target, undefined, parent);
    beget(ctx, brother, undefined, parent);
    beget(ctx, son, undefined, target);
    return { son, brother };
  }

  it('heir_only hands it to the son', () => {
    const { ctx, us, them } = feuding();
    const { son } = withKin(ctx, us, ctx.world.playerHouse);
    addGrudge(ctx, them.id, us.id, { severity: 80, inheritance: 'heir_only' });

    ctx.world.people.kill(us.id, ctx.world.year, 'a fever');
    tickRelationships(ctx);

    expect(edge(ctx.world, them.id, us.id)).toBeUndefined();
    expect(edge(ctx.world, them.id, son.id)?.grudges.length).toBe(1);
  });

  it('heir_only ends the feud when there is no son to hand it to', () => {
    const { ctx, us, them } = feuding();
    addGrudge(ctx, them.id, us.id, { severity: 80, inheritance: 'heir_only' });

    ctx.world.people.kill(us.id, ctx.world.year, 'a fever');
    tickRelationships(ctx);

    expect([...ctx.world.relationships.values()]).toEqual([]);
  });

  it('all_blood falls past a childless man to his brother', () => {
    const { ctx, us, them } = feuding();
    const { son, brother } = withKin(ctx, us, ctx.world.playerHouse);
    ctx.world.people.kill(son.id, ctx.world.year, 'a fall');
    addGrudge(ctx, them.id, us.id, { severity: 80, inheritance: 'all_blood' });

    ctx.world.people.kill(us.id, ctx.world.year, 'a fever');
    tickRelationships(ctx);

    expect(edge(ctx.world, them.id, brother.id)?.grudges.length).toBe(1);
  });

  it('all_blood stops at the blood: a housemate of no relation does not inherit it', () => {
    const { ctx, us, them } = feuding();
    place(ctx, { sex: 'male', age: 30, name: 'Unrelated' });
    addGrudge(ctx, them.id, us.id, { severity: 80, inheritance: 'all_blood' });

    ctx.world.people.kill(us.id, ctx.world.year, 'a fever');
    tickRelationships(ctx);

    expect([...ctx.world.relationships.values()]).toEqual([]);
  });

  it('house_wide falls all the way through to anyone of the house', () => {
    const { ctx, us, them } = feuding();
    const housemate = place(ctx, { sex: 'female', age: 60, name: 'Housemate' });
    addGrudge(ctx, them.id, us.id, { severity: 80, inheritance: 'house_wide' });

    ctx.world.people.kill(us.id, ctx.world.year, 'a fever');
    tickRelationships(ctx);

    expect(edge(ctx.world, them.id, housemate.id)?.grudges.length).toBe(1);
  });

  it('moves both ends when both men are dead', () => {
    const { ctx, us, them } = feuding();
    const ours = withKin(ctx, us, ctx.world.playerHouse);
    const theirs = withKin(ctx, them, 'house_marrow');
    addGrudge(ctx, them.id, us.id, { severity: 80, inheritance: 'all_blood' });

    ctx.world.people.kill(us.id, ctx.world.year, 'a fever');
    ctx.world.people.kill(them.id, ctx.world.year, 'a fever');
    tickRelationships(ctx);

    expect(edge(ctx.world, theirs.son.id, ours.son.id)?.grudges.length).toBe(1);
  });

  it('ends the feud when both sides come down to the same person', () => {
    const { ctx, us, them } = feuding();
    // One heir stands on both sides of it: a man cannot feud with himself.
    const child = place(ctx, { sex: 'male', age: 20, name: 'Both' });
    beget(ctx, child, undefined, us);
    ctx.world.people.setParents(child.id, { mother: them.id, father: us.id });
    addGrudge(ctx, them.id, us.id, { severity: 80, inheritance: 'heir_only' });

    ctx.world.people.kill(us.id, ctx.world.year, 'a fever');
    ctx.world.people.kill(them.id, ctx.world.year, 'a fever');
    tickRelationships(ctx);

    expect([...ctx.world.relationships.values()]).toEqual([]);
  });

  it('keeps the widest policy when one edge carries two kinds of grudge', () => {
    const { ctx, us, them } = feuding();
    const housemate = place(ctx, { sex: 'female', age: 60, name: 'Housemate' });
    addGrudge(ctx, them.id, us.id, { severity: 80, inheritance: 'heir_only' });
    addGrudge(ctx, them.id, us.id, { severity: 80, inheritance: 'house_wide' });

    // No son, so heir_only alone would have ended both. house_wide is wider.
    ctx.world.people.kill(us.id, ctx.world.year, 'a fever');
    tickRelationships(ctx);

    expect(edge(ctx.world, them.id, housemate.id)?.grudges.length).toBe(2);
  });

  it('merges into an edge that already exists rather than dropping one', () => {
    const { ctx, us, them } = feuding();
    const heir = place(ctx, { sex: 'male', age: 20, name: 'Heir' });
    beget(ctx, heir, undefined, us);

    addGrudge(ctx, them.id, us.id, { severity: 80, inheritance: 'heir_only' });
    addGrudge(ctx, them.id, heir.id, { severity: 40, inheritance: 'heir_only' });

    ctx.world.people.kill(us.id, ctx.world.year, 'a fever');
    tickRelationships(ctx);

    expect(edge(ctx.world, them.id, heir.id)?.grudges.length).toBe(2);
  });

  it('carries a feud through four generations without either party surviving it', () => {
    const { ctx, us, them } = feuding();
    addGrudge(ctx, them.id, us.id, { severity: 100, inheritance: 'house_wide' });

    let ourLast = us;
    let theirLast = them;
    for (let gen = 0; gen < 4; gen++) {
      const ourNext = place(ctx, { sex: 'male', age: 20, name: `Ours${gen}` });
      const theirNext = place(ctx, { sex: 'male', age: 20, name: `Theirs${gen}`, house: 'house_marrow' });
      beget(ctx, ourNext, undefined, ourLast);
      beget(ctx, theirNext, undefined, theirLast);
      ctx.world.people.kill(ourLast.id, ctx.world.year, 'age');
      ctx.world.people.kill(theirLast.id, ctx.world.year, 'age');
      tickRelationships(ctx);
      ourLast = ourNext;
      theirLast = theirNext;
    }

    expect(grudgeAgainstUs(ctx.world)).toBeGreaterThan(90);
    expect(edge(ctx.world, theirLast.id, ourLast.id)?.grudges.length).toBe(1);
  });
});

/**
 * WHETHER THE FEUD SYSTEM HOLDS ANY FEUDS.
 *
 * It did not. Measured across six thousand-year runs: live grudges at 2042,
 * ZERO; oldest grudge ever, ZERO YEARS. Three separate reasons, and every one
 * of them looked exactly like a working system from outside.
 */
describe('grudges that outlive the men who took them', () => {
  it('makes severity a duration, which its own comment always claimed', () => {
    // `decayPerYear` was a flat 0.35 whatever the severity, so the seal feud's
    // own grudge — severity 60, `all_blood`, the most serious thing the
    // content can author — burned out in 170 years, about six generations.
    const ctx = testWorld(bundle, 6001);
    const a = place(ctx, { sex: 'male', age: 30 });
    const b = place(ctx, { sex: 'male', age: 30 });
    const slight = addGrudge(ctx, a.id, b.id, { severity: 15, inheritance: 'all_blood' });
    const killing = addGrudge(ctx, b.id, a.id, { severity: 90, inheritance: 'all_blood' });

    expect(killing.decayPerYear).toBeLessThan(slight.decayPerYear);
    // A killing is still being held against the house four centuries later.
    expect(killing.severity / killing.decayPerYear).toBeGreaterThan(400);
    expect(slight.severity / slight.decayPerYear).toBeLessThan(100);
  });

  it('lets a house-wide feud go dormant rather than ending it', () => {
    // Rival-house people are transient mints, so almost every feud hit a year
    // with no living holder and was quietly deleted by the "nobody left to
    // hold it" line. House Marrow with nobody currently alive has not
    // forgiven anybody; it has nobody in the room.
    const ctx = testWorld(bundle, 6002);
    const ours = place(ctx, { sex: 'male', age: 30 });
    const theirs = place(ctx, { sex: 'male', age: 60, house: 'house_marrow' });
    addGrudge(ctx, theirs.id, ours.id, { severity: 70, inheritance: 'house_wide' }, 'a_boundary');

    ctx.world.people.kill(theirs.id, ctx.world.year, 'in the ordinary way');
    tickRelationships(ctx);

    const live = [...ctx.world.relationships.values()].flatMap((r) => r.grudges);
    expect(live.length, 'the feud ended because nobody happened to be alive').toBe(1);
  });

  it('still ends a personal quarrel when there is nobody left to hold it', () => {
    const ctx = testWorld(bundle, 6003);
    const ours = place(ctx, { sex: 'male', age: 30 });
    const theirs = place(ctx, { sex: 'male', age: 60, house: 'house_marrow' });
    addGrudge(ctx, theirs.id, ours.id, { severity: 40, inheritance: 'heir_only' }, 'a_slight');

    ctx.world.people.kill(theirs.id, ctx.world.year, 'in the ordinary way');
    tickRelationships(ctx);
    expect([...ctx.world.relationships.values()].flatMap((r) => r.grudges).length).toBe(0);
  });
});


describe('grudge echo chronology (#2772)', () => {
  it('does not let a future saved echo silence a present grudge in either prose mode', () => {
    for (const mode of ['original', 'plainenglish'] as const) {
      const { ctx, us, them } = feuding(2772);
      setProseMode(ctx, mode);
      const firstYear = ctx.world.year;
      const ready = addGrudge(ctx, them.id, us.id, { severity: 90, inheritance: 'house_wide' });
      const future = addGrudge(ctx, them.id, us.id, { severity: 70, inheritance: 'house_wide' });
      ctx.world.year += ECHO_AFTER;
      future.echoed = true;
      future.echoedIn = ctx.world.year + 5; // Recovered testimony from a later year.

      expect(echoGrudges(ctx)).toBe(1);
      expect(ready.echoedIn).toBe(ctx.world.year);
      expect(ctx.world.chronicle.at(-1)?.cause?.year).toBe(firstYear);
      expect(future.echoedIn).toBe(ctx.world.year + 5);
    }
  });

  it('still suppresses a same-house echo when it really happened recently', () => {
    const { ctx, us, them } = feuding(2773);
    const ready = addGrudge(ctx, them.id, us.id, { severity: 90, inheritance: 'house_wide' });
    const previous = addGrudge(ctx, them.id, us.id, { severity: 70, inheritance: 'house_wide' });
    ctx.world.year += ECHO_AFTER;
    previous.echoed = true;
    previous.echoedIn = ctx.world.year - 1;

    expect(echoGrudges(ctx)).toBe(0);
    expect(ready.echoed).toBe(true);
    expect(ready.echoedIn).toBeUndefined();
  });
});

describe('the quarrel pages speak the reader\'s setting (#740)', () => {
  const ORIGINALS: Record<string, [string, string]> = {
    'grudge.echo.not_let_go': ['At {HOUSE} they had not let go of {ABOUT}.', '{HOUSE} still remembered {ABOUT}.'],
    'grudge.echo.told_against': [
      '{HOUSE} still told {ABOUT} their own way, and still told it against this house.',
      '{HOUSE} still told their own version of {ABOUT}, and it still blamed this family.',
    ],
    'grudge.echo.never_mentioned': [
      'A guest from {HOUSE} was civil at the table and never once mentioned {ABOUT}, which was how everybody knew.',
      'A guest from {HOUSE} was polite at dinner but never mentioned {ABOUT}, so everyone knew it still mattered.',
    ],
    'grudge.about_event': ['what happened in "{TITLE}"', 'the events of "{TITLE}"'],
    'grudge.about_year': ['what the house did in {YEAR}', "the family's actions in {YEAR}"],
    'grudge.hall_quarrel': [
      '{SPEAKER} stopped writing to the seat, and told the hall why, and the hall remembered it longer than he did.',
      '{SPEAKER} stopped writing to the head of the family and told his household why. They remembered it after he had forgotten.',
    ],
  };
  const fill = (t: string, v: Record<string, string>) => t.replace(/\{([A-Z]+)\}/g, (_, k: string) => v[k]!);
  const ECHOES = ['grudge.echo.not_let_go', 'grudge.echo.told_against', 'grudge.echo.never_mentioned'];

  function speaking(ctx: SimCtx, mode: 'original' | 'plainenglish', extra: ProseVariant[] = []) {
    setProseVariants(ctx, [
      ...Object.entries(ORIGINALS).map(([key, [original, plain]]) => ({
        address: coreMessageAddress(key), of: proseOriginalHash(original), plainenglish: plain,
      })),
      ...extra,
    ]);
    setProseMode(ctx, mode);
  }

  /** A grudge held abroad, heard from `generations` generations after it began. */
  function echo(mode: 'original' | 'plainenglish', generations: number, named: boolean) {
    const { ctx, us, them } = feuding();
    const origin = bundle.events.find((e) => e.title)!;
    speaking(ctx, mode, [{
      address: eventTitleAddress(ctx, origin)!, of: proseOriginalHash(origin.title), plainenglish: 'A plain title',
    }]);
    const began = ctx.world.year;
    addGrudge(ctx, them.id, us.id, { severity: 90, inheritance: 'house_wide' }, named ? origin.id : 'unrecorded');
    ctx.world.year += ECHO_AFTER * generations;
    expect(echoGrudges(ctx)).toBe(1);
    const house = ctx.world.houses.get('house_marrow')!.name;
    return { ctx, page: ctx.world.chronicle.at(-1)!, house, began, title: origin.title };
  }

  it('keeps every echo Original byte for byte, across all three lines', () => {
    const seen = new Set<string>();
    for (let g = 1; g <= 3; g += 1) {
      const { page, house, began, title } = echo('original', g, g !== 2);
      const about = g !== 2 ? `what happened in "${title}"` : `what the house did in ${began}`;
      const line = ECHOES.map((k) => fill(ORIGINALS[k]![0], { HOUSE: house, ABOUT: about }))
        .find((t) => t === page.text);
      expect(line, page.text ?? '').toBeDefined();
      seen.add(line!.replace(about, ''));
      expect(page.echoFrame).toMatch(/^grudge:[0-2]$/);
    }
    expect(seen.size).toBe(3);
  });

  it('renders the echoes in Plain English, the event title included, and keeps them', () => {
    const texts = new Set<string>();
    for (let g = 1; g <= 3; g += 1) {
      const { ctx, page, house, began } = echo('plainenglish', g, g !== 2);
      const about = g !== 2 ? 'the events of "A plain title"' : `the family's actions in ${began}`;
      const line = ECHOES.map((k) => fill(ORIGINALS[k]![1], { HOUSE: house, ABOUT: about }))
        .find((t) => t === page.text);
      expect(line, page.text ?? '').toBeDefined();
      texts.add(page.text ?? '');
      const original = echo('original', g, g !== 2);
      // Words only: which line, its frame and its cause are the same draw.
      expect(page.echoFrame).toBe(original.page.echoFrame);
      expect(page.cause).toEqual(original.page.cause);
      setProseMode(ctx, 'original');
      expect(page.text).toBe(line);
    }
    expect(texts.size).toBe(3);
  });

  it('translates an authored rival-house name when writing a grudge echo (#976)', () => {
    const def = bundle.houses.find((house) => house.id === 'house_marrow');
    if (!def) throw new Error('house_marrow fixture is missing');
    const address = contentProseAddress('houses.yaml', 'houses[id=house_marrow].name');
    const reviewed = {
      address,
      of: proseOriginalHash(def.name),
      plainenglish: 'The Marrow family',
    };

    const anEcho = (
      mode: 'original' | 'plainenglish',
      variant: ProseVariant = reviewed,
      rename?: string,
    ) => {
      const { ctx, us, them } = feuding();
      if (rename !== undefined) {
        const house = ctx.world.houses.get('house_marrow');
        if (!house) throw new Error('house_marrow world record is missing');
        ctx.world.houses.set('house_marrow', { ...house, name: rename });
      }
      speaking(ctx, mode, [variant]);
      addGrudge(ctx, them.id, us.id, { severity: 90, inheritance: 'house_wide' }, 'unrecorded');
      ctx.world.year += ECHO_AFTER;
      expect(echoGrudges(ctx)).toBe(1);
      return { ctx, page: ctx.world.chronicle.at(-1)! };
    };

    const original = anEcho('original');
    expect(original.page.text).toContain(def.name);

    const translated = anEcho('plainenglish');
    expect(translated.page.text).toContain(reviewed.plainenglish);
    expect(missingPlainEnglish(translated.ctx)).not.toContain(address);
    expect(translated.page.echoFrame).toBe(original.page.echoFrame);
    expect(translated.page.cause).toEqual(original.page.cause);
    const frozen = translated.page.text;
    setProseMode(translated.ctx, 'original');
    expect(translated.page.text).toBe(frozen);

    const stale = anEcho('plainenglish', { ...reviewed, of: proseOriginalHash('Former house name') });
    expect(stale.page.text).toContain(def.name);
    expect(stale.page.text).not.toContain(reviewed.plainenglish);
    expect(missingPlainEnglish(stale.ctx)).toContain(address);

    const renamed = anEcho('plainenglish', reviewed, 'The Renamed House');
    expect(renamed.page.text).toContain('The Renamed House');
    expect(renamed.page.text).not.toContain(reviewed.plainenglish);
    expect(missingPlainEnglish(renamed.ctx)).not.toContain(address);
  });

  function quarrel(mode: 'original' | 'plainenglish') {
    const { ctx, us } = feuding();
    speaking(ctx, mode);
    us.castSlots.push('head');
    const speaker = place(ctx, { sex: 'male', age: 30, name: 'Edric' });
    const branch: BranchState = {
      id: 'br_test' as BranchState['id'], name: "Edric's hall", house: ctx.world.playerHouse as BranchState['house'],
      founder: speaker.id, splitFrom: 'main', foundedYear: ctx.world.year - 20, speaker: speaker.id, grievance: 90,
    };
    ctx.world.branches.set(branch.id, branch);
    expect(tickFamilyQuarrels(ctx)).toHaveLength(1);
    return { ctx, branch, page: ctx.world.chronicle.at(-1)! };
  }

  it('renders the hall quarrel in both settings and changes nothing else', () => {
    const original = quarrel('original');
    expect(original.page.text).toBe(
      'Edric stopped writing to the seat, and told the hall why, and the hall remembered it longer than he did.',
    );
    const plain = quarrel('plainenglish');
    expect(plain.page.text).toBe(fill(ORIGINALS['grudge.hall_quarrel']![1], { SPEAKER: 'Edric' }));
    expect(plain.branch.grievance).toBe(original.branch.grievance);
    expect(grudgeAgainstUs(plain.ctx.world)).toBe(grudgeAgainstUs(original.ctx.world));
    setProseMode(plain.ctx, 'original');
    expect(plain.page.text).toContain('stopped writing to the head of the family');
  });
});


/** Every distinct Original sentence/fragment generated by the thread read model. */
const THREAD_ORIGINALS: Record<string, string> = {
  'threads.family.current': '{NAME} of {HOUSE} married into the family in {YEAR}; the connection is still living.',
  'threads.contact.current': '{NAME} of {HOUSE} dealt with the family in “{TITLE}” in {YEAR}.',
  'threads.contact.history': '{NAME} of {HOUSE} dealt with the family in “{TITLE}” in {YEAR}.',
  'threads.courtship.current': '{NAME} of {HOUSE} came before the Match in {YEAR} and remains unmarried in that house.',
  'threads.grudge.default': 'the quarrel',
  'threads.grudge': '{HOLDER} still holds a grudge against {TARGET} over {ORIGIN} ({YEAR}).',
  'threads.record.named.current': 'the {YEAR} entry “{TITLE}”',
  'threads.record.named.history': 'the {YEAR} entry “{TITLE}”',
  'threads.record.text': 'the {YEAR} entry “{TEXT}”',
  'threads.record.disputed.current': 'a disputed {YEAR} entry',
  'threads.record.disputed.history': 'a disputed {YEAR} entry',
  'threads.record.prove': '{HOUSE} can prove {CLAIM}.',
  'threads.secret.current': '{NAME} carried a household secret to {HOUSE} in {YEAR} and has not yet told it.',
  'threads.auction.upcoming': '{HOUSE} is bringing {LOT} to auction in {YEAR}.',
  'threads.promise': '{HOUSE} is owed the marriage pledged in {YEAR} for {LOT}.',
  'threads.family.history': '{NAME} of {HOUSE} married into the family in {YEAR}.',
  'threads.courtship.history': '{NAME} of {HOUSE} came before the Match in {YEAR}.',
  'threads.record.history': '{HOUSE} was tied to the evidence behind {CLAIM}.',
  'threads.secret.history': '{NAME} carried a household secret to {HOUSE} in {SINCE}; it was told in {YEAR}.',
  'threads.auction.offered': '{HOUSE} offered {LOT} at the {YEAR} auction.',
  'threads.auction.won': '{HOUSE} took {LOT} at the {YEAR} auction.',
};

describe('external relationship thread prose (#793)', () => {
  it('pins the message inventory and every keyed Original at its call site', () => {
    const source = readFileSync(new URL('./relationship-threads.ts', import.meta.url), 'utf8');
    const found = [...source.matchAll(/msg\(modeCtx,\s*'([^']+)',\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)]
      .map(([, key, literal]) => [key, literal!.slice(1, -1)]);
    expect(Object.fromEntries(found)).toEqual(THREAD_ORIGINALS);
    // Each call site has its own stable identity, even when two originals match.
    expect(found).toHaveLength(Object.keys(THREAD_ORIGINALS).length);
  });


  it('keeps equally strong grudges in the Original order even if their translated text sorts differently', () => {
    const { ctx, us, them } = feuding();
    us.name = 'Zed';
    them.name = 'Alden';
    const ours = place(ctx, { sex: 'female', age: 30, name: 'Ava' });
    const rival = place(ctx, { sex: 'female', age: 30, name: 'Zora', house: 'house_marrow' });
    addGrudge(ctx, them.id, us.id, { severity: 55, inheritance: 'none' });
    addGrudge(ctx, rival.id, ours.id, { severity: 55, inheritance: 'none' });
    const original = externalThreadFor(ctx, 'house_marrow')!;
    const before = original.pressures.filter((p) => p.kind === 'grudge').map((p) => p.ref);
    expect(before).toHaveLength(2);

    setProseVariants(ctx, [{
      address: coreMessageAddress('threads.grudge'),
      of: proseOriginalHash(THREAD_ORIGINALS['threads.grudge']!),
      // Target-first flips the alphabetical tie if rendered text controls sorting.
      plainenglish: '{TARGET} is blamed by {HOLDER} over {ORIGIN} in {YEAR}.',
    }]);
    setProseMode(ctx, 'plainenglish');
    const translated = externalThreadFor(ctx, 'house_marrow')!;
    const after = translated.pressures.filter((p) => p.kind === 'grudge').map((p) => p.ref);
    expect(after).toEqual(before);
    expect(translated.origin.ref).toBe(original.origin.ref);
    expect(translated.pressures.find((p) => p.kind === 'grudge')?.detail)
      .toContain('is blamed by');
  });

  it('translates a grudge and an untold secret without moving the facts or their ordering', () => {
    const { ctx, us, them } = feuding();
    addGrudge(ctx, them.id, us.id, { severity: 75, inheritance: 'none' });
    ctx.world.looseSecrets.push({
      secret: 'thread_secret_test',
      carrier: us.id,
      carrierName: 'Ours',
      house: 'house_marrow',
      since: ctx.world.year,
      severity: 'minor',
    });
    const original = externalThreadFor(ctx, 'house_marrow');
    expect(original).toBeDefined();
    expect(original!.pressures.map((fact) => fact.kind)).toContain('grudge');
    expect(original!.pressures.map((fact) => fact.kind)).toContain('secret');

    setProseVariants(ctx, [
      {
        address: coreMessageAddress('threads.grudge.default'),
        of: proseOriginalHash(THREAD_ORIGINALS['threads.grudge.default']!),
        plainenglish: 'an old dispute',
      },
      {
        address: coreMessageAddress('threads.grudge'),
        of: proseOriginalHash(THREAD_ORIGINALS['threads.grudge']!),
        plainenglish: '{HOLDER} still blames {TARGET} for {ORIGIN} (year {YEAR}).',
      },
      {
        address: coreMessageAddress('threads.secret.current'),
        of: proseOriginalHash(THREAD_ORIGINALS['threads.secret.current']!),
        plainenglish: '{NAME} took a secret to {HOUSE} in {YEAR} and has not shared it.',
      },
    ]);
    setProseMode(ctx, 'plainenglish');
    const translated = externalThreadFor(ctx, 'house_marrow');
    expect(translated).toBeDefined();
    expect(translated!.pressures.find((fact) => fact.kind === 'grudge')?.detail)
      .toContain('still blames');
    expect(translated!.pressures.find((fact) => fact.kind === 'secret')?.detail)
      .toContain('has not shared it.');
    const structure = (thread: NonNullable<typeof original>) => ({
      house: thread.house, name: thread.name,
      origin: { kind: thread.origin.kind, year: thread.origin.year, ref: thread.origin.ref },
      pressures: thread.pressures.map(({ kind, year, ref }) => ({ kind, year, ref })),
    });
    expect(structure(translated!)).toEqual(structure(original!));
    // The founding family's other visible relationship is deliberately
    // untranslated, and so are the names of the houses on the returned
    // threads (#917) — Marrow's among them.
    const missing = missingPlainEnglish(ctx);
    expect(missing).toContain(contentProseAddress(ctx.content.sourceOf('house_marrow')!, 'houses[id=house_marrow].name'));
    expect(missing.filter((address) => !/#houses\[id=[^\]]+\]\.name$/.test(address)))
      .toEqual([coreMessageAddress('threads.family.current')]);
  });
});

describe('relationship threads name things in the reader\'s setting (#917)', () => {
  const multiword = (text: string) => text.trim().split(/\s+/).length > 1;

  /** A Marrow contact in a named scene, and a Marrow pledge for a named heirloom. */
  function named() {
    const ctx = testWorld(bundle, 917, 1200);
    const head = place(ctx, { sex: 'male', age: 42, name: 'Aldren Thread', castSlots: ['head'] });
    const marrow = place(ctx, { sex: 'female', age: 34, name: 'Sera Marrow', house: 'house_marrow' });
    const scene = bundle.events.find((e) => e.purposes.includes('change_relationship') && multiword(e.title))!;
    const heirloom = bundle.heirlooms.find((h) => multiword(h.name))!;
    expect(scene).toBeDefined();
    expect(heirloom).toBeDefined();
    ctx.world.decisionLog.push({
      kind: 'outcome', year: 1199, event: scene.id, outcomeId: 'thread-917',
      fill: { HEAD: head.id, RIVAL: marrow.id },
    });
    ctx.world.marriagePromises.push({ toHouse: 'house_marrow', year: 1198, lot: String(heirloom.id), pledgedBy: head.id });

    const house = ctx.content.house('house_marrow')!;
    const variants: ProseVariant[] = [
      { address: eventTitleAddress(ctx, scene)!, of: proseOriginalHash(scene.title), plainenglish: 'A Plain Scene' },
      {
        address: contentProseAddress(ctx.content.sourceOf('house_marrow')!, 'houses[id=house_marrow].name'),
        of: proseOriginalHash(house.name), plainenglish: 'The Plain Marrows',
      },
      {
        address: contentProseAddress(ctx.content.sourceOf(String(heirloom.id))!, `heirlooms[id=${encodeURIComponent(String(heirloom.id))}].name`),
        of: proseOriginalHash(heirloom.name), plainenglish: 'A Plain Heirloom',
      },
    ];
    return { ctx, scene, heirloom, house, variants };
  }

  const detail = (thread: ReturnType<typeof externalThreadFor>, kind: string) =>
    thread!.pressures.find((fact) => fact.kind === kind)?.detail;
  const structure = (thread: NonNullable<ReturnType<typeof externalThreadFor>>) => ({
    house: thread.house,
    origin: { kind: thread.origin.kind, year: thread.origin.year, ref: thread.origin.ref },
    pressures: thread.pressures.map(({ kind, year, ref }) => ({ kind, year, ref })),
  });

  it('substitutes the reviewed event title, house name and lot name into the shown sentence', () => {
    const { ctx, scene, heirloom, house, variants } = named();
    const original = externalThreadFor(ctx, 'house_marrow')!;
    expect(original.name).toBe(house.name);
    expect(detail(original, 'recent_contact')).toBe(
      `Sera Marrow of ${house.name} dealt with the family in “${scene.title}” in 1199.`);
    expect(detail(original, 'marriage_promise')).toBe(
      `${house.name} is owed the marriage pledged in 1198 for ${heirloom.name}.`);

    setProseVariants(ctx, variants);
    setProseMode(ctx, 'plainenglish');
    const plain = externalThreadFor(ctx, 'house_marrow')!;
    expect(plain.name).toBe('The Plain Marrows');
    // The sentence shells have no variant here, so only the names move.
    expect(detail(plain, 'recent_contact')).toBe(
      'Sera Marrow of The Plain Marrows dealt with the family in “A Plain Scene” in 1199.');
    expect(detail(plain, 'marriage_promise')).toBe(
      'The Plain Marrows is owed the marriage pledged in 1198 for A Plain Heirloom.');
    expect(structure(plain)).toEqual(structure(original));
    for (const variant of variants) expect(missingPlainEnglish(ctx)).not.toContain(variant.address);

    setProseMode(ctx, 'original');
    expect(externalThreadFor(ctx, 'house_marrow')).toEqual(original);
  });

  it('keeps live house renames in thread titles and facts in both reading modes (#1271)', () => {
    const { ctx, variants, scene } = named();
    const renamed = 'Marrow by the River';
    ctx.world.houses.get('house_marrow')!.name = renamed;

    const original = externalThreadFor(ctx, 'house_marrow')!;
    expect(original.name).toBe(renamed);
    expect(detail(original, 'recent_contact')).toBe(
      `Sera Marrow of ${renamed} dealt with the family in “${scene.title}” in 1199.`);
    expect(detail(original, 'marriage_promise')).toContain(`${renamed} is owed the marriage`);

    setProseVariants(ctx, variants);
    setProseMode(ctx, 'plainenglish');
    const plain = externalThreadFor(ctx, 'house_marrow')!;
    expect(plain.name).toBe(renamed);
    expect(detail(plain, 'recent_contact')).toBe(
      `Sera Marrow of ${renamed} dealt with the family in “A Plain Scene” in 1199.`);
    expect(detail(plain, 'marriage_promise')).toBe(
      `${renamed} is owed the marriage pledged in 1198 for A Plain Heirloom.`);
    expect(missingPlainEnglish(ctx)).not.toContain(variants[1]!.address);
    expect(structure(plain)).toEqual(structure(original));

    setProseMode(ctx, 'original');
    expect(externalThreadFor(ctx, 'house_marrow')).toEqual(original);
  });

  it('asks for no name in the hot recurrence query, which shows the player nothing', () => {
    const { ctx } = named();
    setProseMode(ctx, 'plainenglish');
    expect(activeRelationshipThreadHouses(ctx).has('house_marrow')).toBe(true);
    expect(missingPlainEnglish(ctx)).toEqual([]);
  });
});

/**
 * Real authored outcomes: do not reverse the injured person's feelings while
 * fixing who inherits the grievance. The effect handler treats sentiment as
 * from -> to, but creates a grudge on to -> from.
 */
describe('authored grudge holder direction (#2407)', () => {
  const cases: Array<{
    eventId: string; choiceId?: string; outcomeId: string; injuredSlot: 'RIVAL' | 'COUSIN';
    sentiment: number; severity: number; inheritance: 'heir_only' | 'all_blood';
  }> = [
    { eventId: 'a_slight_at_a_door', choiceId: 'answer_it_now', outcomeId: 'answered_in_the_passage',
      injuredSlot: 'RIVAL', sentiment: -18, severity: 22, inheritance: 'heir_only' },
    { eventId: 'the_second_signature', choiceId: 'let_the_claim_stand', outcomeId: 'the_quarrel_kept',
      injuredSlot: 'RIVAL', sentiment: -12, severity: 12, inheritance: 'heir_only' },
    { eventId: 'the_hall_is_answered', choiceId: 'promise_them', outcomeId: 'promised',
      injuredSlot: 'COUSIN', sentiment: -18, severity: 25, inheritance: 'all_blood' },
    { eventId: 'the_hall_stops_writing', outcomeId: 'they_arrange_it_between_themselves',
      injuredSlot: 'COUSIN', sentiment: -30, severity: 40, inheritance: 'all_blood' },
    { eventId: 'the_marrow_codex_offered', choiceId: 'buy_the_codex', outcomeId: 'bought_the_codex',
      injuredSlot: 'RIVAL', sentiment: -22, severity: 20, inheritance: 'heir_only' },
    { eventId: 'the_house_next_door_attainted', choiceId: 'buy_the_land', outcomeId: 'bought',
      injuredSlot: 'RIVAL', sentiment: -30, severity: 30, inheritance: 'heir_only' },
  ];

  it.each(cases)('$eventId / $outcomeId gives the injured person the grudge', (witness) => {
    const ctx = testWorld(bundle, 2407);
    // A single constructed Head makes the generic "head" target unambiguous.
    for (const person of ctx.world.people.living()) {
      person.castSlots = person.castSlots.filter((slot) => slot !== 'head');
    }
    const head = place(ctx, { sex: 'male', age: 43, name: 'Head of the House', castSlots: ['head'] });
    const injured = place(ctx, {
      sex: 'male', age: 41, name: 'Injured party',
      house: witness.injuredSlot === 'RIVAL' ? 'house_marrow' : ctx.world.playerHouse,
    });
    const event = bundle.events.find((candidate) => candidate.id === witness.eventId);
    if (!event) throw new Error(`Missing authored event ${witness.eventId}`);
    const outcomes = event.interaction.kind === 'choice'
      ? event.interaction.choices.find((choice) => choice.id === witness.choiceId)?.outcomes
      : event.interaction.kind === 'narration'
        ? event.interaction.outcomes
        : undefined;
    const outcome = outcomes?.find((candidate) => candidate.id === witness.outcomeId);
    if (!outcome) throw new Error(`Missing authored outcome ${witness.eventId}/${witness.outcomeId}`);
    const relationships = outcome.effects.filter((effect) => effect.kind === 'relationship');
    expect(relationships, 'sentiment and grudge must have separate directions').toHaveLength(2);
    for (const effect of relationships) {
      applyEffect(effect, ctx, { HEAD: head.id, RIVAL: injured.id, COUSIN: injured.id }, { event });
    }

    // The actor's victim remembers, and the victim still resents the actor.
    expect(sentimentBetween(ctx.world, injured.id, head.id)).toBe(witness.sentiment);
    expect(sentimentBetween(ctx.world, head.id, injured.id)).toBe(0);
    const held = edge(ctx.world, injured.id, head.id)?.grudges ?? [];
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({
      severity: witness.severity,
      inheritance: witness.inheritance,
      originEvent: witness.eventId,
    });
    expect(edge(ctx.world, head.id, injured.id)?.grudges ?? []).toEqual([]);
  });
});


describe('recovered future-born grudge participants (#2859, #2860)', () => {
  it('keeps a house-wide quarrel with its dead holder until a future heir is born (#2859)', () => {
    const { ctx, us, them } = feuding(2859);
    const w = ctx.world;
    // A house-wide feud can pass to any living housemate. Remove the seeded
    // Marrow cast so the unborn child really is the only possible successor.
    for (const person of w.people.all()) {
      if (person.houseOfOrigin === them.houseOfOrigin && person.id !== them.id) {
        w.people.remove(person.id);
      }
    }
    const son = place(ctx, { sex: 'male', age: 20, name: 'Not yet born', house: 'house_marrow' });
    beget(ctx, son, undefined, them);
    son.born = w.year + 2; // A restored alive row dated after the current year.
    const grudge = addGrudge(ctx, them.id, us.id, { severity: 80, inheritance: 'house_wide' });
    w.people.kill(them.id, w.year, 'a fever');

    tickRelationships(ctx);
    expect(edge(w, son.id, us.id)).toBeUndefined();
    expect(edge(w, them.id, us.id)?.grudges).toContain(grudge);

    w.year = son.born;
    tickRelationships(ctx);
    expect(edge(w, son.id, us.id)?.grudges).toContain(grudge);
    expect(edge(w, them.id, us.id)).toBeUndefined();
  });

  it('excludes future-born rival holders until their actual birth year (#2860)', () => {
    const { ctx, us, them } = feuding(2860);
    const w = ctx.world;
    const unborn = place(ctx, { sex: 'male', age: 35, name: 'Later rival', house: 'house_calder' });
    unborn.born = w.year + 2;
    addGrudge(ctx, them.id, us.id, { severity: 25, inheritance: 'none' });
    addGrudge(ctx, unborn.id, us.id, { severity: 85, inheritance: 'none' });

    expect(bitterestAgainst(w, w.playerHouse)).toBe(them.id);
    w.year = unborn.born;
    expect(bitterestAgainst(w, w.playerHouse)).toBe(unborn.id);
  });

  it('does not let a not-yet-born cadet speaker start the family quarrel (#2860)', () => {
    const { ctx, us } = feuding(28602);
    const w = ctx.world;
    // The founding Head already holds the seat; make this fixture's target
    // the sole Head before checking the speaker's directional grudge.
    for (const person of w.people.all()) {
      person.castSlots = person.castSlots.filter((slot) => slot !== 'head');
    }
    us.castSlots.push('head');
    const speaker = place(ctx, { sex: 'male', age: 30, name: 'Future speaker' });
    const branch: BranchState = {
      id: 'br_future_speaker' as BranchState['id'], name: 'The later hall',
      house: w.playerHouse as BranchState['house'],
      founder: speaker.id, splitFrom: 'main', foundedYear: w.year - 20,
      speaker: speaker.id, grievance: 90,
    };
    w.branches.set(branch.id, branch);
    speaker.born = w.year + 2;
    const beforePages = w.chronicle.length;

    expect(tickFamilyQuarrels(ctx)).toEqual([]);
    expect(w.chronicle).toHaveLength(beforePages);
    expect(branch.grievance).toBe(90);
    expect(edge(w, speaker.id, us.id)).toBeUndefined();

    w.year = speaker.born;
    expect(tickFamilyQuarrels(ctx)).toHaveLength(1);
    expect(edge(w, speaker.id, us.id)?.grudges).toHaveLength(1);
    expect(branch.grievance).toBeLessThan(90);
  });
});


// Recovered-save chronology: dates outrank a stale status flag or future membership.
describe('feud recovery chronology (#2981, #2982, #2983)', () => {
  it('transfers a grudge exactly when an imported death year arrives (#2981)', () => {
    const { ctx, us, them } = feuding(2981);
    const son = place(ctx, { sex: 'male', age: 20, name: 'Surviving son' });
    beget(ctx, son, undefined, us);
    const grudge = addGrudge(ctx, them.id, us.id, { severity: 80, inheritance: 'heir_only' });
    const firstYear = ctx.world.year;
    us.died = firstYear + 2;
    tickRelationships(ctx);
    expect(edge(ctx.world, them.id, us.id)?.grudges).toContain(grudge);
    expect(edge(ctx.world, them.id, son.id)).toBeUndefined();
    ctx.world.year = firstYear + 2;
    tickRelationships(ctx);
    expect(us.status).toBe('alive');
    expect(edge(ctx.world, them.id, us.id)).toBeUndefined();
    expect(edge(ctx.world, them.id, son.id)?.grudges).toContain(grudge);
  });

  it('ends a personal grudge on a recorded death despite a stale alive flag (#2981)', () => {
    const { ctx, us, them } = feuding(29811);
    addGrudge(ctx, them.id, us.id, { severity: 75, inheritance: 'none' });
    us.died = ctx.world.year;
    expect(us.status).toBe('alive');
    tickRelationships(ctx);
    expect(edge(ctx.world, them.id, us.id)).toBeUndefined();
  });

  it('skips a deceased elder heir but takes the younger living heir (#2982)', () => {
    const { ctx, us, them } = feuding(2982);
    const elder = place(ctx, { sex: 'male', age: 30, name: 'Deceased elder' });
    const younger = place(ctx, { sex: 'male', age: 20, name: 'Living younger' });
    beget(ctx, elder, undefined, us);
    beget(ctx, younger, undefined, us);
    addGrudge(ctx, them.id, us.id, { severity: 80, inheritance: 'heir_only' });
    us.died = ctx.world.year;
    elder.died = ctx.world.year;
    tickRelationships(ctx);
    expect(elder.status).toBe('alive');
    expect(edge(ctx.world, them.id, elder.id)).toBeUndefined();
    expect(edge(ctx.world, them.id, younger.id)?.grudges).toHaveLength(1);
  });

  it('falls back to a living sibling after an effectively dead saved child (#2982)', () => {
    const { ctx, us, them } = feuding(29822);
    const father = place(ctx, { sex: 'male', age: 70, name: 'Father of the line' });
    const brother = place(ctx, { sex: 'male', age: 30, name: 'Living brother' });
    const son = place(ctx, { sex: 'male', age: 20, name: 'Recorded dead son' });
    beget(ctx, us, undefined, father);
    beget(ctx, brother, undefined, father);
    beget(ctx, son, undefined, us);
    addGrudge(ctx, them.id, us.id, { severity: 80, inheritance: 'all_blood' });
    us.died = ctx.world.year;
    son.died = ctx.world.year;
    tickRelationships(ctx);
    expect(edge(ctx.world, them.id, son.id)).toBeUndefined();
    expect(edge(ctx.world, them.id, brother.id)?.grudges).toHaveLength(1);
  });

  it('does not inherit a house-wide feud through a deceased housemate (#2982)', () => {
    const { ctx, us, them } = feuding(29823);
    const older = place(ctx, { sex: 'female', age: 60, name: 'Dead housemate' });
    const younger = place(ctx, { sex: 'female', age: 30, name: 'Living housemate' });
    // The founding cast contains other eligible housemates. Isolate this
    // inheritance choice so the test proves the stale-death boundary rather
    // than whichever unrelated founder happens to be the eldest survivor.
    for (const person of ctx.world.people.all()) {
      if (person.houseOfOrigin === us.houseOfOrigin
        && person.id !== us.id && person.id !== older.id && person.id !== younger.id) {
        ctx.world.people.remove(person.id);
      }
    }
    older.died = ctx.world.year;
    us.died = ctx.world.year;
    addGrudge(ctx, them.id, us.id, { severity: 90, inheritance: 'house_wide' });
    tickRelationships(ctx);
    expect(edge(ctx.world, them.id, older.id)).toBeUndefined();
    expect(edge(ctx.world, them.id, younger.id)?.grudges).toHaveLength(1);
  });

  it('counts a target as ours only during a finite, effective membership (#2983)', () => {
    const { ctx, them } = feuding(2983);
    const holder = place(ctx, { sex: 'male', age: 36, house: 'house_calder', name: 'Outside holder' });
    const firstYear = ctx.world.year;
    const grudge = addGrudge(ctx, holder.id, them.id, { severity: 67, inheritance: 'none' });
    them.membership[0]!.to = firstYear + 2;
    them.membership.push({ house: asId<HouseId>(ctx.world.playerHouse), kind: 'married_in', from: firstYear + 2, to: firstYear + 4 });
    expect(grudgeAgainstUs(ctx.world)).toBe(0);
    expect(bitterestAgainst(ctx.world, ctx.world.playerHouse)).toBeUndefined();
    ctx.world.year = firstYear + 2;
    expect(grudgeAgainstUs(ctx.world)).toBe(grudge.severity);
    expect(bitterestAgainst(ctx.world, ctx.world.playerHouse)).toBe(holder.id);
    ctx.world.year = firstYear + 4;
    expect(grudgeAgainstUs(ctx.world)).toBe(0);
    expect(bitterestAgainst(ctx.world, ctx.world.playerHouse)).toBeUndefined();
  });

  it('includes finite membership for a house grudge only between its dates (#2983)', () => {
    const { ctx, us } = feuding(29831);
    const outsider = place(ctx, { sex: 'male', age: 27, house: 'house_calder', name: 'Future Marrow guest' });
    const firstYear = ctx.world.year;
    outsider.membership[0]!.to = firstYear + 3;
    outsider.membership.push({ house: asId<HouseId>('house_marrow'), kind: 'married_in', from: firstYear + 3, to: firstYear + 6 });
    const grudge = addGrudge(ctx, us.id, 'house_marrow', { severity: 55, inheritance: 'none' });
    expect(grudgesAgainst(ctx.world, outsider.id)).not.toContain(grudge);
    ctx.world.year = firstYear + 3;
    expect(grudgesAgainst(ctx.world, outsider.id)).toContain(grudge);
    ctx.world.year = firstYear + 6;
    expect(grudgesAgainst(ctx.world, outsider.id)).not.toContain(grudge);
  });

  it('cannot cast a rival after their recorded death year (#2983)', () => {
    const { ctx, us, them } = feuding(29832);
    addGrudge(ctx, them.id, us.id, { severity: 85, inheritance: 'none' });
    them.died = ctx.world.year + 1;
    expect(bitterestAgainst(ctx.world, ctx.world.playerHouse)).toBe(them.id);
    ctx.world.year++;
    expect(them.status).toBe('alive');
    expect(bitterestAgainst(ctx.world, ctx.world.playerHouse)).toBeUndefined();
  });

  it('does not echo a feud through a foreigner before their membership starts (#2983)', () => {
    const { ctx, them } = feuding(29833);
    const holder = place(ctx, { sex: 'male', age: 33, house: 'house_calder', name: 'Outside witness' });
    const grudge = addGrudge(ctx, holder.id, them.id, { severity: 90, inheritance: 'house_wide' });
    const firstYear = ctx.world.year;
    them.membership[0]!.to = firstYear + ECHO_AFTER + 2;
    them.membership.push({
      house: asId<HouseId>(ctx.world.playerHouse), kind: 'married_in',
      from: firstYear + ECHO_AFTER + 2, to: firstYear + ECHO_AFTER + 5,
    });
    ctx.world.year = firstYear + ECHO_AFTER;
    expect(echoGrudges(ctx)).toBe(0);
    expect(grudge.echoed).toBeUndefined();
    ctx.world.year += 2;
    expect(echoGrudges(ctx)).toBe(1);
    expect(grudge.echoedIn).toBe(ctx.world.year);
  });
});


describe('family quarrel participants and cadet years (#2985)', () => {
  function grievance(seed: number) {
    const { ctx, us } = feuding(seed);
    // Make the Head under test the only Head, as the existing #2860 mechanism test does.
    for (const p of ctx.world.people.all()) {
      p.castSlots = p.castSlots.filter((slot) => slot !== 'head');
    }
    us.castSlots.push('head');
    const speaker = place(ctx, { sex: 'male', age: 30, name: 'Aggrieved cadet' });
    const branch: BranchState = {
      id: 'br_saved_quarrel' as BranchState['id'], name: 'The saved hall',
      house: ctx.world.playerHouse as BranchState['house'], founder: speaker.id,
      splitFrom: 'main', foundedYear: ctx.world.year - 10,
      speaker: speaker.id, grievance: 90,
    };
    ctx.world.branches.set(branch.id, branch);
    return { ctx, us, speaker, branch };
  }

  it('does not let an effectively deceased saved Head create a feud (#2985)', () => {
    const { ctx, us, speaker } = grievance(29851);
    us.died = ctx.world.year;
    expect(us.status).toBe('alive');
    const pages = ctx.world.chronicle.length;
    expect(tickFamilyQuarrels(ctx)).toHaveLength(0);
    expect(edge(ctx.world, speaker.id, us.id)).toBeUndefined();
    expect(ctx.world.chronicle).toHaveLength(pages);
  });

  it('does not let an effectively deceased saved speaker create a feud (#2985)', () => {
    const { ctx, us, speaker, branch } = grievance(29852);
    speaker.died = ctx.world.year;
    expect(speaker.status).toBe('alive');
    expect(tickFamilyQuarrels(ctx)).toHaveLength(0);
    expect(edge(ctx.world, speaker.id, us.id)).toBeUndefined();
    expect(branch.grievance).toBe(90);
  });

  it('holds a future-founded cadet quarrel until its actual founding year (#2985)', () => {
    const { ctx, us, speaker, branch } = grievance(29853);
    const firstYear = ctx.world.year;
    branch.foundedYear = firstYear + 3;
    expect(tickFamilyQuarrels(ctx)).toHaveLength(0);
    expect(edge(ctx.world, speaker.id, us.id)).toBeUndefined();
    ctx.world.year = firstYear + 3;
    expect(tickFamilyQuarrels(ctx)).toHaveLength(1);
    expect(edge(ctx.world, speaker.id, us.id)?.grudges).toHaveLength(1);
  });

  it('honours only effective extinction and recall, not their future saved years (#2985)', () => {
    for (const field of ['extinct', 'recalled'] as const) {
      const { ctx, us, speaker, branch } = grievance(field === 'extinct' ? 29854 : 29855);
      branch[field] = ctx.world.year + 3;
      expect(tickFamilyQuarrels(ctx)).toHaveLength(1);
      expect(edge(ctx.world, speaker.id, us.id)?.grudges).toHaveLength(1);

      // An independently recovered branch on the effective boundary cannot
      // begin another quarrel; build it anew to avoid its first standing grudge.
      const later = grievance(field === 'extinct' ? 29856 : 29857);
      later.branch[field] = later.ctx.world.year + 3;
      later.ctx.world.year += 3;
      expect(tickFamilyQuarrels(later.ctx)).toHaveLength(0);
      expect(edge(later.ctx.world, later.speaker.id, later.us.id)).toBeUndefined();
    }
  });
});
