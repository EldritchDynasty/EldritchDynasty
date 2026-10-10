import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import type { Person, Rung } from '@ed/schema';
import { indexContent, proseOriginalHash } from '@ed/schema';
import {
  DEMIGOD_AGEING_STOPPED, LADDER_BLOCKERS, RUNGS, affinitiesFor, booksFor, bootstrap, diagnoseAscension, eldritchPower, foremostOf, grantHeirloom, householdAffinities, householdBooks,
  maxExpressiblePower, order, performUnmaking, phenotypeOf, place, rungIndex, rungTitle, standingOf, testWorld, tickAscension, viewOf,
  setProseMode, setProseVariants,
  type SimCtx,
} from '@ed/core';
import { ELDRITCH_GIFT, ELDRITCH_REACH } from './genetics/expression.js';
import { candidatesFor } from './events/slots.js';
import { TEST_FAMILIES } from './tools/testFamilies.js';
import { rollDeath } from './people/demography.js';
import { makeRng } from './rng.js';
import { coreMessageAddress } from './messages.js';
import { diagnoseHouseAscension, type HouseAscension } from './ascension.js';
import { coreMessageEntries } from './tools/core-message-audit.js';

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
    const titles = testWorld(bundle);
    for (const r of RUNGS) expect(rungTitle(titles, r).length).toBeGreaterThan(2);
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
    expect(view.bestTitle).toBe(rungTitle(ctx, climbed));
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

    const title = climbed === 'vessel' ? 'The Vessel' : rungTitle(ctx, climbed);
    expect(entry!.title).toBe(title);
    expect(entry!.title).not.toBe('A Rung');
    expect(entry!.text).toBe(
      `${foremost!.name} went farther into the blood than anyone of the line before him. `
      + `The book called him ${rungTitle(ctx, climbed)}.`,
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


describe('translated ascension Chronicle pages (#768)', () => {
  const originalWait = '{PERSON} stopped growing older before the Ledger was finished. The book remained open on the table. The house waited.';
  const originalClimb = '{PERSON} went farther into the blood than anyone of the line before him. The book called him {RUNG}.';
  const variants = [
    { address: coreMessageAddress('ascension.ledger_wait_title'),
      of: proseOriginalHash('The Ledger Stayed Open'), plainenglish: 'The Ledger Was Still Unfinished' },
    { address: coreMessageAddress('ascension.ledger_wait'),
      of: proseOriginalHash(originalWait),
      plainenglish: '{PERSON} no longer aged, but the Ledger was not finished. Its book stayed open on the table, and the family waited.' },
    { address: coreMessageAddress('ascension.rung_reached'),
      of: proseOriginalHash(originalClimb),
      plainenglish: '{PERSON} went farther into the blood than anyone before him. The family record called him {RUNG}.' },
  ];

  function prepare(mode: 'original' | 'plainenglish', seed: number): SimCtx {
    const ctx = testWorld(bundle, seed);
    setProseVariants(ctx, variants);
    setProseMode(ctx, mode);
    return ctx;
  }

  function ledgerWait(mode: 'original' | 'plainenglish') {
    const ctx = prepare(mode, 8092);
    ctx.world.respect = 'exalted';
    ctx.world.clausesRecovered.clear();
    for (let i = 0; i < 6; i++) ctx.world.clausesRecovered.add(`clause_${i}`);
    grantHeirloom(ctx, 'the_ninefold_seal');
    grantHeirloom(ctx, 'the_ring');
    grantHeirloom(ctx, 'the_rod');

    const person = place(ctx, { sex: 'male', age: 40, name: 'The One Who Waited' });
    person.awakening.awakened = true;
    person.acquired[ELDRITCH_GIFT] = 400;
    person.acquired[ELDRITCH_REACH] = 400;
    person.acquired.mind = 400;
    person.madness = 95;
    for (const book of content.spellbooks) person.spellsKnown.push(book.id);
    person.phenotype = undefined;
    person.rites.push('unmaking');
    person.born = ctx.world.year - 500;
    expect(standingOf(ctx, person).rung).toBe('demigod');
    expect(standingOf(ctx, person).blocker).toBe('clauses');

    tickAscension(ctx);
    const entry = ctx.world.chronicle.find((e) => e.id === `ledger_wait:${person.id}`)!;
    expect(entry).toBeDefined();
    return { ctx, person, entry };
  }

  it('writes the Ledger-wait title and whole sentence in the selected mode and never rewrites either', () => {
    const original = ledgerWait('original');
    const plain = ledgerWait('plainenglish');
    expect([original.entry.title, original.entry.text]).toEqual([
      'The Ledger Stayed Open',
      'The One Who Waited stopped growing older before the Ledger was finished. The book remained open on the table. The house waited.',
    ]);
    expect([plain.entry.title, plain.entry.text]).toEqual([
      'The Ledger Was Still Unfinished',
      'The One Who Waited no longer aged, but the Ledger was not finished. Its book stayed open on the table, and the family waited.',
    ]);
    expect(plain.ctx.world.ascension).toEqual(original.ctx.world.ascension);
    expect(plain.person.acquired[DEMIGOD_AGEING_STOPPED]).toBe(1);
    const snapshot = [plain.entry.title, plain.entry.text];
    setProseMode(plain.ctx, 'original');
    tickAscension(plain.ctx);
    expect([plain.entry.title, plain.entry.text]).toEqual(snapshot);
    expect(plain.ctx.world.chronicle.filter((e) => e.id === plain.entry.id)).toHaveLength(1);
  });

  function rungPage(mode: 'original' | 'plainenglish') {
    const ctx = prepare(mode, 8088);
    const him = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)
      .find((p) => eldritchPower(ctx, p) > 0)!;
    him.awakening = { awakened: true, year: ctx.world.year, age: 20, forced: false, declaredMundane: false };
    tickAscension(ctx);
    const climbed = ctx.world.ascension.best;
    expect(rungIndex(climbed)).toBeGreaterThan(0);
    const page = [...ctx.world.chronicle].reverse().find((e) => e.rung === climbed)!;
    expect(page).toBeDefined();
    return { ctx, climbed, page, foremost: foremostOf(ctx)!.person };
  }

  it('writes the rung-attainment page in either mode without moving the ladder', () => {
    const original = rungPage('original');
    const plain = rungPage('plainenglish');
    expect(original.climbed).toBe(plain.climbed);
    expect(original.foremost.id).toBe(plain.foremost.id);
    expect(original.ctx.world.ascension).toEqual(plain.ctx.world.ascension);
    const personName = original.ctx.world.people.get(original.foremost.id)!.name;
    const rungName = rungTitle(original.ctx, original.climbed);
    expect(original.page.text).toBe(`${personName} went farther into the blood than anyone of the line before him. The book called him ${rungName}.`);
    expect(plain.page.text).toBe(`${personName} went farther into the blood than anyone before him. The family record called him ${rungName}.`);
    expect(original.page.title).toBe(plain.page.title);
    setProseMode(plain.ctx, 'original');
    expect(plain.page.text).toContain('The family record');
  });
});

describe('the ladder diagnosis speaks the reader\'s setting (#827, #828)', () => {
  const keyed = coreMessageEntries(readFileSync(new URL('./ascension.ts', import.meta.url), 'utf8'))
    .filter((entry) => /#ascension\.diagnosis\./.test(entry.address));
  const UPPER =
    /\.(vessel_mind|vessel_rite|regalia|great_rite|circle_books|circle_pairs|god_floor|god_overflow|clauses|elder)_/;
  const texts = (upper: boolean): Record<string, string> => Object.fromEntries(keyed
    .filter((entry) => UPPER.test(entry.address) === upper)
    .map((entry) => [entry.address.split('#')[1], entry.text]));

  it('keys every lower-rung and expression diagnosis (#827)', () => {
    expect(texts(false)).toEqual({
      'ascension.diagnosis.power_text': 'The blood comes through him, but not strongly enough for {TARGET}.',
      'ascension.diagnosis.power_hint': 'Seek Matches that strengthen the font; what a child inherits is not promised.',
      'ascension.diagnosis.books_household_text': 'The living family has not read widely enough for {TARGET}.',
      'ascension.diagnosis.books_own_text': 'He has not read widely enough for {TARGET}.',
      'ascension.diagnosis.books_household_hint': 'Put more useful books in the hands of living family readers.',
      'ascension.diagnosis.books_own_hint': 'Have him study another spellbook.',
      'ascension.diagnosis.arts_household_text':
        'The living family does not yet carry enough different arts for {TARGET}.',
      'ascension.diagnosis.arts_own_text': 'His reading does not yet reach enough different arts for {TARGET}.',
      'ascension.diagnosis.arts_household_hint': 'Spread the missing arts among living family readers.',
      'ascension.diagnosis.arts_own_hint': 'Choose a spellbook from an affinity he has not learned.',
      'ascension.diagnosis.respect_text': 'The house is not yet held in enough regard for {TARGET}.',
      'ascension.diagnosis.respect_hint': "Raise the house's Respect before asking the world to tolerate this step.",
      'ascension.diagnosis.cost_text': 'The blood has not marked him deeply enough for {TARGET}.',
      'ascension.diagnosis.cost_hint': 'The upper ladder opens through costly Awakenings and rites, not study alone.',
      'ascension.diagnosis.overborne_text': 'His mind cannot safely bear what the blood has already done to him.',
      'ascension.diagnosis.overborne_hint': 'Do not press him higher until the line can carry more Mind.',
      'ascension.diagnosis.awakening_text': 'The blood is in him, but it has not awakened.',
      'ascension.diagnosis.awakening_hint': 'Keep him in view for an Awakening; study cannot supply this step.',
      'ascension.diagnosis.no_expresser_text': 'The blood does not answer through him.',
      'ascension.diagnosis.no_expresser_hint': 'The house must look to another living man of the blood.',
      'ascension.diagnosis.house_no_expresser_text': 'No living man of the house can express the blood.',
      'ascension.diagnosis.house_no_expresser_hint':
        'Seek a Match that could carry the font back into the line; no child is promised.',
    });
  });

  it('keys every upper-rung diagnosis (#828)', () => {
    expect(texts(true)).toEqual({
      'ascension.diagnosis.vessel_mind_text': 'His mind is not yet wide enough for what the Vessel would put into it.',
      'ascension.diagnosis.vessel_mind_hint': 'Strengthen Mind in the bloodline before committing him to this step.',
      'ascension.diagnosis.vessel_rite_text': "The Vessel's price has not been paid.",
      'ascension.diagnosis.vessel_rite_hint':
        'Call the Vessel rite when the house is ready to give a willing member of the blood.',
      'ascension.diagnosis.regalia_text': 'The Regalia are still divided.',
      'ascension.diagnosis.regalia_hint': 'Recover the missing Regalia before attempting the next rite.',
      'ascension.diagnosis.great_rite_text': 'The Great Rite still stands between him and {TARGET}.',
      'ascension.diagnosis.great_rite_hint':
        'Call the Great Rite, sanctioned or defied, when its other costs are ready.',
      'ascension.diagnosis.circle_books_text':
        'The living family has not read enough of the library for the final circle.',
      'ascension.diagnosis.circle_books_hint': 'Put more books into the hands of living family readers.',
      'ascension.diagnosis.circle_pairs_text':
        'The living family cannot yet carry every opposed pair into the final circle.',
      'ascension.diagnosis.circle_pairs_hint': 'Spread the missing affinities across living family readers.',
      'ascension.diagnosis.god_floor_text': 'The blood has not brought him close enough to ruin for {TARGET}.',
      'ascension.diagnosis.god_floor_hint':
        'The upper ladder opens through costly Awakenings and rites, not study alone.',
      'ascension.diagnosis.god_overflow_text': 'His mind cannot safely bear what the final working would ask of him.',
      'ascension.diagnosis.god_overflow_hint':
        'Do not attempt the final step until Mind can bear what the blood has done.',
      'ascension.diagnosis.clauses_text': 'The Ledger is not complete enough for the last working.',
      'ascension.diagnosis.clauses_hint': 'Recover more Ledger clauses before attempting the final step.',
      'ascension.diagnosis.elder_text': 'The final circle still lacks the elder it must spend.',
      'ascension.diagnosis.elder_hint': 'Prepare a separate two-rite elder, then call the Unmaking for this ascendant.',
    });
  });

  type Mode = 'original' | 'plainenglish';
  function prepare(mode: Mode, seed: number): SimCtx {
    const ctx = testWorld(bundle, seed);
    setProseVariants(ctx, keyed.map((entry) => ({
      address: entry.address, of: proseOriginalHash(entry.text), plainenglish: `plain: ${entry.text}`,
    })));
    setProseMode(ctx, mode);
    return ctx;
  }
  /** A man who clears every gate below God, so the god-rung blockers can be reached one at a time. */
  function ascendant(ctx: SimCtx): Person {
    ctx.world.respect = 'exalted';
    grantHeirloom(ctx, 'the_ninefold_seal');
    grantHeirloom(ctx, 'the_ring');
    grantHeirloom(ctx, 'the_rod');
    const p = place(ctx, { sex: 'male', age: 40, name: 'The Ascendant' });
    p.awakening.awakened = true;
    p.acquired[ELDRITCH_GIFT] = 400;
    p.acquired[ELDRITCH_REACH] = 400;
    p.acquired.mind = 400;
    p.madness = 95;
    for (const b of content.spellbooks) p.spellsKnown.push(b.id);
    p.rites.push('vessel', 'great_rite');
    p.phenotype = undefined;
    return p;
  }
  const plain = <T extends { text: string; hint: string }>(b: T): T =>
    ({ ...b, text: `plain: ${b.text}`, hint: `plain: ${b.hint}` });

  it('reads a blocked standing in Plain English and blocks it on the same gate (#827, #828)', () => {
    const read = (mode: Mode) => {
      const ctx = prepare(mode, 8212);
      const him = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)
        .find((p) => phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch.canExpress)!;
      him.awakening = { ...him.awakening, awakened: false };
      const her = place(ctx, { sex: 'female', age: 30 });
      const short = ascendant(ctx);
      ctx.world.clausesRecovered.clear();
      const waiting = standingOf(ctx, short);
      for (let i = 0; i < 7; i++) ctx.world.clausesRecovered.add(`clause_${i}`);
      return [standingOf(ctx, him), standingOf(ctx, her), waiting, standingOf(ctx, short)]
        .map(({ rung, blocker, blocked, diagnosis }) => ({ rung, blocker, blocked, diagnosis }));
    };
    const original = read('original');
    expect(original.map((s) => s.blocker)).toEqual(['awakening', 'no-expresser', 'clauses', 'rite']);
    expect(original.map((s) => s.diagnosis!.blockers[0]!.text)).toEqual([
      'The blood is in him, but it has not awakened.',
      'The blood does not answer through him.',
      'The Ledger is not complete enough for the last working.',
      'The final circle still lacks the elder it must spend.',
    ]);
    expect(read('plainenglish')).toEqual(original.map((s) => ({
      ...s, diagnosis: { ...s.diagnosis!, blockers: s.diagnosis!.blockers.map(plain) },
    })));
  });

  it('reads a house with nobody to climb in Plain English (#827)', () => {
    const empty = { foremost: undefined } as unknown as HouseAscension;
    const original = diagnoseHouseAscension(prepare('original', 8213), empty)!;
    expect(original.blockers[0]!.text).toBe('No living man of the house can express the blood.');
    expect(diagnoseHouseAscension(prepare('plainenglish', 8213), empty))
      .toEqual({ ...original, blockers: original.blockers.map(plain) });
  });
});

describe('the rung titles speak the reader\'s setting (#832)', () => {
  const keyed = coreMessageEntries(readFileSync(new URL('./ascension.ts', import.meta.url), 'utf8'))
    .filter((entry) => /#ascension\.rung(\.|_reached_title|_reached_somebody)/.test(entry.address));

  it('keys all seven titles, the Vessel page title and the nameless climber', () => {
    expect(Object.fromEntries(keyed.map((entry) => [entry.address.split('#')[1], entry.text]))).toEqual({
      'ascension.rung.none': 'unwoken',
      'ascension.rung.touched': 'Touched',
      'ascension.rung.adept': 'Adept',
      'ascension.rung.hierophant': 'Hierophant',
      'ascension.rung.vessel': 'the Vessel',
      'ascension.rung.demigod': 'Demigod',
      'ascension.rung.god': 'God',
      'ascension.rung_reached_title_vessel': 'The Vessel',
      'ascension.rung_reached_somebody': 'Somebody of the house',
    });
  });

  it('names every rung, the standing and the diagnosis target in Plain English, on the same rungs', () => {
    const read = (mode: 'original' | 'plainenglish') => {
      const ctx = testWorld(bundle, 8212);
      setProseVariants(ctx, keyed.map((entry) => ({
        address: entry.address, of: proseOriginalHash(entry.text), plainenglish: `plain: ${entry.text}`,
      })));
      setProseMode(ctx, mode);
      const him = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)
        .find((p) => phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch.canExpress)!;
      him.awakening = { ...him.awakening, awakened: false };
      const standing = standingOf(ctx, him);
      const view = viewOf(ctx).ascension;
      return {
        titles: RUNGS.map((r) => rungTitle(ctx, r)),
        target: [standing.rung, standing.diagnosis!.target, standing.diagnosis!.targetTitle],
        view: [view.rung, view.title, view.best, view.bestTitle],
      };
    };
    const original = read('original');
    expect(original.titles).toEqual(['unwoken', 'Touched', 'Adept', 'Hierophant', 'the Vessel', 'Demigod', 'God']);
    const plain = read('plainenglish');
    expect(plain.titles).toEqual(original.titles.map((t) => `plain: ${t}`));
    expect(plain.target).toEqual([original.target[0], original.target[1], `plain: ${original.target[2]}`]);
    expect(plain.view).toEqual([original.view[0], `plain: ${original.view[1]}`, original.view[2], `plain: ${original.view[3]}`]);
  });
});
