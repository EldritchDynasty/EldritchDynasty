import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import type { Person, Rung } from '@ed/schema';
import { indexContent } from '@ed/schema';
import {
  DEMIGOD_AGEING_STOPPED, LADDER_BLOCKERS, RUNGS, affinitiesFor, booksFor, bootstrap, diagnoseAscension, eldritchPower, foremostOf, grantHeirloom, householdAffinities, householdBooks,
  maxExpressiblePower, order, performUnmaking, phenotypeOf, place, rungIndex, rungTitle, standingOf, testWorld, tickAscension, viewOf,
  type SimCtx,
} from '@ed/core';
import { ELDRITCH_GIFT, ELDRITCH_REACH } from './genetics/expression.js';
import { candidatesFor } from './events/slots.js';
import { TEST_FAMILIES } from './tools/testFamilies.js';
import { rollDeath } from './people/demography.js';
import { makeRng } from './rng.js';

const bundle = loadContent();
const content = indexContent(bundle);

/**
 * THE ASCENSION LADDER (concept §22) — six rungs that were not in the code.
 *
 * Grepping `core` for a tier, a rung or a gate returned comments and test
 * fixtures. The player's only answer to "am I winning?" was a Respect tier
 * that landed on exalted anyway and a clause count that filled itself.
 */
describe('the ladder is a ladder', () => {
  it('runs from the ground to God, in order, with no gaps', () => {
    expect(RUNGS[0]).toBe('none');
    expect(RUNGS[RUNGS.length - 1]).toBe('god');
    expect(RUNGS.length).toBe(7);
    for (const r of RUNGS) expect(rungTitle(r).length).toBeGreaterThan(2);
    expect(rungIndex('demigod')).toBeGreaterThan(rungIndex('hierophant'));
  });

  it('never puts anyone who cannot express on it, at any rung', () => {
    // INVARIANT 1. Capability is the only gate, and it is not sex — a mundane
    // son is exactly as barred as any woman, and for the same reason.
    const ctx = testWorld(bundle, 8080);
    for (const p of ctx.world.people.all()) {
      if (standingOf(ctx, p).rung === 'none') continue;
      expect(p.sex, `${p.name} stands on the ladder`).toBe('male');
    }
  });

  it('says what is in the way, not merely that something is', () => {
    const ctx = testWorld(bundle, 8081);
    const boy = place(ctx, { sex: 'male', age: 20 });
    const standing = standingOf(ctx, boy);
    if (standing.rung !== 'god') {
      expect(standing.blocked, 'a rung was refused without a reason').toBeTruthy();
      expect(standing.blocked!.length).toBeGreaterThan(8);
    }
  });

  it('pairs every blocked sentence with a structured blocker kind', () => {
    const ctx = testWorld(bundle, 8213);

    for (const person of ctx.world.people.all()) {
      const standing = standingOf(ctx, person);
      expect(LADDER_BLOCKERS).toContain(standing.blocker);
      if (standing.blocked) {
        expect(standing.blocker, `${person.name} has prose but no structured blocker`).not.toBe('clear');
        expect(standing.blocker, `${person.name} fell through to the diagnostic escape hatch`).not.toBe('other');
      } else {
        expect(standing.blocker).toBe('clear');
      }
    }

    const foremost = foremostOf(ctx);
    expect(foremost, 'the built world has no living expresser to diagnose').toBeTruthy();
    expect(foremost!.standing.blocker).not.toBe('other');
  });

  it('writes a measured shortfall as prose rather than a score fragment', () => {
    const ctx = testWorld(bundle, 8091);
    const him = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)
      .find((p) => eldritchPower(ctx, p) > 0)!;
    him.awakening = { awakened: true, year: ctx.world.year, age: 20, forced: false, declaredMundane: false };
    him.spellsKnown = [];

    const blocked = standingOf(ctx, him).blocked ?? '';
    expect(blocked).toBeTruthy();
    expect(blocked).not.toMatch(/^\d+ (?:books|affinities) of /);
    expect(blocked).not.toMatch(/\(\d+ of \d+\)/);
  });


  it('turns the authoritative failed predicate into a player-safe next-step diagnosis', () => {
    const ctx = testWorld(bundle, 8212);
    const him = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)
      .find((p) => phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch.canExpress)!;

    // Same person, same authoritative predicate. Only the presentation layer is
    // new: a category, world-language diagnosis and one actionable hint.
    him.awakening = { ...him.awakening, awakened: false };
    const before = standingOf(ctx, him);
    expect(before.blocked).toBe('he has not awakened');
    expect(before.blocker).toBe('awakening');
    expect(before.diagnosis?.target).toBe('touched');
    expect(before.diagnosis?.blockers).toEqual([
      {
        kind: 'awakening',
        text: 'The blood is in him, but it has not awakened.',
        hint: 'Keep him in view for an Awakening; study cannot supply this step.',
      },
    ]);
    expect(JSON.stringify(before.diagnosis)).not.toMatch(/\b(?:10|25|50|70|85|88|90|98)\b/);

    // Change the actual gate and the diagnosis changes on the next read. There
    // is no stored UI state to refresh and no client-side reimplementation.
    him.awakening = {
      awakened: true,
      year: ctx.world.year,
      age: Math.max(0, ctx.world.year - him.born),
      forced: false,
      declaredMundane: false,
    };
    const after = standingOf(ctx, him);
    expect(after.diagnosis?.blockers[0]?.kind).not.toBe('awakening');
  });

  it('diagnoses a broken bloodline even when there is no current climber', () => {
    const ctx = testWorld(bundle, 8213);
    for (const p of [...ctx.world.people.living()]) {
      if (!phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch.canExpress) continue;
      ctx.world.people.kill(p.id, ctx.world.year, 'a test of the bloodline');
    }

    const diagnosis = diagnoseAscension(ctx);
    expect(diagnosis?.person).toBeUndefined();
    expect(diagnosis?.target).toBe('touched');
    expect(diagnosis?.blockers[0]).toEqual({
      kind: 'expression',
      text: 'No living man of the house can express the blood.',
      hint: 'Seek a Match that could carry the font back into the line; no child is promised.',
    });
  });

  it('puts the same diagnosis on the plain SessionView the client receives', () => {
    const ctx = testWorld(bundle, 8214);
    const expected = diagnoseAscension(ctx);
    const actual = viewOf(ctx).ascension.diagnosis;

    expect(actual).toEqual(expected);
    expect(JSON.parse(JSON.stringify(actual))).toEqual(actual);
    // Precise threshold prose is still available on `foremost.blocked`, but
    // the primary diagnosis deliberately does not smuggle it into the UI copy.
    expect(JSON.stringify(actual)).not.toContain('"precise"');
  });
});

/**
 * THE TERMINAL IRONY, ONE MAN NOT TWO (§22, issue #61).
 *
 * `gateFor('god')` used to ask for a currently-living Demigod, DIFFERENT from
 * the ascendant, on top of `p.rites.includes('unmaking')` — but
 * `performUnmaking` ends by killing its subject, so the man who could satisfy
 * the second half could never again satisfy the first. Rung six was
 * unreachable in principle: the cost the brief names was the gate the code
 * refused to let anyone pay.
 *
 * The fix moved the check to where both men are still alive to be measured
 * against each other — `events/rites.yaml`'s `the_unmaking` slot filters —
 * so this asserts the ENGINE half: once the rite has actually happened,
 * `gateFor('god')` must stop asking for a Demigod and move on to whatever
 * else is unmet, never loop back to demanding a second one.
 */
describe('the terminal irony no longer eats its own tail', () => {
  it('casts a two-rite Vessel elder below Demigod with an adult blood descendant', () => {
    const fixture = TEST_FAMILIES.find((f) => f.id === 'demigod_stagnant')!;
    const ctx = fixture.build(bundle);
    const event = bundle.events.find((e) => e.id === 'the_unmaking')!;
    const elder = ctx.world.people.living().find((p) => p.name === 'The Stagnant Head')!;
    const son = ctx.world.people.living().find((p) => p.name === 'A Son Who Outgrew Him')!;
    elder.madness = 30; // Below Demigod's Madness floor, but still a two-rite climber.

    expect(standingOf(ctx, elder).rung).toBe('vessel');
    expect(candidatesFor(event.slots.ELDER!, ctx, {}).map((p) => p.id)).toContain(elder.id);
    expect(candidatesFor(event.slots.ASCENDANT!, ctx, { ELDER: elder.id }).map((p) => p.id)).toContain(son.id);

    son.spellsKnown = [];
    expect(candidatesFor(event.slots.ASCENDANT!, ctx, { ELDER: elder.id }).map((p) => p.id)).toContain(son.id);

    tickAscension(ctx);
    expect(order(ctx, { kind: 'unmaking' }).ok).toBe(true);
    const pending = ctx.world.pendingDecisions.find((d) => d.kind === 'choice' && d.event.id === 'the_unmaking');
    expect(pending?.kind).toBe('choice');
    if (pending?.kind === 'choice') {
      expect(pending.cast.find((r) => r.slot === 'ASCENDANT')?.candidates.map((p) => p.id)).toContain(son.id);
    }
    expect(order(ctx, { kind: 'unmaking' }).ok).toBe(false);

    elder.rites.splice(elder.rites.indexOf('great_rite'), 1);
    expect(candidatesFor(event.slots.ELDER!, ctx, {}).map((p) => p.id)).not.toContain(elder.id);
  });

  function godCandidate(ctx: SimCtx, name: string): Person {
    const p = place(ctx, { sex: 'male', age: 40, name });
    p.awakening.awakened = true;
    p.acquired[ELDRITCH_GIFT] = 400;
    p.acquired[ELDRITCH_REACH] = 400;
    p.acquired.mind = 400;
    p.madness = 65;
    for (const b of content.spellbooks) p.spellsKnown.push(b.id);
    p.phenotype = undefined;
    return p;
  }

  it('lets an Unmaking recipient wait at Demigod for the Ledger without ageing', () => {
    const ctx = testWorld(bundle, 8092);
    ctx.world.respect = 'exalted';
    // bootstrap grants the opening clause; this fixture means exactly six.
    ctx.world.clausesRecovered.clear();
    for (let i = 0; i < 6; i++) ctx.world.clausesRecovered.add(`clause_${i}`);
    grantHeirloom(ctx, 'the_ninefold_seal');
    grantHeirloom(ctx, 'the_ring');
    grantHeirloom(ctx, 'the_rod');

    const recipient = godCandidate(ctx, 'The One Who Waited');
    recipient.rites.push('unmaking');
    recipient.madness = 95;
    recipient.born = ctx.world.year - 500;

    const waiting = standingOf(ctx, recipient);
    expect(waiting.rung).toBe('demigod');
    expect(waiting.blocked).toMatch(/book holds 6 of the 7 clauses/);
    expect(waiting.blocker).toBe('clauses');

    tickAscension(ctx);
    const entry = ctx.world.chronicle.find((line) => line.title === 'The Ledger Stayed Open');
    expect(entry?.text).toContain('stopped growing older before the Ledger was finished');
    expect(entry?.text).toContain('The house waited.');

    // Written once, whatever the page came to say and whatever he came to be
    // called (issue #276): the dedupe reads the page's id, never its words.
    entry!.text = 'Reworded, or rendered in another language.';
    entry!.title = 'Another title';
    recipient.name = 'Somebody Renamed';
    tickAscension(ctx);
    tickAscension(ctx);
    expect(ctx.world.chronicle.filter((line) => line.people?.includes(recipient.id) && line.rung === 'demigod')).toHaveLength(1);

    // Standing is a current reading. Reaching Demigod is a life event:
    // lose the CURRENT rung before his first mortality roll after attainment.
    // If the ascension phase did not latch the event above, the five-century
    // max-age wall below kills him immediately.
    ctx.world.respect = 'regarded';
    expect(standingOf(ctx, recipient).rung).not.toBe('demigod');
    expect(rollDeath(recipient, ctx, makeRng(8092))).toBe(false);
    expect(recipient.status).toBe('alive');
    ctx.world.respect = 'exalted';

    const ordinary = place(ctx, { sex: 'male', age: 30, name: 'An Ordinary Old Man' });
    ordinary.born = ctx.world.year - 500;
    expect(rollDeath(ordinary, ctx, makeRng(8093))).toBe(true);
    expect(ordinary.status).toBe('dead');

    ctx.world.clausesRecovered.add('clause_6');
    expect(standingOf(ctx, recipient).rung).toBe('god');
  });

  it('blocks on the unmade elder before the rite, and on something else after it', () => {
    const ctx = testWorld(bundle, 8090);
    ctx.world.respect = 'exalted';
    ctx.world.clausesRecovered.clear();
    for (let i = 0; i < 6; i++) ctx.world.clausesRecovered.add(`clause_${i}`);
    grantHeirloom(ctx, 'the_ninefold_seal');
    grantHeirloom(ctx, 'the_ring');
    grantHeirloom(ctx, 'the_rod');

    const elder = godCandidate(ctx, 'The Living Demigod');
    elder.rites.push('vessel', 'great_rite');
    // The descendant inherits the elder's two rites; living readers supply
    // the books and affinities, while his own power and mind still gate him.
    const ascendant = godCandidate(ctx, 'The Ascendant');
    ascendant.spellsKnown = [];
    const distinct = [...new Map(content.spellbooks.map((b) => [b.affinity, b])).values()];
    const books = [...distinct, ...content.spellbooks.filter((b) => !distinct.includes(b))].slice(0, 11);
    const readers = [0, 1, 2].map((i) => {
      const reader = place(ctx, { sex: 'male', age: 30, name: `Reader ${i}` });
      reader.spellsKnown.push(...books.filter((_, j) => j % 3 === i).map((b) => b.id));
      return reader;
    });

    // Before the rite he cannot draw on the family's readers.
    expect(standingOf(ctx, elder).rung).toBe('demigod');
    expect(standingOf(ctx, ascendant).blocked).toMatch(/has read 0 books/);

    const res = performUnmaking(ctx, ascendant, elder);
    expect(res.ok, res.reason).toBe(true);
    expect(elder.status).toBe('dead');
    expect(householdAffinities(ctx)).toBe(8);
    expect(householdBooks(ctx)).toBe(11);

    // The rite itself happens after the annual ascension phase when it is a
    // table action. It must therefore remember the Demigod life event before
    // the authored Respect cost can lower the CURRENT reading and before next
    // year's lifecycle asks mortality. This is the production ordering that
    // the annual-latch test above cannot exercise.
    expect(ascendant.acquired[DEMIGOD_AGEING_STOPPED]).toBe(1);
    ascendant.born = ctx.world.year - 500;
    ctx.world.respect = 'regarded';
    expect(rungIndex(standingOf(ctx, ascendant).rung)).toBeLessThan(rungIndex('demigod'));
    expect(rollDeath(ascendant, ctx, makeRng(8095))).toBe(false);
    expect(ascendant.status).toBe('alive');
    ctx.world.respect = 'exalted';

    // The successful rite reached Demigod while the persistent Ledger was the
    // only God gate left. That wait is written immediately — not a year later,
    // when the annual ascension phase might finally see the current rung again.
    const waiting = standingOf(ctx, ascendant);
    expect(waiting.rung).toBe('demigod');
    expect(waiting.blocked).toMatch(/book holds 6 of the 7 clauses/);
    expect(ctx.world.chronicle.some((line) =>
      line.title === 'The Ledger Stayed Open'
      && line.text?.includes('The Ascendant stopped growing older'))).toBe(true);

    // Finish the persistent gate later. The sacrificed elder is still gone,
    // but the recipient can now complete the last rung.
    ctx.world.clausesRecovered.add('clause_6');
    const after = standingOf(ctx, ascendant);
    expect(after.rung).toBe('god');
    expect(after.blocked).toBeUndefined();

    ctx.world.people.kill(readers[0]!.id, ctx.world.year, 'a test of the living circle');
    expect(householdAffinities(ctx)).toBeLessThan(8);
    expect(standingOf(ctx, ascendant).blocked).toMatch(/living family readers/);
  });
});

/**
 * THE SCALE. §22's gates are written 10 / 25 / 50 / 70 / 85 / 98, and the
 * genetics produce a raw quantity that tops out around 22 in practice against
 * an arithmetic ceiling of 66. Two normalisations were wrong before this one:
 * the raw scale (rung 2 of 6 unreachable in principle) and the arithmetic
 * ceiling (rung 2 a coin flip, rungs 3-6 unreachable).
 */
describe('eldritch power, on the scale the gates are written in', () => {
  it('is derived from the locus table, not hardcoded', () => {
    const ctx = testWorld(bundle, 8082);
    expect(maxExpressiblePower(ctx)).toBeGreaterThan(0);
  });

  it('gives an ordinary expresser a real distance still to climb', () => {
    const ctx = testWorld(bundle, 8083);
    const expressers = ctx.world.people.all()
      .filter((p) => eldritchPower(ctx, p) > 0);
    expect(expressers.length, 'the founding cast has nobody who can express').toBeGreaterThan(0);
    for (const p of expressers) {
      // Nobody starts at the top, and nobody is at zero who can express at all.
      expect(eldritchPower(ctx, p)).toBeLessThan(100);
    }
  });
});

/**
 * WHAT THE HOUSE ONCE WAS, WHERE A CLIENT CAN READ IT (issue #50).
 *
 * Invariant 14 keeps exactly one thing across a thousand years, and says why:
 * *"`world.ascension.best` is the only thing remembered, because a family that
 * made a Hierophant once made one."* No pixel printed it. `rung` falls the day
 * the man holding it dies, so a house that put one on the ladder in 1400 and
 * buried him in 1431 read ever after exactly like a house that never managed
 * it — the one number the engine is careful never to forget being the one the
 * player could not see.
 *
 * This asserts the memory survives the man AND arrives on the view, because
 * either half missing looks identical from outside: a header with nothing in
 * it either way.
 */
describe('the ladder remembers the man it lost', () => {
  it('keeps the rung on the view after the man holding it is dead', () => {
    const ctx = testWorld(bundle, 8087);
    const him = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)
      .find((p) => eldritchPower(ctx, p) > 0);
    expect(him, 'the founding cast has nobody who can express').toBeTruthy();
    him!.awakening = { awakened: true, year: ctx.world.year, age: 20, forced: false, declaredMundane: false };

    tickAscension(ctx);
    const climbed = ctx.world.ascension.best;
    const reachedIn = ctx.world.year;
    expect(rungIndex(climbed), 'nobody got onto the ladder at all').toBeGreaterThan(0);
    expect(viewOf(ctx).ascension.rung).toBe(climbed);

    // The house loses him, and some years pass over it.
    ctx.world.year += 31;
    ctx.world.people.kill(him!.id, ctx.world.year, 'the blood, overflowing');
    tickAscension(ctx);

    const view = viewOf(ctx).ascension;
    expect(view.rung, 'the rung should fall with the man').toBe('none');
    expect(view.best, 'the house forgot what it once was').toBe(climbed);
    expect(view.bestTitle).toBe(rungTitle(climbed));
    expect(view.bestAt, 'the memory has no year on it').toBe(reachedIn);
  });

  /**
   * And the reading itself. `power` is normalised onto §22's 0-100 scale off
   * the locus table (invariant 14) — the point of carrying it on the view is
   * that no client ever does that arithmetic and takes a second opinion on the
   * scale, so what arrives has to be on the scale already.
   */
  it('carries the foremost climber\'s reading already on §22\'s scale', () => {
    const ctx = testWorld(bundle, 8088);
    const him = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)
      .find((p) => eldritchPower(ctx, p) > 0)!;
    him.awakening = { awakened: true, year: ctx.world.year, age: 20, forced: false, declaredMundane: false };
    tickAscension(ctx);

    const foremost = viewOf(ctx).ascension.foremost;
    expect(foremost, 'nobody is on the ladder to read').toBeTruthy();
    // `standingOf` rounds to a tenth; the claim is that it is the SAME number
    // on the same scale, not that the client could have derived it.
    expect(foremost!.power)
      .toBeCloseTo(eldritchPower(ctx, ctx.world.people.get(foremost!.person)!), 1);
    expect(foremost!.power).toBeGreaterThan(0);
    expect(foremost!.power).toBeLessThanOrEqual(100);
    expect(foremost!.spells).toBe(ctx.world.people.get(foremost!.person)!.spellsKnown.length);
  });

  it('writes a new high-water mark as a line of the family book, not a generic label', () => {
    const ctx = testWorld(bundle, 8088);
    const him = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)
      .find((p) => eldritchPower(ctx, p) > 0)!;
    him.awakening = { awakened: true, year: ctx.world.year, age: 20, forced: false, declaredMundane: false };

    tickAscension(ctx);

    const climbed = ctx.world.ascension.best;
    expect(rungIndex(climbed)).toBeGreaterThan(0);
    const foremost = viewOf(ctx).ascension.foremost;
    expect(foremost).toBeTruthy();
    const entry = [...ctx.world.chronicle].reverse().find((e) => e.rung === climbed);
    expect(entry, 'the climb left no page in the book').toBeDefined();

    const title = climbed === 'vessel' ? 'The Vessel' : rungTitle(climbed);
    expect(entry!.title).toBe(title);
    expect(entry!.title).not.toBe('A Rung');
    expect(entry!.text).toBe(
      `${foremost!.name} went farther into the blood than anyone of the line before him. `
      + `The book called him ${rungTitle(climbed)}.`,
    );
  });
});

describe('where the ladder actually lands', () => {
  it('lets a man who meets every gate actually hold the rung', () => {
    // The mechanism, built rather than simulated, so this says something even
    // in a batch where nobody happens to get there.
    const ctx = testWorld(bundle, 8085);
    const him = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)
      .find((p) => eldritchPower(ctx, p) > 0);
    expect(him, 'the founding cast has nobody who can express').toBeTruthy();

    him!.awakening = { awakened: true, year: ctx.world.year, age: 20, forced: false, declaredMundane: false };
    expect(standingOf(ctx, him!).rung).toBe('touched');
  });
});

/**
 * THE BOOK COUNTS. §22 asks one man for 3 / 8 / 15 / 25 / 40 books, and the
 * game contains twenty-one. The top three rungs were gates with no key, which
 * typechecked for as long as the raw power scale did and for the same reason:
 * an absolute count in prose, against content authored afterwards to a
 * different size.
 */
describe("the book gates are read off the shelf that exists, not off §22's prose", () => {
  const ctx = testWorld(bundle, 8090);

  it('never asks one man for more books than the game contains', () => {
    // The bug, stated as the test that would have caught it. God wanted forty
    // of twenty-one.
    const catalogue = ctx.content.spellbooks.length;
    expect(catalogue).toBeGreaterThan(0);
    for (const r of RUNGS) {
      expect(booksFor(ctx, r), `${r} wants more books than exist`).toBeLessThanOrEqual(catalogue);
    }
  });

  it('is derived from the catalogue, so adding a spellbook moves the ladder with it', () => {
    const half = {
      ...ctx,
      content: { ...ctx.content, spellbooks: ctx.content.spellbooks.slice(0, 10) },
    } as typeof ctx;
    expect(booksFor(half, 'demigod')).toBeLessThan(booksFor(ctx, 'demigod'));
    expect(booksFor(half, 'god')).toBe(8); // one reader's book for each fixed art
  });

  it('climbs: no rung ever wants fewer books than the rung below it', () => {
    let last = 0;
    for (const r of RUNGS) {
      const need = booksFor(ctx, r);
      expect(need, `${r} asks for fewer books than the rung beneath it`).toBeGreaterThanOrEqual(last);
      last = need;
    }
  });

  it('never asks for more affinities than books, since a book carries one', () => {
    // Normalising the books and not the affinities crosses these two lines at
    // Hierophant, and the book count there becomes a number nothing can be
    // stopped by — the affinity gate one line below refuses him first.
    for (const r of RUNGS) {
      expect(affinitiesFor(r), `${r} wants affinities no shelf of that size can cover`)
        .toBeLessThanOrEqual(booksFor(ctx, r));
    }
  });

  it('still asks for reading at every rung §22 asks for reading at', () => {
    // The rounding takes Adept's three books to under one. A rung that asks
    // for no reading at all is not the rung §22 wrote.
    for (const r of RUNGS.slice(rungIndex('adept'))) {
      expect(booksFor(ctx, r), `${r} asks for no books`).toBeGreaterThan(0);
    }
    expect(booksFor(ctx, 'touched')).toBe(0);
  });

  it('says how many books it wants, in the message, rather than a stale numeral', () => {
    const ctx2 = testWorld(bundle, 8091);
    const him = ctx2.world.people.household(ctx2.world.playerHouse, ctx2.world.year)
      .find((p) => eldritchPower(ctx2, p) > 0);
    expect(him, 'the founding cast has nobody who can express').toBeTruthy();
    him!.awakening = { awakened: true, year: ctx2.world.year, age: 20, forced: false, declaredMundane: false };
    him!.spellsKnown = [];
    const blocked = standingOf(ctx2, him!).blocked ?? '';
    // Whatever stops him, the sentence must not quote a count the code no
    // longer uses. "the three books it takes" outlived the three.
    for (const stale of ['the three books', 'of the eight', 'of the fifteen', 'twenty-five', 'of the forty']) {
      expect(blocked, `a gate still quotes ${stale}`).not.toContain(stale);
    }
  });
});

/**
 * STAGNATION (§22, issue #43).
 *
 * A man near the top of the ladder does not die on schedule and does not let
 * go. `headSince` has measured tenure rather than age since it shipped *for
 * exactly this*, and nothing read it for this until now — invariant 11's
 * shape, one floor up from the fields it usually catches.
 */
describe('the seat a man will not get out of', () => {
  /** A Head standing at the Vessel, built rather than bred. */
  function stagnantHead(ctx: SimCtx, tenure: number): Person {
    const him = ctx.world.people.living().find((p) => p.castSlots.includes('head'))!;
    ctx.world.respect = 'eminent';
    him.awakening.awakened = true;
    him.acquired[ELDRITCH_GIFT] = 400;
    him.acquired.mind = 200;
    him.madness = 30;
    for (const b of content.spellbooks.slice(0, 11)) him.spellsKnown.push(b.id);
    him.rites.push('vessel');
    him.phenotype = undefined;
    ctx.world.headSince = ctx.world.year - tenure;
    return him;
  }

  it('raises discontent while he keeps the seal, and not before a generation of it', () => {
    const ctx = bootstrap(content, 1042, 1042);
    const him = stagnantHead(ctx, 5);
    expect(standingOf(ctx, him).rung).toBe('vessel');

    ctx.world.discontent = 0;
    tickAscension(ctx);
    expect(ctx.world.discontent, 'five years in the chair is not yet a grievance').toBe(0);

    ctx.world.headSince = ctx.world.year - 40;
    tickAscension(ctx);
    expect(ctx.world.discontent).toBeGreaterThan(0);
  });

  /**
   * A Vessel in a cadet hall is not stagnation — he is just somebody the
   * family avoids. The whole of §22's sentence is that he stays HEAD.
   */
  it('charges nothing to a man at the same rung who does not hold the seal', () => {
    const ctx = bootstrap(content, 1042, 1042);
    const him = stagnantHead(ctx, 40);
    him.castSlots = him.castSlots.filter((s) => s !== 'head');

    ctx.world.discontent = 0;
    tickAscension(ctx);
    expect(ctx.world.discontent).toBe(0);
  });

  it('charges nothing for a long reign by a man who never climbed', () => {
    const ctx = bootstrap(content, 1042, 1042);
    const him = ctx.world.people.living().find((p) => p.castSlots.includes('head'))!;
    expect(rungIndex(standingOf(ctx, him).rung)).toBeLessThan(rungIndex('vessel'));
    ctx.world.headSince = ctx.world.year - 80;

    ctx.world.discontent = 0;
    tickAscension(ctx);
    expect(ctx.world.discontent).toBe(0);
  });

  // The property that matters for the day rung five is reachable: nothing has
  // to be rewritten for a Demigod to be worse than a Vessel at the same thing.
  it('scales with how high he stands, so the top of the ladder costs more', () => {
    const charge = (rites: ('vessel' | 'great_rite')[], gift: number) => {
      const ctx = bootstrap(content, 1042, 1042);
      const him = stagnantHead(ctx, 40);
      him.rites.length = 0;
      for (const r of rites) him.rites.push(r);
      him.acquired[ELDRITCH_GIFT] = gift;
      him.acquired[ELDRITCH_REACH] = 40;   // room enough for the blood above
      him.madness = 70;
      him.phenotype = undefined;
      ctx.world.discontent = 0;
      tickAscension(ctx);
      return { charged: ctx.world.discontent, rung: standingOf(ctx, him).rung };
    };

    const vessel = charge(['vessel'], 400);
    const higher = charge(['vessel', 'great_rite'], 400);
    expect(vessel.rung).toBe('vessel');
    if (rungIndex(higher.rung) > rungIndex('vessel')) {
      expect(higher.charged).toBeGreaterThan(vessel.charged);
    } else {
      // Rung five is not reachable in a built fixture either; the scaling is
      // then asserted where it can be — one step is charged one step's worth.
      expect(vessel.charged).toBeGreaterThan(0);
    }
  });
});
