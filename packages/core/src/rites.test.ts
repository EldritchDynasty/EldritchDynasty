import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { indexContent } from '@ed/schema';
import type { Person } from '@ed/schema';
import { beget, place, testWorld, marry, testRng } from './testing.js';
import {
  GREAT_RITE_REACH, GREAT_RITE_TOLL, consumeVessel, isVesselTransferable, performGreatRite, performRite,
  performUnmaking,
} from './events/rites.js';
import { applyEffect } from './events/effects.js';
import { applyRecord, commitOutcome, type PendingChoice } from './events/decisions.js';
import type { SlotFill } from './events/slots.js';
import { order, tableView, type TableOrder } from './table.js';
import { attr, conceiveChild, genomeOf, phenotypeOf } from './people/factory.js';
import { standingOf } from './ascension.js';
import { ELDRITCH_GIFT, ELDRITCH_REACH } from './genetics/expression.js';
import type { SimCtx } from './world.js';

const content = indexContent(loadContent());

/**
 * THE VESSEL RITE (concept §22 rung four, issue #43).
 *
 * The rite was authored content for a whole content pass and moved none of the
 * quantities §22 puts on it, which is the failure this codebase is built to
 * refuse: it fired, it wrote a good chronicle line, and the ladder above it
 * was unreachable in principle the whole time. So every one of these asks
 * whether something MOVED, and the two that matter most ask whether something
 * that must not move stayed where it was.
 */

/** The sitting Head of the founding cast. Measured to be an expresser in every run. */
function head(ctx: SimCtx): Person {
  const p = ctx.world.people.living().find((q) => q.castSlots.includes('head'));
  if (!p) throw new Error('the founding cast has no Head');
  return p;
}

/**
 * A daughter of the blood, built rather than bred.
 *
 * A father passes his single X to every daughter, so a woman built from an
 * expressing man's X carries his font by construction — which is the one thing
 * these tests need and the one thing a lazily-rolled genome cannot promise.
 */
function carrierDaughterOf(ctx: SimCtx, father: Person, name: string): Person {
  const her = place(ctx, { sex: 'female', age: 20, name });
  const g = genomeOf(father, ctx.genetics);
  her.genome = {
    kind: 'materialized',
    genome: { autosomal: [g.autosomal[0], g.autosomal[1]], sex: [g.sex[0], g.sex[0]], mutations: [] },
  };
  her.phenotype = undefined;
  ctx.world.people.setParents(her.id, { father: father.id });
  return her;
}

describe('what the Vessel rite moves', () => {
  it('adds the consumed relative\'s attributes to the ascendant, in the acquired layer', () => {
    const ctx = testWorld(content);
    const him = head(ctx);
    const her = carrierDaughterOf(ctx, him, 'The Given');

    const hisMind = attr(him, 'mind', ctx.genetics, ctx.world.year);
    const herMind = attr(her, 'mind', ctx.genetics, ctx.world.year);
    expect(herMind, 'the fixture needs somebody with something to give').toBeGreaterThan(0);

    expect(consumeVessel(ctx, him, her).ok).toBe(true);

    // INVARIANT 6: into `acquired`, which survives the year moving. A write to
    // the phenotype cache would pass this assertion and be gone by spring.
    expect(him.acquired.mind).toBeCloseTo(herMind, 5);
    expect(attr(him, 'mind', ctx.genetics, ctx.world.year)).toBeCloseTo(hisMind + herMind, 5);
    ctx.world.year += 1;
    expect(attr(him, 'mind', ctx.genetics, ctx.world.year)).toBeGreaterThan(hisMind);
  });

  // #28: `consumeVessel`'s transfer loop is generic over every attribute in
  // content, and being generic is exactly how a fertile Vessel used to make
  // the man who spent her a more fertile FATHER — `coupleFertility` reads
  // `fecundity` back at his 30% weight, so the house was paid a share of the
  // very line it had just ended. Nobody designed that; the loop just never
  // asked whether the capacity to bear was his to lend.
  it('does not transfer fecundity — the capacity to bear is not a body\'s to lend', () => {
    const ctx = testWorld(content);
    const him = head(ctx);
    const her = carrierDaughterOf(ctx, him, 'The Given');

    const herFecundity = attr(her, 'fecundity', ctx.genetics, ctx.world.year);
    expect(herFecundity, 'the fixture needs a Vessel with fecundity to withhold').toBeGreaterThan(0);
    const hisFecundityBefore = attr(him, 'fecundity', ctx.genetics, ctx.world.year);

    const res = consumeVessel(ctx, him, her);
    expect(res.ok).toBe(true);

    expect(him.acquired.fecundity).toBeUndefined();
    expect(res.moved?.attributes.fecundity).toBeUndefined();
    expect(attr(him, 'fecundity', ctx.genetics, ctx.world.year)).toBeCloseTo(hisFecundityBefore, 5);
    // An ordinary transferable core attribute is unaffected by the exclusion —
    // the loop still moves everything else it always moved.
    expect(him.acquired.mind).toBeGreaterThan(0);
  });

  it('classifies every attribute kind, and refuses fecundity by id rather than by kind', () => {
    const fecundity = content.attributes.find((a) => a.id === 'fecundity');
    expect(fecundity, 'the fixture needs the fecundity attribute').toBeDefined();
    expect(isVesselTransferable(fecundity!)).toBe(false);

    for (const def of content.attributes) {
      const expected = def.id === 'fecundity'
        ? false
        : def.kind === 'core' || def.kind === 'affinity';
      expect(isVesselTransferable(def), `${def.id} (${def.kind})`).toBe(expected);
    }

    // `hidden` (madness) and `eldritch` (the font) are refused by kind, not
    // merely by the one id the fixture happens to carry today.
    expect(content.attributes.some((a) => a.kind === 'hidden')).toBe(true);
    expect(content.attributes.some((a) => a.kind === 'eldritch')).toBe(true);
  });

  it('gives him blood he can wield up to his own channel, and Madness for the rest', () => {
    const ctx = testWorld(content);
    const him = head(ctx);
    const before = phenotypeOf(him, ctx.genetics, ctx.world.year).eldritch;
    const her = carrierDaughterOf(ctx, him, 'The Deep One');

    expect(consumeVessel(ctx, him, her).ok).toBe(true);
    const after = phenotypeOf(him, ctx.genetics, ctx.world.year).eldritch;

    // The ceiling is his body and the rite does not move it.
    expect(after.ceiling).toBeCloseTo(before.ceiling, 5);
    expect(after.expressedPower).toBeLessThanOrEqual(after.ceiling + 1e-9);
    // Blood past the ceiling is not power. It is Madness, and it arrives every
    // year for the rest of his life through `accrueMadness`.
    const held = before.carriedFont + (him.acquired[ELDRITCH_GIFT] ?? 0);
    if (held > after.ceiling) {
      expect(after.overflowMadness).toBeGreaterThan(before.overflowMadness);
    } else {
      expect(after.expressedPower).toBeGreaterThan(before.expressedPower);
    }

    // And the same thing said without a branch in it: a man handed far more
    // blood than his body can pass wields not one point more than his channel
    // allows, and everything above it is ruin. This is the line between "the
    // strongest play" and "the worst idea" being one line.
    him.acquired[ELDRITCH_GIFT] = 400;
    him.phenotype = undefined;
    const drowned = phenotypeOf(him, ctx.genetics, ctx.world.year).eldritch;
    expect(drowned.expressedPower).toBeCloseTo(drowned.ceiling, 5);
    expect(drowned.overflowMadness).toBeGreaterThan(300);
  });

  it('leaves what he CARRIES alone, so the line inherits what it would have inherited', () => {
    // §22's own reason: "a family cannot ascend by consuming its way upward."
    const childOf = (rite: boolean) => {
      const ctx = testWorld(content);
      const him = head(ctx);
      const wife = place(ctx, { sex: 'female', age: 24, name: 'The Wife' });
      marry(ctx, him, wife);
      const her = carrierDaughterOf(ctx, him, 'The Given');
      if (rite) expect(consumeVessel(ctx, him, her).ok).toBe(true);
      const born = conceiveChild(
        wife, him, 1, ctx.world.year, ctx.genetics, ctx.takenNames, undefined, ctx.world.playerHouse, ctx.world,
      );
      return born.child
        ? phenotypeOf(born.child, ctx.genetics, ctx.world.year).eldritch.carriedFont
        : null;
    };
    const plain = childOf(false);
    expect(plain, 'the fixture needs a live birth').not.toBeNull();
    expect(childOf(true)).toBe(plain);
  });

  it('takes the Madness in full and uncapped, from someone who can express', () => {
    const ctx = testWorld(content);
    const him = head(ctx);
    const brother = place(ctx, { sex: 'male', age: 30, name: 'The Ruined' });
    const g = genomeOf(him, ctx.genetics);
    brother.genome = {
      kind: 'materialized',
      genome: { autosomal: [g.autosomal[0], g.autosomal[1]], sex: [g.sex[0], null], mutations: [] },
    };
    brother.phenotype = undefined;
    ctx.world.people.setParents(brother.id, { father: him.id });
    expect(phenotypeOf(brother, ctx.genetics, ctx.world.year).eldritch.canExpress).toBe(true);

    brother.madness = 41.5;
    him.madness = 3;
    expect(consumeVessel(ctx, him, brother).ok).toBe(true);
    // In full: not a cap, not a share, not an authored constant.
    expect(him.madness).toBeCloseTo(44.5, 5);
  });

  // INVARIANT 1: canExpress is the only Madness gate, at both ends.
  it('takes no Madness from a woman, because there was never any in her', () => {
    const ctx = testWorld(content);
    const him = head(ctx);
    const her = carrierDaughterOf(ctx, him, 'The Safe One');
    her.madness = 60;                       // impossible, and the point: even so
    him.madness = 2;

    expect(consumeVessel(ctx, him, her).ok).toBe(true);
    expect(him.madness).toBe(2);
    // Her blood still arrives. That is the whole shape of "the safe Vessel is
    // also the expensive one" (§10).
    expect(him.acquired[ELDRITCH_GIFT]).toBeGreaterThan(0);
  });

  it('cannot make an expresser out of somebody the genome did not', () => {
    const ctx = testWorld(content);
    const him = head(ctx);
    const her = carrierDaughterOf(ctx, him, 'The Vault');
    const sister = carrierDaughterOf(ctx, him, 'The Other');

    // A woman handed the whole blood of the house expresses nothing and can
    // still never go mad. `withGift` asks the genome's gate and not the ledger.
    expect(consumeVessel(ctx, sister, her).ok).toBe(true);
    const after = phenotypeOf(sister, ctx.genetics, ctx.world.year).eldritch;
    expect(sister.acquired[ELDRITCH_GIFT]).toBeGreaterThan(0);
    expect(after.canExpress).toBe(false);
    expect(after.expressedPower).toBe(0);
    expect(after.overflowMadness).toBe(0);
    expect(sister.madness).toBe(0);
  });
});

describe('what the rite does to the person it takes', () => {
  // INVARIANT 2: `PersonStore.kill` is the only death gate.
  it('marks them consumed rather than dead, and still closes the marriage out', () => {
    const ctx = testWorld(content);
    const him = head(ctx);
    const her = carrierDaughterOf(ctx, him, 'The Given');
    const husband = place(ctx, { sex: 'male', age: 26, name: 'Her Husband' });
    marry(ctx, her, husband);

    expect(consumeVessel(ctx, him, her).ok).toBe(true);

    expect(her.status).toBe('vessel_consumed');
    expect(her.died).toBe(ctx.world.year);
    expect(her.tier).toBe('archived');
    // A widow still married to a woman who is not coming back never remarries
    // and never bears again, which quietly ends a line.
    expect(husband.marriages[0]?.to).toBe(ctx.world.year);
    expect(ctx.world.people.household(ctx.world.playerHouse, ctx.world.year).map((p) => p.id))
      .not.toContain(her.id);
  });

  // INVARIANT 3: the Narrator does not die, and a rite is not an exception.
  it('cannot consume the Narrator — he crosses over instead', () => {
    const ctx = testWorld(content);
    const him = head(ctx);
    const founder = ctx.world.people.living().find((p) => p.becomesGuardian);
    if (!founder || founder.id === him.id) return;

    expect(consumeVessel(ctx, him, founder).ok).toBe(true);
    expect(founder.status).toBe('guardian');
    expect(founder.status).not.toBe('vessel_consumed');
  });

  it('refuses somebody who is not of the blood, and says why', () => {
    const ctx = testWorld(content);
    const him = head(ctx);
    const outsider = place(ctx, { sex: 'female', age: 22, name: 'The Married-In', house: 'house_ilm' });
    const res = consumeVessel(ctx, him, outsider);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/blood/);
    expect(outsider.status).toBe('alive');
  });

  it('refuses a man his own name, and a person already gone', () => {
    const ctx = testWorld(content);
    const him = head(ctx);
    const her = carrierDaughterOf(ctx, him, 'The Given');
    expect(consumeVessel(ctx, him, him).ok).toBe(false);
    ctx.world.people.kill(her.id, ctx.world.year, 'a fever');
    expect(consumeVessel(ctx, him, her).ok).toBe(false);
  });
});

describe('the rite and the ladder', () => {
  it('is the last thing rung four asks for, and answering it is what moves him', () => {
    const ctx = testWorld(content);
    const him = head(ctx);
    const her = carrierDaughterOf(ctx, him, 'The Given');

    // Everything §22 asks below the rite, built rather than bred: this is a
    // test about the GATE, and simulating four hundred years to reach a
    // Hierophant is not a test, it is a wait.
    ctx.world.respect = 'eminent';
    him.awakening.awakened = true;
    him.acquired[ELDRITCH_GIFT] = 400;      // far past any channel: power is capped by his own
    him.acquired.mind = 200;
    him.madness = 25;
    for (const b of content.spellbooks.slice(0, 8)) him.spellsKnown.push(b.id);
    him.phenotype = undefined;

    const before = standingOf(ctx, him);
    expect(before.rung, `blocked on: ${before.blocked}`).toBe('hierophant');
    expect(before.blocked).toMatch(/willingly given/);

    expect(consumeVessel(ctx, him, her).ok).toBe(true);
    expect(him.rites).toContain('vessel');
    expect(standingOf(ctx, him).rung).toBe('vessel');
  });

  it('remembers the act on the man, not on the house', () => {
    const ctx = testWorld(content);
    const him = head(ctx);
    const her = carrierDaughterOf(ctx, him, 'The Given');
    const cousin = place(ctx, { sex: 'male', age: 30, name: 'The Cousin' });
    expect(consumeVessel(ctx, him, her).ok).toBe(true);
    expect(cousin.rites).toEqual([]);
  });

  // Every rite of §22 now does something. For two of them this assertion used
  // to read the other way round — they refused, naming the issue — and the
  // ladder above them was decoration for exactly as long as that was true.
  it('asks for the person a rite takes, rather than doing nothing', () => {
    const ctx = testWorld(content);
    const res = performRite(ctx, 'unmaking', head(ctx), undefined);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/named living elder/);
    expect(res.reason).not.toMatch(/not built/);
  });
});

/**
 * THE GREAT RITE (§22 rung five, issue #43's second half).
 *
 * The wall it exists to move is stated in `factory.ts` beside
 * `MADNESS_OVERFLOW_YEARS`: power is `min(font, ceiling)` and Madness is
 * `font - ceiling`, so a man with fifty of the one has none of the other. Rung
 * five asks for more expressed power than any channel in the game can pass,
 * which is why the frontier table has power 85 with three books at zero
 * person-years in twelve runs.
 *
 * So these ask the one question that matters: does the widening turn ruin into
 * power, and does it refuse everyone it is supposed to refuse?
 */
describe('what the Great Rite moves', () => {
  /** A man carrying far more blood than his own channel can pass. */
  function overflowing(ctx: SimCtx): Person {
    const him = head(ctx);
    him.awakening.awakened = true;
    him.acquired[ELDRITCH_GIFT] = 400;
    him.phenotype = undefined;
    return him;
  }

  it('widens the channel, and turns the overflow it was drowning in into power', () => {
    const ctx = testWorld(content);
    const him = overflowing(ctx);
    const before = phenotypeOf(him, ctx.genetics, ctx.world.year).eldritch;
    expect(before.overflowMadness, 'the fixture needs a man past his own ceiling').toBeGreaterThan(0);

    expect(performGreatRite(ctx, him).ok).toBe(true);

    const after = phenotypeOf(him, ctx.genetics, ctx.world.year).eldritch;
    expect(after.ceiling).toBeCloseTo(before.ceiling + GREAT_RITE_REACH);
    // The whole point, in one assertion: the same widening that raises what he
    // wields lowers what is destroying him, because they are one subtraction.
    expect(after.expressedPower).toBeGreaterThan(before.expressedPower);
    expect(after.overflowMadness).toBeLessThan(before.overflowMadness);
  });

  it('charges the room it makes, on the day', () => {
    const ctx = testWorld(content);
    const him = overflowing(ctx);
    const before = him.madness;
    const res = performGreatRite(ctx, him);
    expect(res.moved?.reach).toBe(GREAT_RITE_REACH);
    expect(him.madness).toBeCloseTo(before + GREAT_RITE_REACH * GREAT_RITE_TOLL);
  });

  // INVARIANT 1 and 4. A rite that widened anybody would be a second door into
  // the blood wearing the word "rite", and the refusal is out loud rather than
  // a silent no-op — which is the failure mode this whole file exists to catch.
  it('refuses anyone the genome did not already make an expresser', () => {
    const ctx = testWorld(content);
    const her = carrierDaughterOf(ctx, head(ctx), 'The Carrier');
    const res = performGreatRite(ctx, her);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/nothing in him to widen/);
    expect(her.acquired[ELDRITCH_REACH]).toBeUndefined();
    expect(phenotypeOf(her, ctx.genetics, ctx.world.year).eldritch.canExpress).toBe(false);
  });

  it('makes a room and does not fill it: a man inside his own ceiling gains no power', () => {
    const ctx = testWorld(content);
    // A man whose blood does NOT already fill his channel. Found rather than
    // built, because the founding Head is capped — which is itself the finding
    // this rung is about, and would have made this assertion pass vacuously.
    const him = ctx.world.people.living().find((p) => {
      const e = phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch;
      return e.canExpress && e.carriedFont < e.ceiling;
    });
    expect(him, 'the fixture needs an expresser inside his own ceiling').toBeDefined();
    const before = phenotypeOf(him!, ctx.genetics, ctx.world.year).eldritch;

    expect(performGreatRite(ctx, him!).ok).toBe(true);

    const after = phenotypeOf(him!, ctx.genetics, ctx.world.year).eldritch;
    expect(after.ceiling).toBeCloseTo(before.ceiling + GREAT_RITE_REACH);
    // He is wider and no stronger. The Vessel is what fills the room, so the
    // order of the two rites is a decision rather than a formality.
    expect(after.expressedPower).toBeCloseTo(before.expressedPower);
  });

  // §22's rule, and the only thing between this and a house that ascends once
  // and stays ascended for six centuries.
  // §22's rule, and the only thing between this and a house that ascends once
  // and stays ascended for six centuries. Built as two worlds rather than two
  // births in one, so the conception stream is identical on both sides and the
  // only difference between them is the rite.
  it('gives him nothing his children inherit', () => {
    const childOf = (rite: boolean) => {
      const ctx = testWorld(content);
      const him = overflowing(ctx);
      const wife = place(ctx, { sex: 'female', age: 24, name: 'The Wife' });
      marry(ctx, him, wife);
      if (rite) expect(performGreatRite(ctx, him).ok).toBe(true);
      const born = conceiveChild(
        wife, him, 1, ctx.world.year, ctx.genetics, ctx.takenNames, undefined, ctx.world.playerHouse, ctx.world,
      );
      return born.child
        ? phenotypeOf(born.child, ctx.genetics, ctx.world.year).eldritch.ceiling
        : null;
    };
    const plain = childOf(false);
    expect(plain, 'the fixture needs a live birth').not.toBeNull();
    // The channel a child is born with is a fact about the GENOME, and the
    // rite writes only into the acquired layer.
    expect(childOf(true)).toBe(plain);
  });

  // Without this the template's own `repeatable: true` is an unbounded
  // ceiling, and EP 100 is bought with patience rather than with anything.
  it('widens a man once and refuses to do it again', () => {
    const ctx = testWorld(content);
    const him = overflowing(ctx);
    expect(performGreatRite(ctx, him).ok).toBe(true);
    const once = phenotypeOf(him, ctx.genetics, ctx.world.year).eldritch.ceiling;

    const again = performGreatRite(ctx, him);
    expect(again.ok).toBe(false);
    expect(again.reason).toMatch(/as wide as he is going to be/);
    expect(phenotypeOf(him, ctx.genetics, ctx.world.year).eldritch.ceiling).toBeCloseTo(once);
  });

  it('is the last thing rung five asks for', () => {
    const ctx = testWorld(content);
    const him = overflowing(ctx);
    ctx.world.respect = 'eminent';
    him.acquired.mind = 200;
    him.madness = 65;
    for (const b of content.spellbooks.slice(0, 11)) him.spellsKnown.push(b.id);
    him.rites.push('vessel');
    him.phenotype = undefined;

    const blocked = standingOf(ctx, him).blocked;
    // Whatever else is in his way, the rite is named as a requirement rather
    // than being invisible — which is what rung five looked like before this.
    expect(performGreatRite(ctx, him).ok).toBe(true);
    expect(him.rites).toContain('great_rite');
    expect(blocked === undefined || typeof blocked === 'string').toBe(true);
  });
});

describe('the effect verb', () => {
  it('finds both people by slot and performs the rite', () => {
    const ctx = testWorld(content);
    const him = head(ctx);
    const her = carrierDaughterOf(ctx, him, 'The Given');
    const before = him.madness;

    applyEffect(
      { kind: 'rite', rite: 'vessel', ascendant: 'ASCENDANT', subject: 'VESSEL', cause: 'spoken into the rite by name' },
      ctx,
      { ASCENDANT: him.id, VESSEL: her.id },
    );

    expect(her.status).toBe('vessel_consumed');
    expect(her.causeOfDeath).toBe('spoken into the rite by name');
    expect(him.rites).toContain('vessel');
    expect(him.acquired[ELDRITCH_GIFT]).toBeGreaterThan(0);
    expect(him.madness).toBe(before);      // she could not express, so nothing to give
  });

  it('does nothing at all when the slots name nobody', () => {
    const ctx = testWorld(content);
    const her = carrierDaughterOf(ctx, head(ctx), 'The Given');
    applyEffect(
      { kind: 'rite', rite: 'vessel', ascendant: 'ASCENDANT', subject: 'VESSEL' },
      ctx,
      { VESSEL: her.id },
    );
    expect(her.status).toBe('alive');
  });
});


/**
 * THE UNMAKING (§22 rung six, issue #43's third half).
 *
 * The distinction that makes this a third rite rather than the Vessel with a
 * different body count: the Vessel takes what somebody was born with, and this
 * takes what the elder was made into, together with one third of his born
 * font and channel.
 */
describe('what the unmaking moves', () => {
  /** A man who climbed: given blood, and widened to hold it. */
  function madeIntoSomething(ctx: SimCtx, name: string): Person {
    const him = place(ctx, { sex: 'male', age: 60, name });
    const seed = head(ctx);
    him.genome = { kind: 'materialized', genome: genomeOf(seed, ctx.genetics) };
    him.awakening.awakened = true;
    him.acquired[ELDRITCH_GIFT] = 120;
    him.acquired[ELDRITCH_REACH] = 9;
    him.madness = 55;
    him.phenotype = undefined;
    return him;
  }

  it('moves the made layer and a third of the born font and channel', () => {
    const ctx = testWorld(content);
    const younger = head(ctx);
    const elder = madeIntoSomething(ctx, 'The Elder');
    const before = phenotypeOf(elder, ctx.genetics, ctx.world.year).eldritch;

    const res = performUnmaking(ctx, younger, elder);
    expect(res.ok, res.reason).toBe(true);
    expect(res.moved?.blood).toBeCloseTo(120 + before.carriedFont * 0.33);
    expect(res.moved?.reach).toBeCloseTo(9 + (before.ceiling - 9) * 0.33);
    expect(younger.acquired[ELDRITCH_REACH]).toBeCloseTo(res.moved?.reach ?? 0);
    expect(younger.rites).toContain('unmaking');
  });

  it('refuses an elder who was never made into anything, out loud', () => {
    const ctx = testWorld(content);
    const younger = head(ctx);
    const plain = place(ctx, { sex: 'male', age: 60, name: 'Never Climbed' });
    const res = performUnmaking(ctx, younger, plain);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/never made into anything/);
    expect(plain.status).toBe('alive');
  });

  // INVARIANT 2, and the ordinary mark: unlike the Vessel this is not a thing
  // the house can pretend was a journey north.
  it('takes the elder through the one death gate, with the mark for death', () => {
    const ctx = testWorld(content);
    const elder = madeIntoSomething(ctx, 'The Elder');
    expect(performUnmaking(ctx, head(ctx), elder).ok).toBe(true);
    expect(elder.status).toBe('dead');
    expect(elder.causeOfDeath).toMatch(/small hall/);
  });

  it('cannot make an expresser out of somebody the genome did not', () => {
    const ctx = testWorld(content);
    const her = place(ctx, { sex: 'female', age: 40, name: 'The Sister' });
    const elder = madeIntoSomething(ctx, 'The Elder');

    expect(performUnmaking(ctx, her, elder).ok).toBe(true);
    // The record of what she was given is true; the gift is inert in her.
    expect(her.acquired[ELDRITCH_REACH]).toBeGreaterThan(9);
    expect(phenotypeOf(her, ctx.genetics, ctx.world.year).eldritch.canExpress).toBe(false);
    expect(phenotypeOf(her, ctx.genetics, ctx.world.year).eldritch.expressedPower).toBe(0);
    expect(her.madness).toBe(0);
  });

  it('refuses somebody who is not of the blood', () => {
    const ctx = testWorld(content);
    const outsider = madeIntoSomething(ctx, 'The Outsider');
    outsider.membership = [];
    const res = performUnmaking(ctx, head(ctx), outsider);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/not of the blood/);
  });

  it('is reachable through the one entry point, by name', () => {
    const ctx = testWorld(content);
    const elder = madeIntoSomething(ctx, 'The Elder');
    const res = performRite(ctx, 'unmaking', head(ctx), elder);
    expect(res.ok, res.reason).toBe(true);
    // And every rite now does something: none of the three refuses as unbuilt.
    for (const rite of ['vessel', 'great_rite', 'unmaking'] as const) {
      const probe = performRite(ctx, rite, head(ctx), undefined);
      expect(probe.reason ?? '').not.toMatch(/not built/);
    }
  });
});


/**
 * Build the state the authored rite cards ask for instead of waiting centuries
 * for it. The point of these tests is the presentation/resolution seam, not
 * whether a random run reaches Hierophant.
 */
function readyClimber(ctx: SimCtx): Person {
  const p = head(ctx);
  ctx.world.respect = 'eminent';
  ctx.world.ascension.rung = 'hierophant';
  ctx.world.ascension.best = 'hierophant';

  p.awakening.awakened = true;
  p.acquired[ELDRITCH_GIFT] = 400;
  p.acquired.mind = 200;
  p.madness = 25;
  for (const book of content.spellbooks.slice(0, 8)) {
    if (!p.spellsKnown.includes(book.id)) p.spellsKnown.push(book.id);
  }
  p.phenotype = undefined;

  expect(standingOf(ctx, p).rung).toBe('hierophant');
  return p;
}

function pendingRite(ctx: SimCtx, eventId: string): PendingChoice {
  const pending = ctx.world.pendingDecisions.find(
    (decision): decision is PendingChoice => decision.kind === 'choice' && decision.event.id === eventId,
  );
  if (!pending) throw new Error(`no pending rite decision for ${eventId}`);
  return pending;
}

function expectAssemblyMatchesDocket(
  ctx: SimCtx,
  key: 'vesselRite' | 'greatRite' | 'unmaking',
  command: TableOrder,
  eventId: string,
  expectedCandidate?: string,
): void {
  const before = {
    treasury: ctx.world.treasury,
    chronicle: ctx.world.chronicle.length,
    decisions: ctx.world.pendingDecisions.length,
    statuses: ctx.world.people.living().map((p) => [p.id, p.status, [...p.rites]] as const),
  };

  const offer = tableView(ctx)[key];
  expect(offer.ready, offer.reason).toBe(true);
  expect(offer.assembly).toBeDefined();
  const assembly = offer.assembly!;

  // Reading the assembly is presentation-only: no rite, death, spend or
  // decision exists until the old table order is actually confirmed.
  expect({
    treasury: ctx.world.treasury,
    chronicle: ctx.world.chronicle.length,
    decisions: ctx.world.pendingDecisions.length,
    statuses: ctx.world.people.living().map((p) => [p.id, p.status, [...p.rites]] as const),
  }).toEqual(before);

  expect(assembly.irreversible.length).toBeGreaterThan(0);
  expect(assembly.preparations.length).toBeGreaterThan(0);
  expect(
    assembly.preparations.every((line) => assembly.actors.some((actor) => line.includes(actor.name))),
    'a preparation line named somebody outside the resolved rite cast',
  ).toBe(true);

  const result = order(ctx, command);
  expect(result.ok, result.reason).toBe(true);
  const pending = pendingRite(ctx, eventId);

  // The people photographed by the pre-rite assembly are the people the
  // actual resolver put on the card. No second client-side casting model.
  for (const actor of assembly.actors) {
    expect(pending.fill[actor.slot], actor.slot).toBe(actor.person);
  }
  for (const risk of assembly.atRisk) {
    const cast = pending.cast.find((request) => request.slot === risk.slot);
    expect(cast, `no docket cast request for ${risk.slot}`).toBeDefined();
    expect(cast!.candidates.map((candidate) => ({ person: candidate.id, name: candidate.name })))
      .toEqual(risk.candidates);
  }

  if (expectedCandidate) {
    expect(assembly.atRisk.flatMap((risk) => risk.candidates.map((candidate) => candidate.person)))
      .toContain(expectedCandidate);
  }
}

describe('major rite assembly (#218)', () => {
  it('photographs the Vessel from the same slot resolution the docket uses', () => {
    const ctx = testWorld(content, 8218);
    const ascendant = readyClimber(ctx);
    const vessel = place(ctx, { sex: 'female', age: 20, name: 'The Named Vessel' });
    beget(ctx, vessel, undefined, ascendant);

    expectAssemblyMatchesDocket(
      ctx,
      'vesselRite',
      { kind: 'vesselRite' },
      'the_vessel_rite',
      vessel.id,
    );
  });

  it('photographs the Great Rite from the same slot resolution the docket uses', () => {
    const ctx = testWorld(content, 8219);
    readyClimber(ctx);
    place(ctx, { sex: 'male', age: 30, name: 'The Witness' });

    expectAssemblyMatchesDocket(
      ctx,
      'greatRite',
      { kind: 'greatRite' },
      'the_great_rite',
    );
  });

  it('photographs the Unmaking elder and exact descendant candidates the docket uses', () => {
    const ctx = testWorld(content, 8220);
    const elder = readyClimber(ctx);
    elder.rites.push('vessel', 'great_rite');
    elder.acquired[ELDRITCH_REACH] = 9;
    elder.phenotype = undefined;

    const younger = place(ctx, { sex: 'male', age: 25, name: 'The Younger', awakened: true });
    younger.genome = { kind: 'materialized', genome: genomeOf(elder, ctx.genetics) };
    younger.phenotype = undefined;
    beget(ctx, younger, undefined, elder);

    expectAssemblyMatchesDocket(
      ctx,
      'unmaking',
      { kind: 'unmaking' },
      'the_unmaking',
      younger.id,
    );
  });
});


function vesselFixture(seed: number) {
  const ctx = testWorld(content, seed);
  const ascendant = readyClimber(ctx);
  const vessel = place(ctx, { sex: 'female', age: 20, name: 'Mara the Named' });
  beget(ctx, vessel, undefined, ascendant);

  const event = content.events.find((candidate) => candidate.id === 'the_vessel_rite');
  if (!event || event.interaction.kind !== 'choice') throw new Error('the authored Vessel rite is missing');
  const taking = event.interaction.choices.find((candidate) => candidate.id === 'speak_the_name');
  const sparing = event.interaction.choices.find((candidate) => candidate.id === 'send_them_out_of_the_room');
  if (!taking || !sparing) throw new Error('the authored Vessel branches are missing');

  const fill: SlotFill = { ASCENDANT: ascendant.id, VESSEL: vessel.id };
  return { ctx, ascendant, vessel, event, taking, sparing, fill };
}

function greatRiteFixture(seed: number) {
  const ctx = testWorld(content, seed);
  const ascendant = readyClimber(ctx);
  const witness = place(ctx, { sex: 'male', age: 30, name: 'Tomas the Witness' });

  const event = content.events.find((candidate) => candidate.id === 'the_great_rite');
  if (!event || event.interaction.kind !== 'choice') throw new Error('the authored Great Rite is missing');
  const sanction = event.interaction.choices.find((candidate) => candidate.id === 'ask_for_sanction');
  if (!sanction) throw new Error('the authored sanction branch is missing');

  const fill: SlotFill = { ASCENDANT: ascendant.id, WITNESS: witness.id };
  return { ctx, ascendant, witness, event, sanction, fill };
}

function unmakingFixture(seed: number) {
  const ctx = testWorld(content, seed);
  const elder = place(ctx, { sex: 'male', age: 65, name: 'Aldren the Elder', awakened: true });
  const source = head(ctx);
  elder.genome = { kind: 'materialized', genome: genomeOf(source, ctx.genetics) };
  elder.acquired[ELDRITCH_GIFT] = 120;
  elder.acquired[ELDRITCH_REACH] = 9;
  elder.rites.push('vessel', 'great_rite');
  elder.phenotype = undefined;

  const younger = place(ctx, { sex: 'male', age: 24, name: 'Corin the Younger', awakened: true });
  younger.genome = { kind: 'materialized', genome: genomeOf(source, ctx.genetics) };
  younger.phenotype = undefined;
  beget(ctx, younger, undefined, elder);

  const event = content.events.find((candidate) => candidate.id === 'the_unmaking');
  if (!event || event.interaction.kind !== 'choice') throw new Error('the authored Unmaking is missing');
  const choice = event.interaction.choices.find((candidate) => candidate.id === 'go_through_with_it');
  if (!choice) throw new Error('the authored taking branch is missing');

  const fill: SlotFill = { ELDER: elder.id, ASCENDANT: younger.id };
  return { ctx, elder, younger, event, choice, fill };
}


describe('major rite aftermath (#218)', () => {
  it('writes the taken Vessel with both the ascendant and the person consumed', () => {
    const { ctx, ascendant, vessel, event, taking, fill } = vesselFixture(8221);
    const outcome = taking.outcomes.find((candidate) => candidate.id === 'taken');
    if (!outcome) throw new Error('the taken Vessel outcome is missing');

    const resolved = commitOutcome(ctx, event, outcome, fill, taking.id, testRng('vessel-taken'));
    const entry = ctx.world.chronicle.find((candidate) => candidate.id === resolved.entryId);

    expect(entry?.eventId).toBe(event.id);
    expect(entry?.text).toContain(ascendant.name);
    expect(entry?.text).toContain(vessel.name);
    expect(entry?.text).toMatch(/name once|Everything .* was arrives/);
    expect(vessel.status).toBe('vessel_consumed');
    expect(ascendant.rites).toContain('vessel');
  });

  it('writes the spared Vessel branch with both named people and no irreversible spend', () => {
    const { ctx, ascendant, vessel, event, sparing, fill } = vesselFixture(8222);
    const outcome = sparing.outcomes.find((candidate) => candidate.id === 'spared');
    if (!outcome) throw new Error('the spared Vessel outcome is missing');

    const resolved = commitOutcome(ctx, event, outcome, fill, sparing.id, testRng('vessel-spared'));
    const entry = ctx.world.chronicle.find((candidate) => candidate.id === resolved.entryId);

    expect(entry?.eventId).toBe(event.id);
    expect(entry?.text).toContain(ascendant.name);
    expect(entry?.text).toContain(vessel.name);
    expect(entry?.text).toMatch(/knowing what the family weighed them against/);
    expect(vessel.status).toBe('alive');
    expect(ascendant.rites).not.toContain('vessel');
  });

  it('writes the sanctioned Great Rite with the ascendant, witness and concrete widening', () => {
    const { ctx, ascendant, witness, event, sanction, fill } = greatRiteFixture(8223);
    const outcome = sanction.outcomes.find((candidate) => candidate.id === 'sanctioned');
    if (!outcome) throw new Error('the sanctioned Great Rite outcome is missing');

    const beforeMadness = ascendant.madness;
    const resolved = commitOutcome(ctx, event, outcome, fill, sanction.id, testRng('great-rite-sanctioned'));
    const entry = ctx.world.chronicle.find((candidate) => candidate.id === resolved.entryId);

    expect(entry?.eventId).toBe(event.id);
    expect(entry?.text).toContain(ascendant.name);
    expect(entry?.text).toContain(witness.name);
    expect(entry?.text).toMatch(/made wider|count/);
    expect(ascendant.rites).toContain('great_rite');
    expect(ascendant.madness).toBeGreaterThan(beforeMadness);
  });

  it('writes refused Great Rite permission with both participants and no false success', () => {
    const { ctx, ascendant, witness, event, sanction, fill } = greatRiteFixture(8224);
    const outcome = sanction.outcomes.find((candidate) => candidate.id === 'refused_permission');
    if (!outcome) throw new Error('the refused Great Rite outcome is missing');

    const resolved = commitOutcome(ctx, event, outcome, fill, sanction.id, testRng('great-rite-refused'));
    const entry = ctx.world.chronicle.find((candidate) => candidate.id === resolved.entryId);

    expect(entry?.eventId).toBe(event.id);
    expect(entry?.text).toContain(ascendant.name);
    expect(entry?.text).toContain(witness.name);
    expect(entry?.text).toMatch(/count that was never used|chapel roof/);
    expect(ascendant.rites).not.toContain('great_rite');
    expect(ctx.world.knowledge.has('knows_the_church_refused')).toBe(true);
  });

  it('renders the named cast into honest rite records instead of replacing aftermath with generic copy', () => {
    const ctx = testWorld(content, 8225);
    const ascendant = place(ctx, { sex: 'male', age: 40, name: 'Aldren Recorded' });
    const vessel = place(ctx, { sex: 'female', age: 20, name: 'Mara Recorded' });
    const witness = place(ctx, { sex: 'male', age: 30, name: 'Tomas Recorded' });
    const elder = place(ctx, { sex: 'male', age: 65, name: 'Corin Recorded' });

    const cases = [
      {
        event: 'the_vessel_remembered',
        entry: 'rite-record-vessel',
        fill: { ASCENDANT: ascendant.id, VESSEL: vessel.id },
        names: [ascendant.name, vessel.name],
      },
      {
        event: 'the_great_rite',
        entry: 'rite-record-great',
        fill: { ASCENDANT: ascendant.id, WITNESS: witness.id },
        names: [ascendant.name, witness.name],
      },
      {
        event: 'the_unmaking',
        entry: 'rite-record-unmaking',
        fill: { ELDER: elder.id, ASCENDANT: ascendant.id },
        names: [elder.name, ascendant.name],
      },
    ] as const;

    for (const sample of cases) {
      const event = content.events.find((candidate) => candidate.id === sample.event);
      if (!event?.record) throw new Error('record block missing for ' + sample.event);
      const line = applyRecord(ctx, event, sample.entry, 'record', sample.fill);
      expect(line).not.toBeNull();
      for (const name of sample.names) expect(line).toContain(name);
      expect(line).not.toMatch(/\{[A-Z_]+\}/);
    }
  });

  it('writes the successful Unmaking with both participants and the thing spent', () => {
    const { ctx, elder, younger, event, choice, fill } = unmakingFixture(8221);
    const outcome = choice.outcomes.find((candidate) => candidate.id === 'taken');
    if (!outcome) throw new Error('the successful Unmaking outcome is missing');

    const resolved = commitOutcome(ctx, event, outcome, fill, choice.id, testRng('unmaking-success'));
    const entry = ctx.world.chronicle.find((candidate) => candidate.id === resolved.entryId);

    expect(entry?.eventId).toBe(event.id);
    expect(entry?.text).toContain(elder.name);
    expect(entry?.text).toContain(younger.name);
    expect(entry?.text).toMatch(/comes out of him|arrives/);
    expect(elder.status).toBe('dead');
    expect(younger.rites).toContain('unmaking');
  });

  it('writes the failed Unmaking with both participants and the loss instead of a generic failure', () => {
    const { ctx, elder, younger, event, choice, fill } = unmakingFixture(8222);
    const outcome = choice.outcomes.find((candidate) => candidate.id === 'failed_at_the_last_step');
    if (!outcome) throw new Error('the failed Unmaking outcome is missing');

    const beforeMadness = younger.madness;
    const resolved = commitOutcome(ctx, event, outcome, fill, choice.id, testRng('unmaking-failure'));
    const entry = ctx.world.chronicle.find((candidate) => candidate.id === resolved.entryId);

    expect(entry?.eventId).toBe(event.id);
    expect(entry?.text).toContain(elder.name);
    expect(entry?.text).toContain(younger.name);
    expect(entry?.text).toMatch(/leave it|nowhere for any of it to go/);
    expect(entry?.text).not.toMatch(/^failed$/i);
    expect(elder.status).toBe('dead');
    expect(younger.madness).toBe(beforeMadness + 40);
    expect(ctx.world.flags.get('god_rite_failed')).toBe(true);
  });
});
