import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import {
  ASSIZE_RESPONSES, addGrudge, beget, bitterestAgainst, bootstrap, edge, externalThreadFor,
  grudgeAgainstUs, grudgesAgainst, makeRng, newGame, place, relate, sentimentBetween, testWorld,
  tickRelationships,
} from '@ed/core';
import type { SimCtx } from '@ed/core';

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
      text: response.line,
      named: false,
    });

    response.apply(ctx, makeRng(269), page);

    const grudge = [...ctx.world.relationships.values()].flatMap((rel) => rel.grudges)[0];
    expect(grudge?.originPage).toBe(page);
    const thread = externalThreadFor(ctx, 'house_marrow');
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

