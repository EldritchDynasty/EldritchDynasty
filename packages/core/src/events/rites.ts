import type { AttributeDef, AttributeKind, Person, Rite } from '@ed/schema';
import { assertNever } from '@ed/schema';
import type { SimCtx } from '../world.js';
import { attr, phenotypeOf } from '../people/factory.js';
import { ELDRITCH_GIFT, ELDRITCH_REACH } from '../genetics/expression.js';
import { noteDemigodAttainment } from '../ascension.js';

/**
 * THE RITES OF THE LADDER (concept §22, issue #43).
 *
 * Three of the six rungs are not measurements. §22 gates them on an act — the
 * Vessel's living sacrifice, the Great Rite the Church sanctions or is defied
 * over, and the unmaking of a living two-rite Hierophant — and `ascension.ts` has said so
 * since it shipped: *"rungs four and up therefore gate on everything §22 asks
 * for EXCEPT the rite itself, and `rungGate` names the rite as the last
 * requirement so nothing pretends the ladder is finished."*
 *
 * This is where the acts live. They are in the ENGINE and not in content
 * because what a rite does is a rule about bodies and blood, the way `kill`
 * and `conceiveChild` are: an author decides whether the house is asked, on
 * what terms, in what words, and what the record says afterwards. Any of that
 * is a decision. How much of a consumed woman arrives in the man who consumed
 * her is not.
 *
 * ─── What was there before ──────────────────────────────────────────────────
 *
 * `the_vessel_rite` has been in `events/rites.yaml` since the content pass,
 * and it said all of this in prose. Mechanically it was a `status` effect and
 * a flat `madness: 35`:
 *
 *   - nobody's attributes moved, so §22's *"their attributes are added to the
 *     ascendant's"* was a sentence in a body;
 *   - the Vessel's OWN Madness went nowhere, so *"transfers in full and
 *     uncapped"* was decoration and the safe-versus-gifted choice the event
 *     offers was two flavours of the same outcome;
 *   - `status: vessel_consumed` was written straight onto the person, which is
 *     a second death gate wearing a different word (invariant 2) — no marriage
 *     was closed out, no archive, and the Narrator would have been consumable;
 *   - and the man was left exactly as far from rung four as he had been before
 *     he consumed a relative to reach it.
 *
 * Which is invariant 11 in its purest form: a declared thing nothing read. It
 * typechecked, it fired, it wrote a good chronicle line, and the ladder above
 * it was unreachable in principle for as long as it stood.
 */

export interface RiteOutcome {
  ok: boolean;
  /** Why not, for a caller that wants to say so. Never thrown. */
  reason?: string;
  /** What actually moved, so a test and a report can name it. */
  moved?: {
    attributes: Record<string, number>;
    blood: number;
    madness: number;
    /** How much wider his channel is, where the rite widens one. */
    reach?: number;
  };
}

/**
 * THE VESSEL (§22, rung four).
 *
 * > A living family member of the blood, willingly given. Named, chosen by the
 * > player from the tree. Consumed. Their attributes are added to the
 * > ascendant's. The tree shows them greyed, with a mark that is not the mark
 * > for death.
 *
 * Four rules hold this together, and every one of them is load-bearing:
 *
 * **What he gains, he cannot pass on.** Everything lands in `Person.acquired`,
 * which `conceiveChild` never reads — a child is drawn from the GENOME, and
 * the genome is not touched here. That is §22's own reason: *"a family cannot
 * ascend by consuming its way upward; every generation has to be bred, and the
 * rite only decides who gets to spend what the breeding produced."*
 *
 * **The blood is wielded, not carried.** `carriedFont` is left alone, so what
 * the market prices and what a mother's meiosis draws from are unchanged, and
 * `withGift` raises only what the man can express — as far as his own channel
 * allows. Blood past his ceiling is not power, it is Madness. A man who
 * consumes the family's deepest carrier and has no channel to hold her buys
 * himself nothing but ruin, which is the shape §22 describes.
 *
 * **Madness transfers in full and uncapped, and only from someone who can
 * express it** (§10, invariant 1). A woman or a mundane son carries no Madness
 * to give — that is the same sentence as "she is the safe Vessel" — and the
 * gate is `canExpress` on both ends rather than a sex test.
 *
 * **`kill` is the only death gate** (invariant 2). The consumed go through it
 * like everyone else and come out the other side with a status that is not
 * `dead`, which is what the tree draws a different mark for.
 */
/**
 * WHAT A BODY CAN LEND, AND WHAT IT CANNOT (issue #28).
 *
 * The transfer loop below is generic on purpose — an attribute is six loci
 * and a row in `attributes.yaml` (invariant 10), and this file must not need
 * an edit every time content grows one. Generic is also exactly how it went
 * wrong: the loop excluded `derived` (recomputed from the body every year)
 * and `eldritch` (the font has its own explicit transfer, below) and asked
 * nothing else, so `hidden` passed straight through with no test. `madness`
 * is its only member, and it transfers as zero today for a reason that has
 * nothing to do with this function: `expressAttributes` never writes Madness
 * into the attrs map this loop reads, because it lives on `Person.madness`
 * instead. Invariant 1 was safe by ACCIDENT OF STORAGE, not by anything this
 * loop checked — give Madness a locus and it moves with no `canExpress` test,
 * eleven lines above the one that has it. Refused here, explicitly, so that
 * stops being true by luck.
 *
 * `fecundity` is the one this loop actually delivered, because it is
 * `kind: core` and nothing kind-level distinguishes it. A man who consumed a
 * fertile relative became a more fertile FATHER — `coupleFertility` reads it
 * back at his own 30% weight — so the house was paid a share of the exact
 * line it had just ended. The capacity to bear is not a body's to lend, so it
 * is refused by id rather than by kind: it is the only `core` attribute that
 * is not the ascendant's to receive.
 */
export function isVesselTransferable(def: AttributeDef): boolean {
  const transferableKind = (kind: AttributeKind): boolean => {
    switch (kind) {
      case 'core':
      case 'affinity':
        return true;
      // Recomputed from the body every year (invariant 6); the rite has
      // nothing to write that would survive the next recompute.
      case 'derived':
      // The font has its own explicit transfer below, under invariant 1's
      // gate rather than a flat copy.
      case 'eldritch':
      // Not a number the rite is allowed to move without asking why.
      case 'hidden':
        return false;
      default:
        return assertNever(kind);
    }
  };
  if (!transferableKind(def.kind)) return false;
  return def.id !== 'fecundity';
}

export function consumeVessel(
  ctx: SimCtx,
  ascendant: Person,
  vessel: Person,
  cause = 'given to the rite, and not spoken of again',
): RiteOutcome {
  const w = ctx.world;
  if (ascendant.id === vessel.id) return { ok: false, reason: 'a man cannot be his own Vessel' };

  // ONCE FOR A MAN. The template is repeatable because another climber in the
  // same house may need the rite centuries later; that must never mean this
  // ascendant can consume another relative and stack the transfer a second time.
  if (ascendant.rites.includes('vessel')) {
    return { ok: false, reason: 'he has already taken the Vessel rite' };
  }

  if (vessel.status !== 'alive') return { ok: false, reason: 'the Vessel is not living' };

  // OF THE BLOOD, and checked here rather than left to a filter. §22 says "a
  // living family member OF THE BLOOD", and the `family_member` slot role
  // casts the whole household — wives married in, wards, retainers. A rite
  // that would take any of them is a rite about the household rather than
  // about the line, and the line is the entire subject of the game.
  const ofTheBlood = w.people.blood(w.playerHouse).some((p) => p.id === vessel.id);
  if (!ofTheBlood) return { ok: false, reason: 'the Vessel is not of the blood' };

  const theirs = phenotypeOf(vessel, ctx.genetics, w.year).eldritch;
  const his = phenotypeOf(ascendant, ctx.genetics, w.year).eldritch;

  const moved: NonNullable<RiteOutcome['moved']> = { attributes: {}, blood: 0, madness: 0 };

  // Attributes, in full — everything `isVesselTransferable` allows. `derived`
  // and `hidden` attributes stay on the body they belong to, `eldritch` moves
  // below under invariant 1's gate rather than a flat copy, and `fecundity`
  // is refused by name: see `isVesselTransferable` for why each is excluded.
  for (const def of ctx.genetics.attributes) {
    if (!isVesselTransferable(def)) continue;
    const value = attr(vessel, def.id, ctx.genetics, w.year);
    if (value <= 0) continue;
    ascendant.acquired[def.id] = (ascendant.acquired[def.id] ?? 0) + value;
    moved.attributes[def.id] = value;
  }

  // The blood. Written even for a man who cannot express, and inert for him —
  // `withGift` refuses to raise anybody the genome did not already make an
  // expresser, so the record of what he was given stays true without the gift
  // ever becoming a second way to make one (invariants 1 and 4).
  if (theirs.carriedFont > 0) {
    ascendant.acquired[ELDRITCH_GIFT] = (ascendant.acquired[ELDRITCH_GIFT] ?? 0) + theirs.carriedFont;
    moved.blood = theirs.carriedFont;
  }

  // INVARIANT 1: canExpress is the only Madness gate, and it is asked of both
  // people. Nothing passes from someone who never had any; nothing arrives in
  // someone who could not hold it.
  if (theirs.canExpress && his.canExpress && vessel.madness > 0) {
    ascendant.madness += vessel.madness;
    moved.madness = vessel.madness;
  }

  // The phenotype cache is derived (invariant 6) and the year has not moved,
  // so nothing would recompute it before something read a stale one.
  if (ascendant.phenotype) ascendant.phenotype.dirty = true;

  // INVARIANT 2: the one death gate, with the mark that is not the mark for
  // death. A Vessel who happens to be the Narrator is redirected by `kill`
  // like any other death, and the rite quietly buys nothing.
  w.people.kill(vessel.id, w.year, cause, 'vessel_consumed');

  if (!ascendant.rites.includes('vessel')) ascendant.rites.push('vessel');
  return { ok: true, moved };
}

/**
 * THE GREAT RITE (§22, rung five).
 *
 * > Church sanction, or open defiance.
 *
 * What it does to a body is widen the channel. `expression.ts` carries the
 * long version of why; the short one is that power is `min(font, ceiling)` and
 * Madness is `font - ceiling`, so every rung above Hierophant asked for more
 * expressed power than any channel in the game can pass, and the frontier
 * table in `BALANCE-LOG` has power 85 with three books at **zero person-years
 * in twelve runs.** Not rare. None.
 *
 * Three properties hold this to the same rules as the Vessel:
 *
 * **It widens the room, it does not fill it.** A man with a narrow channel and
 * no blood behind it gains an empty room and nothing else — `expressedPower`
 * is still bounded by what he carries. That is what makes the two rites an
 * ORDER rather than a stack: the Vessel hands him more than he can hold and
 * the excess is pure ruin, and this turns the ruin he took on into the power
 * he took it on for. Taken the other way round it buys nothing.
 *
 * **What he gains, he cannot pass on.** `ELDRITCH_REACH` is in the acquired
 * layer, `conceiveChild` reads the genome, and the channel loci in it are
 * untouched. His sons are as wide as they were born.
 *
 * **It is charged for on the day.** The toll is Madness in proportion to the
 * room made — the rite is a violent thing done to a living mind, and a man
 * already close to his own `mind` can be finished by it. That is not a
 * decoration: `demography.ts` adds real mortality hazard above `mind` and
 * names the cause *the blood, overflowing*.
 *
 * The Madness it charges also decides WHEN the rite is worth taking, which is
 * the decision §22 wants a player to have. Rung five wants Madness of 60 and
 * no more than his mind. Taken early, the widening stops his overflow and he
 * never accrues the 60 the rung asks for. Taken late, the toll lands on a man
 * who has no room left for it. There is a window, it is his whole life wide,
 * and the house has to find it without being told where it is.
 *
 * INVARIANT 1 and 4: `canExpress` is asked and never set. The rite refuses a
 * man the genome did not already make an expresser, so this cannot become a
 * second door into the blood — and a house cannot schedule the gift by
 * widening a mundane son.
 */
export function performGreatRite(ctx: SimCtx, ascendant: Person): RiteOutcome {
  const w = ctx.world;
  if (ascendant.status !== 'alive') return { ok: false, reason: 'the ascendant is not living' };

  // ONCE FOR A MAN. §22 gives him one channel and one widening of it, and
  // without this line `repeatable: true` on the template is an unbounded
  // ceiling: two rites is EP 100 for anybody who is offered it twice, which is
  // the same free gate the REACH sweep below rejected, reached by patience
  // instead of by arithmetic.
  if (ascendant.rites.includes('great_rite')) {
    return { ok: false, reason: 'he has already been made as wide as he is going to be' };
  }

  const his = phenotypeOf(ascendant, ctx.genetics, w.year).eldritch;
  // INVARIANT 1: the one gate, asked here as everywhere. A rite that widened a
  // woman or a mundane son would be a second way into the blood wearing the
  // word "rite", and `withGift` would refuse it one layer down anyway — an
  // effect that silently does nothing is the failure this file was written to
  // stop, so it refuses out loud instead.
  if (!his.canExpress) return { ok: false, reason: 'there is nothing in him to widen' };

  const room = GREAT_RITE_REACH;
  const toll = room * GREAT_RITE_TOLL;

  ascendant.acquired[ELDRITCH_REACH] = (ascendant.acquired[ELDRITCH_REACH] ?? 0) + room;
  ascendant.madness += toll;

  // Derived, and the year has not moved (invariant 6).
  if (ascendant.phenotype) ascendant.phenotype.dirty = true;

  if (!ascendant.rites.includes('great_rite')) ascendant.rites.push('great_rite');

  // The rite can be the act that crosses Demigod, and a table-ordered rite can
  // resolve after this year's ascension phase. Remember the attainment here,
  // before authored Respect costs can make the current reading fall.
  noteDemigodAttainment(ctx, ascendant);
  return { ok: true, moved: { attributes: {}, blood: 0, madness: toll, reach: room } };
}

/**
 * How much room the Great Rite makes, in raw font units — the same scale
 * `channelCeiling` returns, so it is directly comparable to the wall it moves.
 *
 * SWEPT, not chosen, and the first value was wrong in the direction this
 * codebase is worst at noticing. A man must already stand at rung four to be
 * offered this, which puts his ceiling at raw 20.8 or better; the Vessel he
 * has taken guarantees more font than any ceiling of his can pass. So what
 * this constant buys is read straight off the EP scale, which is arithmetic
 * rather than opinion — `eldritchPower` normalises against `maxPower` (66) and
 * `ASCENT_REACH` (0.45), so EP 85 is raw 25.25 and EP 98 is raw 29.11:
 *
 *   reach |  his ceiling before the rite: 20.8   22   24   26   28
 *       0 |                                 70   74   81   88   94
 *       3 |                                 80   84   91   98  100
 *       4 |                                 84   88   94  100  100
 *       5 |                                 87   91   98  100  100
 *       9 |                                100  100  100  100  100
 *
 * At NINE, which is where this was first written, every man who takes the rite
 * arrives at 100 — God's power gate handed over for free, at every starting
 * ceiling, by one act. That is the same shape as the forty books asked of a
 * game containing twenty-one, inverted: not a gate with no key, a gate with a
 * master key. `booksFor` records the first one; this records the second.
 *
 * FOUR is the value that leaves both rungs earned. A man at the bare threshold
 * reaches 84 and does NOT make Demigod — the rite is necessary and not
 * sufficient, which is §22's own shape for a rung a house has to be built for.
 * God's power needs a ceiling of 26 before the rite, which is a man measurably
 * better than the one who merely qualified.
 */
export const GREAT_RITE_REACH = 4;

/**
 * Madness charged per unit of room, on the day.
 *
 * The rite has to cost something the house can feel, and Madness is the one
 * currency §22 lets the ladder charge in — but it is a strange currency here,
 * because rung five REQUIRES 60 of it. The toll is therefore not a deterrent;
 * it is what closes the window at the top end, so that the same quantity the
 * rung demands is the quantity that can kill the man who has too much of it.
 *
 * Ten points on a man whose window runs from 60 to his own `mind` — usually
 * just over 70 at this rung — is about a third of the room he has left, and
 * `demography.ts` charges real mortality above `mind` under a cause that names
 * what happened to him.
 */
export const GREAT_RITE_TOLL = 2.5;

/**
 * THE UNMAKING (§22, rung six).
 *
 * > The elder unmade to raise the younger, chosen or resisted, and the whole
 * > run losable at the final step.
 *
 * §22's terminal irony — rung six spends a living two-rite Hierophant for
 * a separate blood descendant, so a dynasty that concentrates everything
 * into one perfect patriarch cannot ascend — is checked in content now
 * (`events/rites.yaml`'s `the_unmaking`: Hierophant and both earlier rites
 * on ELDER, blood descent and expression on ASCENDANT). It used to be split:
 * this file took anybody who had taken a rite, and `ascension.ts`'s
 * `gateFor('god')` separately went looking for a currently-living, DIFFERENT
 * Demigod — impossible by construction, since the man this function kills is
 * the only one who could have satisfied it (issue #61). `gateFor('god')` now
 * checks the completed act, while the other God gates remain live. The
 * unmaking is how that knot is cut — the house takes the elder apart to let
 * the younger past.
 *
 * ─── What it takes, and why it is not the Vessel again ──────────────────────
 *
 * The Vessel takes what somebody was born with. The unmaking takes what the
 * elder was made into — every acquired gift and widening — plus one third
 * of his born font and channel. The latter is why this rite can raise a
 * descendant whose own blood has not yet reached God's power gate.
 *
 * It is therefore also the only rite that can move a widened channel between
 * two people. `withGift` still asks the younger's own genome whether he can
 * express any of it (invariants 1 and 4).
 *
 * ─── Losable at the final step ──────────────────────────────────────────────
 *
 * Not here. Whether the house reaches the last step is a weighted outcome in
 * content, because that is where the odds of a thing belong — this performs
 * the act that succeeds, and the failure branch is authored beside it, sets
 * `GOD_RITE_FAILED` and reaches the ending §23 wrote for it. The engine does
 * not roll: `commitOutcome` already did.
 *
 * INVARIANT 2: the elder goes through `kill()` like everyone else. Unlike the
 * Vessel he takes the ordinary mark for death, because this is not a thing the
 * house can pretend was a journey north — it happens in a hall, in front of
 * witnesses, and §23's ending is written from their point of view.
 */
export function performUnmaking(ctx: SimCtx, ascendant: Person, elder: Person): RiteOutcome {
  const w = ctx.world;
  if (ascendant.id === elder.id) return { ok: false, reason: 'a man cannot unmake himself' };
  if (ascendant.status !== 'alive') return { ok: false, reason: 'the ascendant is not living' };
  if (elder.status !== 'alive') return { ok: false, reason: 'the elder is not living' };

  const ofTheBlood = w.people.blood(w.playerHouse).some((p) => p.id === elder.id);
  if (!ofTheBlood) return { ok: false, reason: 'the elder is not of the blood' };

  // He has to have been MADE into something, or there is nothing here to take.
  const gift = elder.acquired[ELDRITCH_GIFT] ?? 0;
  const reach = elder.acquired[ELDRITCH_REACH] ?? 0;
  if (gift <= 0 && reach <= 0) {
    return { ok: false, reason: 'the elder was never made into anything the rite can take' };
  }

  const theirs = phenotypeOf(elder, ctx.genetics, w.year).eldritch;
  const his = phenotypeOf(ascendant, ctx.genetics, w.year).eldritch;
  const bornFont = Math.max(0, theirs.carriedFont);
  const bornChannel = Math.max(0, theirs.ceiling - reach);
  const movedGift = gift + bornFont * 0.33;
  const movedReach = reach + bornChannel * 0.33;
  const moved: NonNullable<RiteOutcome['moved']> = {
    attributes: {}, blood: 0, madness: 0, reach: 0,
  };

  if (movedGift > 0) {
    ascendant.acquired[ELDRITCH_GIFT] = (ascendant.acquired[ELDRITCH_GIFT] ?? 0) + movedGift;
    moved.blood = movedGift;
  }
  if (movedReach > 0) {
    ascendant.acquired[ELDRITCH_REACH] = (ascendant.acquired[ELDRITCH_REACH] ?? 0) + movedReach;
    moved.reach = movedReach;
  }

  // INVARIANT 1, asked of both ends, exactly as the Vessel asks it.
  if (theirs.canExpress && his.canExpress && elder.madness > 0) {
    ascendant.madness += elder.madness;
    moved.madness = elder.madness;
  }

  if (ascendant.phenotype) ascendant.phenotype.dirty = true;

  // INVARIANT 2, and the ordinary mark: everybody in the hall watched.
  w.people.kill(elder.id, w.year, 'unmade, in the small hall, in front of witnesses');

  if (!ascendant.rites.includes('unmaking')) ascendant.rites.push('unmaking');

  // #185's intended timing is Demigod first, Ledger later. The successful
  // transfer can create that Demigod after the annual ascension phase has
  // already run; the very next authored effect spends Respect. Latch the life
  // event while every post-rite gate is still truthfully visible.
  noteDemigodAttainment(ctx, ascendant);
  return { ok: true, moved };
}

/**
 * Perform a rite by name. The one entry point, so the effect verb, a test and
 * whatever the client eventually offers cannot disagree about what a rite is.
 *
 * All three of §22's rites do something now. The union is closed and this
 * switch ends in `assertNever`, so a fourth cannot be declared without a case;
 * and none of the three is left refusing with a reason, which is what two of
 * them did for as long as the top of the ladder was decoration
 * (`CLAUDE.md`: "a declared field that nothing reads is a bug").
 */
export function performRite(
  ctx: SimCtx,
  rite: Rite,
  ascendant: Person,
  subject: Person | undefined,
  cause?: string,
): RiteOutcome {
  switch (rite) {
    case 'vessel':
      if (!subject) return { ok: false, reason: 'the Vessel rite takes a named living relative' };
      return consumeVessel(ctx, ascendant, subject, cause);
    case 'great_rite':
      return performGreatRite(ctx, ascendant);
    case 'unmaking':
      if (!subject) return { ok: false, reason: 'the unmaking takes a named living elder' };
      return performUnmaking(ctx, ascendant, subject);
    default:
      return assertNever(rite, 'rite');
  }
}
