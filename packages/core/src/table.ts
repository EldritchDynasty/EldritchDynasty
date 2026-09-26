import type { EventTemplate, Person, RentPolicy, Year } from '@ed/schema';
import { assertNever, canBeTaught } from '@ed/schema';
import type { SimCtx } from './world.js';
import type { Rng } from './rng.js';
import { attr } from './people/factory.js';
import { beginStudy, canStudySpellbook, heldBooks, spellbookDef } from './people/library.js';
import { filePedigree, papersHeld, PEDIGREE_COVERS, PEDIGREE_PRICE, type PedigreeGrade } from './people/papers.js';
import { bindService, CROWN, freeBond, isBonded, MAX_BOND } from './people/bond.js';
import { DEBT_FLOOR } from './economy.js';
import { BOOK_SEARCH_FEE, BOOK_SEARCH_YEARS, commissionBook } from './auction.js';
import { evalCondition } from './events/conditions.js';
import { queueChoice } from './events/decisions.js';
import { candidatesFor, resolveSlots, type SlotResolution } from './events/slots.js';
import { streamFor } from './rng.js';
import { canTakePost } from './people/careers.js';
import { eligibleToMarry } from './people/demography.js';
import { DEMIGOD_AGEING_STOPPED, eldritchPower, GOD_CLAUSES } from './ascension.js';
import { noteBearing } from './bearing.js';
import {
  beginImprovement, buyParcel, endowParcel, landIncome, recallParcel, sellParcel, setRentsPolicy,
} from './land.js';
import { buyBackWardship, WARDSHIP_BUYBACK_YEARS } from './people/succession.js';

/**
 * THE TABLE — the half of the game the player was never allowed to play.
 *
 * Every verb on `GameSession` answered a prompt the simulation raised. There
 * was no verb a player could use on a turn of their own choosing, and the
 * `auction`, `careers` and `library` phases docketed nothing at all — they
 * ticked, correctly, forever, and the player watched.
 *
 * That quietly deleted the concept's own headline tension. §13: *"special
 * education competes directly with the auction. Tutor the child you have, or
 * buy the book his grandchildren might read. Both are correct; you can afford
 * one."* The player made neither decision. And §14's auction — "announced
 * years ahead so the player can liquidate, borrow, or start planning something
 * regrettable" — resolved itself.
 *
 * The cost of that was not only agency. It was the ladder. Measured over six
 * thousand-year runs before this file existed, the most books any member of
 * the house ever finished was ONE, because `beginStudy` was reachable only
 * from an authored `study` effect and there are a handful of those in a
 * hundred and twenty-four templates, while every rung above Touched wants
 * reading (`booksFor`). The Ascension Ladder was not merely ungated — it was
 * starved four systems upstream, exactly the way both frame interludes were
 * (`CLAUDE.md`: "measure the whole funnel before moving anything").
 *
 * ─── What a table order is ──────────────────────────────────────────────────
 *
 * A standing order, not an action. The player says what the house is to do
 * with its people and its money, the year phases carry it out, and the order
 * stands until it is finished or withdrawn. That is what a head of house
 * actually does — nobody micromanages a decade — and it means the table costs
 * the player a handful of decisions a generation rather than a stream of them.
 *
 * ─── The steward ────────────────────────────────────────────────────────────
 *
 * `runStandingOrders` also acts when the player has NOT spoken, and that is
 * deliberate. A house whose player never opens the table still reads its books
 * and fills its posts, because a house does. The steward is a floor, not a
 * strategy: he puts idle readers on the cheapest book they can learn and
 * leaves the money alone. Everything above that floor is the player's, and the
 * difference between the floor and a played table is the whole point.
 */

export type TableOrder =
  /** Put somebody on a book. Costs them years, and the house nothing. */
  | { kind: 'study'; person: string; book: string }
  /**
   * Special education, §13's price table: 40 crowns for a full term, and the
   * child comes out of it measurably better at one thing.
   */
  | { kind: 'tutor'; person: string; attr: string }
  /** Put somebody in a post. */
  | { kind: 'career'; person: string; career: string }
  /** How high the house will go at the next auction, in crowns. */
  | { kind: 'bid'; ceiling: number }
  /** Pay a broker to bring a missing common affinity book to a sale in twelve years. */
  | { kind: 'seekBook'; book: string }
  /**
   * Pay the record-keepers to search for one unrecovered Ledger clause.
   * Available only once a successful Unmaking recipient has actually attained
   * Demigod and is waiting on the Ledger.
   */
  | { kind: 'seekClause' }
  /** Put the family's prepared Great Work on the docket. Its outcome still uses the event's one commit path. */
  | { kind: 'unmaking' }
  | { kind: 'vesselRite' }
  | { kind: 'greatRite' }
  /** Keep somebody off the marriage market, or put them back on it. */
  | { kind: 'withhold'; person: string; hold: boolean }
  /**
   * WHO THE HOUSE MARRIES WHEN THE PLAYER IS NOT ASKED (issue #41).
   *
   * The Match is one chapter beat a generation — measured, about 46 hands
   * against 547 marriages in a thousand years. Choosing perfectly on eight
   * percent of the weddings cannot move a number the other ninety-two percent
   * are quietly deciding, and until this order the house made those with no
   * regard to the one thing §7 says marriage is for.
   *
   * `in` keeps the blood in the family and pays for it in every currency a
   * marriage buys; `out` sells the blood for money, standing and allies.
   * Neither is the safe answer, which is the point.
   */
  | { kind: 'marriages'; policy: 'in' | 'out' | 'as_it_falls' }
  /**
   * THE SCION (issue #61). The one order about a PERSON rather than a
   * policy: name who the house is building the ladder on. His marriage
   * concentrates the blood regardless of `marriagePolicy`, and he wins the
   * season's hand over another expresser the weight table would otherwise
   * call a tie. He also goes to the head of the steward's reading queue
   * without a coin toss, takes the longest useful book on the shelf rather
   * than the shortest, is bought a term in `mind` before the die is asked,
   * and holds no post the steward would otherwise have placed him in — see
   * `runStandingOrders` and `placePosts`. `null` withdraws the programme.
   *
   * Concentrating everything the house has onto one man is a cost as well
   * as a bet: every cadet hall that is not his reads a small, standing
   * grievance for as long as he stands (`people/branches.ts`,
   * `GRIEVANCE_SCION_FED`). And naming the next one is not automatic when
   * he dies — see `world.scionVacant` — because a family that quietly
   * reassigned the role to whoever was left would not be a family the
   * player built anything with. That is a decision for the table, same as
   * this one.
   */
  | { kind: 'scion'; person: string | null }
  /**
   * THE HEIR (issue #61, Stage E4). A second name beside the Scion's, so
   * the house is building a PAIR rather than betting everything on one man
   * §22's own terminal irony can starve by the same act that made him:
   * measured, a Scion strong enough to reach the Vessel or beyond leaves no
   * one else within reach of Demigod, because the books, the tutor's terms
   * and the season's hands he wins are the same finite things a second man
   * would have needed. The heir gets every rule the Scion gets — he reads
   * first after the Scion, takes the longest book left once the Scion has
   * had his, is bought a term in `mind` if the Scion's is already spoken
   * for, wins the season's hand over anyone but the Scion, marries in
   * regardless of `marriagePolicy`, and holds no post — one priority tier
   * behind, on every one of them, never sharing a year's book or a
   * season's hand WITH him. Cannot be set to the Scion's own person: a
   * house does not build a pair out of one man. `null` withdraws the
   * second half of the programme without touching the first.
   *
   * Naming the next heir when this one dies or becomes the guardian is not
   * automatic, for the same reason the Scion's own successor is not — see
   * `world.scionHeirVacant`.
   */
  | { kind: 'scionHeir'; person: string | null }
  /**
   * BUY A GRANDMOTHER (concept §7, world §11 and §13).
   *
   * §7: *"A dowry is not money. Great houses negotiate in lineage
   * documentation... Forging them is an industry."* World §11 publishes the
   * industry's rates, which is a strong hint that the player is meant to be
   * able to walk in and pay them: 25 crowns for a pedigree good enough for
   * Bramme, 120 for one good enough for Caster.
   *
   * The cheap one is not merely worse, it covers one generation fewer AND is
   * caught roughly four times as often (`papers.ts`). Which is the decision:
   * a poor house with a thin record can have papers now and a Discrepancy
   * later, or it can decline the match.
   */
  | { kind: 'pedigree'; person: string; grade: PedigreeGrade }
  /**
   * THE BOND (world §12). Advance a sum against service, or tear it up.
   *
   * *"Nobody in this world is a slave... People are held by debt, custom,
   * contract and having nowhere else to go, which is sufficient."* `bind` is
   * the debt; `free` is the only way out of one that does not cost the
   * servant thirty years. Both are decisions about what kind of house this is,
   * which is the register the Table is written in.
   */
  | { kind: 'bond'; person: string; op: 'bind'; marks: number }
  | { kind: 'bond'; person: string; op: 'free' }
  /**
   * THE LAND MARKET (issue #91, Phase B — #94). `buy` takes a lot currently
   * open (`LandView.market`); `sell` gives up a held parcel for a price at a
   * discount to buying, and refuses the home demesne, which is not for sale.
   */
  | { kind: 'buy'; parcel: string }
  | { kind: 'sell'; parcel: string }
  /**
   * RENTS (issue #94). The steward's floor is `customary` — a house whose
   * player never opens the table still behaves like a house, and does not
   * squeeze its tenants to do it. `hard` and `rack` buy more income for
   * discontent and an inherited grudge.
   */
  | { kind: 'rents'; policy: RentPolicy }
  /** Drainage, mostly (world §5) — a term against a held parcel's yield, the same shape a tutor's term against a person's. */
  | { kind: 'improve'; parcel: string }
  /**
   * ENDOW A CADET BRANCH WITH LAND, OR RECALL IT (issue #91, Stage H, ruled
   * 2026-09-07: a branch may hold land, seat protected). `branch: null`
   * recalls the parcel to the seat, the same `person: string | null` shape
   * `scion`/`scionHeir` use for "set or withdraw" — endowing a branch is a
   * decision the player re-makes, silently, every time they look at the
   * plat, and it needs no separate verb for taking it back.
   */
  | { kind: 'endow'; parcel: string; branch: string | null }
  /**
   * BUY THE WARDSHIP BACK (issue #91, world "Taxes": "Buying the wardship
   * back is customary"). Only valid while `TableView.wardship` is present
   * and `boughtBack` is false; ends the land-income diversion, not the
   * minority — see `people/succession.ts`'s `buyBackWardship`.
   */
  | { kind: 'buyBackWardship' };

export interface OrderResult {
  ok: boolean;
  reason?: string;
  /**
   * WHAT IT COST AND WHAT IS LEFT (issue #59), set only where money actually
   * moved. §13 means these to hurt — "the money is gone the day it is spent,
   * and the auction is in eleven years" — and a spend the player cannot feel
   * landing does not hurt: it makes the number smaller for reasons they will
   * reconstruct later, wrongly.
   *
   * Measured across the whole order rather than declared by each case, so an
   * order added later cannot forget to say what it charged. A refund reports
   * a negative `spent`, which is honest and, today, never happens.
   */
  spent?: number;
  left?: number;
}

/** §13: special education, one attribute, full term. */
export const TUTOR_FEE = 40;

/**
 * Searching five centuries of the house's own papers costs one tutor's term.
 * This is deliberately not a new global Ledger cadence: it is a late, explicit
 * player spend against a clause opportunity the run already had and missed.
 */
export const LEDGER_SEARCH_FEE = 40;
const LEDGER_SEARCH_YEAR_FLAG = 'ledger_search_year';

/**
 * WHAT A POST COSTS TO OBTAIN. §13 and `careers.yaml` both say it out loud —
 * "a commission bought, not earned", "purchased placements" — and nothing
 * charged for one.
 *
 * That was harmless while placement came only from authored effects, at three
 * a run. The moment the steward began filling posts it stopped being harmless:
 * six salaried holders at a time, held for life, turned careers into a
 * perpetual surplus and the treasury ran to fifteen and twenty thousand
 * crowns by 2042 — which is the exact finding this whole pass began with,
 * reappearing through a different door.
 *
 * Scaled by what the post is worth in standing, because that is what is
 * actually being bought.
 */
export const COMMISSION_BY_YIELD: Record<string, number> = {
  none: 30, low: 60, moderate: 110, high: 190,
};

export function commissionFor(def: { respectYield: string }): number {
  return COMMISSION_BY_YIELD[def.respectYield] ?? COMMISSION_BY_YIELD.none!;
}
/** How long a term runs, and how much of the attribute it is worth. */
export const TUTOR_YEARS = 8;
export const TUTOR_GAIN = 9;

/**
 * START A TERM, WHEREVER IT IS ASKED FROM (issue #128).
 *
 * The player's own `tutor` order, the steward's diligence pass and an
 * authored `tutor` effect all have to refuse the same things the same way —
 * a body attribute, Madness and Eldritch Power are none of them a thing a
 * tutor teaches, and `canBeTaught` is the one gate that says so. Two copies
 * of that gate is how one of them quietly drifts and a term gets bought in
 * `madness` again (`schema/attributes.ts:58` has the note already).
 *
 * §13's whole tension is that the money is gone the day it is spent, so the
 * fee — when `charge` is true, which every caller but a refund wants — is
 * taken NOW, not on completion, and never refunded on a later cancellation.
 */
export function beginTutoring(ctx: SimCtx, p: Person, attrId: string, charge = true): OrderResult {
  const w = ctx.world;
  const subject = ctx.content.attributes.find((a) => String(a.id) === attrId);
  if (!subject) return { ok: false, reason: 'nothing anybody teaches' };
  if (!canBeTaught(subject.kind)) {
    return { ok: false, reason: `${subject.name} is not a thing a tutor can teach` };
  }
  if (w.year - p.born > TUTOR_AGE_LIMIT) return { ok: false, reason: 'too old to be taught' };
  if (w.tutoring.some((t) => t.person === p.id)) return { ok: false, reason: 'already in a term' };
  if (charge) {
    if (w.treasury - TUTOR_FEE < DEBT_FLOOR) {
      return { ok: false, reason: `the house cannot raise ${TUTOR_FEE} crowns` };
    }
    w.treasury -= TUTOR_FEE;
  }
  w.tutoring.push({ person: p.id, attr: attrId, completes: w.year + TUTOR_YEARS });
  return { ok: true };
}

/**
 * Give the house an order. Refused, with a reason, when the house cannot
 * carry it out — the reason is the point, and a client shows it beside the
 * greyed option exactly as `canUseHeirloom` and `canStudySpellbook` do.
 */
/**
 * Give the house an order, and say what it cost.
 *
 * The receipt is taken here, once, around every case — `carryOut` has eleven
 * returns and four of them move money today. Asking each to report its own
 * price is asking eleven places to remember a rule, which is how the fifth one
 * ships silent.
 */
export function order(ctx: SimCtx, o: TableOrder): OrderResult {
  const before = ctx.world.treasury;
  const result = carryOut(ctx, o);
  if (result.ok && ctx.world.treasury !== before) {
    result.spent = Math.round(before - ctx.world.treasury);
    result.left = Math.round(ctx.world.treasury);
  }
  return result;
}

function riteOffer(ctx: SimCtx, eventId: string, rite: 'vessel' | 'great_rite' | 'unmaking'):
  { ok: boolean; reason?: string; event?: EventTemplate; slots?: SlotResolution } {
  const w = ctx.world;
  if (w.ending) return { ok: false, reason: 'the Ledger has closed' };
  if (w.pendingDecisions.some((d) => d.kind === 'choice' && d.event.id === eventId)) {
    return { ok: false, reason: 'this rite is already before the house' };
  }
  const event = ctx.content.events.find((e) => e.id === eventId);
  if (!event || !evalCondition(event.conditions, ctx)) {
    return { ok: false, reason: 'the house has not reached the standing this rite demands' };
  }
  const slots = resolveSlots(event, ctx, streamFor(w, 'rite-order', eventId));
  if (!slots.ok) return { ok: false, reason: `the house cannot field ${slots.missing ?? 'the rite'}` };
  for (const slot of slots.playerCast) {
    const spec = event.slots[slot];
    if (!spec || !candidatesFor(spec, ctx, slots.fill).length) {
      return { ok: false, reason: `nobody can stand as ${slot}` };
    }
  }
  const ascendant = slots.fill.ASCENDANT;
  if (typeof ascendant === 'string' && w.people.get(ascendant)?.rites.includes(rite)) {
    return { ok: false, reason: 'he has already taken this rite' };
  }
  return { ok: true, event, slots };
}

export interface RiteAssembly {
  /** The authored rite this assembly belongs to. */
  rite: 'vessel' | 'great_rite' | 'unmaking';
  title: string;
  /** People already fixed by the engine's slot resolution. */
  actors: { slot: string; person: string; name: string }[];
  /** Player-cast slots, with the exact candidates the resolver will accept. */
  atRisk: { slot: string; candidates: { person: string; name: string }[] }[];
  /** Visible preparation already carried by the fixed actors. Never probabilities. */
  preparations: string[];
  /** Costs the player cannot undo once the taking branch resolves. */
  irreversible: string[];
}

function assemblyFor(
  ctx: SimCtx,
  event: EventTemplate,
  slots: SlotResolution,
  rite: RiteAssembly['rite'],
  title: string,
): RiteAssembly {
  // Build from the exact resolution the offer just produced. Re-resolving here
  // would make the confirmation a second photograph of the room rather than
  // the photograph the ready-state was actually based on.
  const actors = Object.entries(slots.fill)
    .flatMap(([slot, id]) => typeof id === 'string'
      ? [{ slot, person: id, name: ctx.world.people.get(id)?.name ?? id }]
      : []);

  const atRisk = slots.playerCast.map((slot) => {
    const spec = event.slots[slot];
    const people = spec ? candidatesFor(spec, ctx, slots.fill) : [];
    return {
      slot,
      candidates: people.map((p) => ({ person: p.id, name: p.name })),
    };
  });

  const preparations: string[] = [];
  for (const actor of actors) {
    const person = ctx.world.people.get(actor.person);
    if (!person) continue;
    if (person.spellsKnown.length) {
      const books = person.spellsKnown
        .map((id) => spellbookDef(ctx, String(id))?.name ?? String(id));
      preparations.push(`${person.name} has read ${books.join(', ')}.`);
    }
    if (person.rites.length) {
      preparations.push(`${person.name} has already taken ${person.rites.join(' and ').replace('great_rite', 'the Great Rite')}.`);
    }
  }

  const irreversible = rite === 'vessel'
    ? ['The named Vessel is consumed. Their place in the living house cannot be restored.']
    : rite === 'great_rite'
      ? ['The ascendant is widened once only, and the Madness charged by the rite remains his.']
      : ['The elder is spent whether the final transfer succeeds or fails; the last step can cost the run.'];

  return { rite, title, actors, atRisk, preparations, irreversible };
}

interface LedgerSearchOffer {
  ok: boolean;
  reason?: string;
  clause?: { id: string; name: string; text: string };
}

/**
 * A PLAYER-DIRECTED LEDGER SEARCH (#185).
 *
 * The 500-year term leaves a rare intentional run in a specific state:
 * the Unmaking recipient has attained Demigod and stopped ageing, but the
 * persistent Ledger is still short of God's seven clauses. Globally speeding
 * Ages was measured and rejected; lowering seven would change §22. Instead the
 * player may spend money and a record-keeper's attention to go looking.
 *
 * This is deliberately late and narrow. It does nothing before a successful
 * Unmaking recipient has attained Demigod, stops once seven clauses are known,
 * reveals at most one per year, and still needs an archivist or chronicler.
 * The ordinary Age schedule remains the normal way the contract unfolds.
 */
function ledgerSearchOffer(ctx: SimCtx): LedgerSearchOffer {
  const w = ctx.world;
  if (w.ending) return { ok: false, reason: 'the Ledger has closed' };
  if (w.clausesRecovered.size >= GOD_CLAUSES) {
    return { ok: false, reason: 'the book already holds enough clauses for the last working' };
  }

  // Both halves belong to THIS HOUSE. World.people.living() also contains
  // rivals, and an archivist in Marrow's service (or a rival who somehow
  // reached the rite) must not unlock the player's table.
  const household = w.people.household(w.playerHouse, w.year);
  const waiting = household.some((p) =>
    p.status === 'alive'
    && p.rites.includes('unmaking')
    && p.acquired[DEMIGOD_AGEING_STOPPED] === 1);
  if (!waiting) {
    return { ok: false, reason: 'nobody raised by the Unmaking has yet attained Demigod' };
  }

  const recordKeeper = household.some(
    (p) => p.status === 'alive'
      && (p.contract?.role === 'archivist' || p.contract?.role === 'chronicler'),
  );
  if (!recordKeeper) return { ok: false, reason: 'nobody living in the house can search the old contracts' };

  if (w.flags.get(LEDGER_SEARCH_YEAR_FLAG) === w.year) {
    return { ok: false, reason: 'the Ledger has already been searched this year' };
  }
  if (w.treasury - LEDGER_SEARCH_FEE < DEBT_FLOOR) {
    return { ok: false, reason: `the house cannot raise ${LEDGER_SEARCH_FEE} crowns for the search` };
  }

  const clause = [...ctx.content.clauses]
    .filter((candidate) => !w.clausesRecovered.has(candidate.id))
    .sort((a, b) => a.weight - b.weight)[0];
  if (!clause) return { ok: false, reason: 'the old contracts have nothing left to reveal' };

  return {
    ok: true,
    clause: { id: String(clause.id), name: clause.name, text: clause.text },
  };
}

function seekLedgerClause(ctx: SimCtx): OrderResult {
  const w = ctx.world;
  const offer = ledgerSearchOffer(ctx);
  if (!offer.ok || !offer.clause) {
    return { ok: false, reason: offer.reason ?? 'the old contracts have nothing left to reveal' };
  }

  w.treasury -= LEDGER_SEARCH_FEE;
  w.clausesRecovered.add(offer.clause.id);
  w.flags.set(LEDGER_SEARCH_YEAR_FLAG, w.year);
  w.chronicle.push({
    year: w.year,
    weight: 'line',
    text: 'The record-keepers were paid to compare the old contracts against the house copy.',
    named: false,
  });
  w.chronicle.push({
    year: w.year,
    weight: 'illuminated',
    title: offer.clause.name,
    text: offer.clause.text,
    named: true,
  });
  return { ok: true };
}

function carryOut(ctx: SimCtx, o: TableOrder): OrderResult {
  const w = ctx.world;

  switch (o.kind) {
    case 'study': {
      const p = ours(ctx, o.person);
      if (!p) return { ok: false, reason: 'nobody of this house by that name' };
      const def = spellbookDef(ctx, o.book);
      if (!def) return { ok: false, reason: 'no such book' };
      if (!w.library.has(o.book)) return { ok: false, reason: 'the house does not hold it' };
      const can = canStudySpellbook(ctx, p, def);
      if (!can.ok) return { ok: false, reason: can.reason ?? 'not theirs to learn' };
      return beginStudy(ctx, p, def)
        ? { ok: true }
        : { ok: false, reason: 'he is already at it, or already has it' };
    }

    case 'pedigree': {
      const p = ours(ctx, o.person);
      if (!p) return { ok: false, reason: 'nobody of this house by that name' };
      const price = PEDIGREE_PRICE[o.grade];
      if (w.treasury - price < DEBT_FLOOR) {
        return { ok: false, reason: `the house cannot raise ${price} crowns` };
      }
      // Already at the ceiling on papers it does not have to lie about. A
      // house with three generations of its own record buying a forgery is
      // paying to be catchable for nothing.
      if (papersHeld(ctx, p) >= PEDIGREE_COVERS[o.grade]) {
        return { ok: false, reason: 'the record already shows that much' };
      }
      w.treasury -= price;
      const doc = filePedigree(ctx, p, o.grade);
      w.chronicle.push({
        year: w.year,
        weight: 'line',
        text: `${doc.generations} generations of ${p.name}'s mothers were written out fair and `
          + `sealed by ${doc.notarisedBy}, for ${price} crowns.`,
        named: false,
      });
      return { ok: true };
    }

    case 'bond': {
      const p = ours(ctx, o.person);
      if (!p) return { ok: false, reason: 'nobody of this house by that name' };
      if (!p.contract) return { ok: false, reason: 'they are not in the house\'s service' };

      if (o.op === 'free') {
        // `.ok`, not the result itself: `freeBond` returns what the freeing
        // DID — what was forgiven and how many people resented it — and an
        // object is truthy, so testing the return value reported success on
        // every refusal.
        return freeBond(ctx, p).ok
          ? { ok: true }
          : { ok: false, reason: 'there is no bond on them to tear up' };
      }

      if (isBonded(p)) return { ok: false, reason: 'they are bonded already' };
      if (o.marks <= 0 || o.marks > MAX_BOND) {
        return { ok: false, reason: `a bond runs from 1 to ${MAX_BOND} marks` };
      }
      if (w.treasury - o.marks / CROWN < DEBT_FLOOR) {
        return { ok: false, reason: `the house cannot advance ${o.marks} marks` };
      }
      return bindService(ctx, p, o.marks)
        ? { ok: true }
        : { ok: false, reason: 'that bond cannot be written' };
    }

    case 'tutor': {
      const p = ours(ctx, o.person);
      if (!p) return { ok: false, reason: 'nobody of this house by that name' };
      return beginTutoring(ctx, p, o.attr);
    }

    case 'career': {
      const p = ours(ctx, o.person);
      if (!p) return { ok: false, reason: 'nobody of this house by that name' };
      const def = ctx.content.career(o.career);
      if (!def) return { ok: false, reason: 'no such post' };
      // INVARIANT `canHoldPost` (schema/career.ts) is the only placement gate;
      // `canTakePost` is the half that carries the reason. Asked before the
      // money, like every other refusal here, because the reason is what the
      // client draws beside the greyed post.
      const open = canTakePost(p);
      if (!open.ok) return { ok: false, reason: open.reason };
      if (p.career?.career === o.career) return { ok: false, reason: 'he already holds it' };
      if (w.year - p.born < CAREER_AGE) return { ok: false, reason: 'too young for a post' };
      const fee = commissionFor(def);
      if (w.treasury - fee < DEBT_FLOOR) {
        return { ok: false, reason: `the house cannot raise ${fee} crowns for the place` };
      }
      w.treasury -= fee;
      p.career = { career: def.id, from: w.year };
      return { ok: true };
    }

    case 'bid': {
      if (!Number.isFinite(o.ceiling) || o.ceiling < 0) return { ok: false, reason: 'not a figure' };
      w.bidCeiling = Math.round(o.ceiling);
      return { ok: true };
    }

    case 'seekBook':
      return commissionBook(ctx, o.book);

    case 'seekClause':
      return seekLedgerClause(ctx);

    case 'unmaking':
    case 'vesselRite':
    case 'greatRite': {
      const eventId = o.kind === 'vesselRite' ? 'the_vessel_rite'
        : o.kind === 'greatRite' ? 'the_great_rite' : 'the_unmaking';
      const rite = o.kind === 'vesselRite' ? 'vessel'
        : o.kind === 'greatRite' ? 'great_rite' : 'unmaking';
      const prepared = riteOffer(ctx, eventId, rite);
      if (!prepared.ok || !prepared.event || !prepared.slots) {
        return { ok: false, reason: prepared.reason ?? 'the family cannot field the rite' };
      }
      queueChoice(ctx, prepared.event, prepared.event.body, prepared.slots.fill, prepared.slots.playerCast);
      return { ok: true };
    }

    case 'marriages': {
      w.marriagePolicy = o.policy;
      return { ok: true };
    }

    case 'scion': {
      if (o.person === null) {
        w.scion = null;
        // Addressed either way: declining to name anyone is still an answer
        // to the notice, not a second silence on top of the first.
        w.scionVacant = undefined;
        return { ok: true };
      }
      const p = ours(ctx, o.person);
      if (!p) return { ok: false, reason: 'nobody of this house by that name' };
      w.scion = p.id;
      w.scionVacant = undefined;
      // PROMOTED, NOT DOUBLED. Naming the current heir as Scion vacates the
      // heir's own slot rather than leaving `scion === scionHeir` standing —
      // the same invalid state the `scionHeir` order above refuses outright.
      if (w.scionHeir === p.id) {
        w.scionHeir = null;
        w.scionHeirVacant = undefined;
      }
      return { ok: true };
    }

    case 'scionHeir': {
      if (o.person === null) {
        w.scionHeir = null;
        w.scionHeirVacant = undefined;
        return { ok: true };
      }
      // A PAIR IS TWO MEN. Naming the Scion himself as his own heir would
      // read as a pair and cost like one — his own bias sites already give
      // him everything the heir's would add — while measuring as a house
      // that built no second man at all.
      if (o.person === w.scion) return { ok: false, reason: 'the Scion cannot be his own heir' };
      const p = ours(ctx, o.person);
      if (!p) return { ok: false, reason: 'nobody of this house by that name' };
      w.scionHeir = p.id;
      w.scionHeirVacant = undefined;
      return { ok: true };
    }

    case 'withhold': {
      const p = ours(ctx, o.person);
      if (!p) return { ok: false, reason: 'nobody of this house by that name' };
      // A daughter held back is power the house keeps and a match it does not
      // make. §7: every daughter married outward is power leaving the blood
      // forever, and there was no way to decline to spend her.
      // Noted only on the way IN, and only when she was not already held:
      // releasing somebody is not an act of bearing, and a player toggling the
      // same order twice has done one proud thing rather than two.
      if (o.hold && w.withheld[p.id] === undefined) {
        w.withheld[p.id] = w.year;
        noteBearing(ctx, 'kept_her_back');
      } else if (!o.hold) {
        delete w.withheld[p.id];
      }
      return { ok: true };
    }

    case 'buy':
      return buyParcel(ctx, o.parcel);

    case 'sell':
      return sellParcel(ctx, o.parcel);

    case 'rents':
      return setRentsPolicy(ctx, o.policy);

    case 'improve':
      return beginImprovement(ctx, o.parcel);

    case 'endow':
      return o.branch === null ? recallParcel(ctx, o.parcel) : endowParcel(ctx, o.parcel, o.branch);

    case 'buyBackWardship':
      return buyBackWardship(ctx);

    default:
      return assertNever(o);
  }
}

const TUTOR_AGE_LIMIT = 22;
const CAREER_AGE = 16;

/** Everyone of the house, alive, this year — the people orders may name. */
function ours(ctx: SimCtx, id: string): Person | undefined {
  const w = ctx.world;
  const p = w.people.get(id);
  if (!p || p.status !== 'alive') return undefined;
  return w.people.household(w.playerHouse, w.year).some((q) => q.id === p.id) ? p : undefined;
}

/** What the table can currently be told to do. A client draws this. */
export interface TableView {
  treasury: number;
  bidCeiling: number;
  /**
   * THE NEXT SALE, IF ONE HAS BEEN ANNOUNCED (issue #55).
   *
   * §13's tension is that the money is gone the day it is spent and the
   * auction is eleven years out — and the panel that asks the player to set a
   * ceiling never said WHEN, so the second half of the sentence was missing
   * from the only screen that needed it. Absent where nothing is coming, which
   * is most years and is itself the answer to "should I be holding money".
   */
  auction?: { year: Year; lots: number; lowestReserve: number };
  /** The standing order on marriage (issue #41). See the `marriages` order. */
  marriagePolicy: 'in' | 'out' | 'as_it_falls';
  /**
   * Living members of the household who can be named into the ascension
   * programme. The order itself intentionally accepts any member of the house;
   * this is the same set, made drawable without reaching into session.ctx.
   */
  programmeCandidates: { person: string; name: string; age: number }[];
  /** Who the house has named to build the ladder on (issue #61). See the `scion` order. */
  scion?: { person: string; name: string };
  /**
   * THE PROGRAMME LAPSED (issue #61, Stage C). Present only when the house
   * once had a scion standing and does not now — a client's cue to ask the
   * one question this design means to span generations, rather than the
   * silence a client that never checked `scion` would otherwise show.
   */
  scionVacant?: { was: string; wasName: string; since: Year };
  /** The second man built alongside the Scion (issue #61, Stage E4). See the `scionHeir` order. */
  scionHeir?: { person: string; name: string };
  /** THE HEIR'S PROGRAMME LAPSED, mirroring `scionVacant` exactly. */
  scionHeirVacant?: { was: string; wasName: string; since: Year };
  /**
   * WARDSHIP (issue #91, world "Taxes"). Present exactly as long as
   * `world.wardship` is: the seat is empty, nobody of the house holds it, and
   * — unless `boughtBack` — the land income is the Warden's, not the
   * house's. `buyBackCost` is what the `buyBackWardship` order takes off the
   * treasury; absent once `boughtBack` is true, since there is nothing left
   * to buy.
   */
  wardship?: {
    ward: string; wardName: string; since: Year; boughtBack: boolean; buyBackCost?: number;
  };
  /** Books on the shelf, and who in the house could take one up. */
  shelf: { book: string; name: string; years: number; readers: { person: string; name: string }[] }[];
  /** Common books the house may ask a broker to seek; payment and sale are separate. */
  missingPrimers: { book: string; name: string; affinity: string; fee: number; reserve: number; saleYear: Year; queued: boolean }[];
  /** A late-game record-keeper search for one unrecovered contract clause. */
  ledgerSearch: { ready: boolean; reason?: string; fee: number };
  unmaking: { ready: boolean; reason?: string; assembly?: RiteAssembly };
  vesselRite: { ready: boolean; reason?: string; assembly?: RiteAssembly };
  greatRite: { ready: boolean; reason?: string; assembly?: RiteAssembly };
  /** Terms of tutoring already paid for. */
  tutoring: { person: string; name: string; attr: string; completes: Year }[];
  /** Studies under way. */
  studying: { person: string; name: string; book: string; completes: Year }[];
  /**
   * WHO THE MARKET MAY BE SHOWN, and which of them the house is keeping off
   * it. Built from the engine's own `eligibleToMarry` and `onTheMarket`: §7's
   * rule about when somebody is spendable lives in `demography.ts`, and a
   * client that picked its own age for it would offer to withhold a child and
   * miss a widow.
   */
  market: { person: string; name: string; age: Year; held: boolean; since?: Year }[];
  /** What a full term of tutoring costs today, and whether it can be paid. */
  tutorFee: number;
  canTutor: boolean;
  /**
   * AND WHAT THE FORTY CROWNS MAY BE SPENT ON.
   *
   * The comment that used to sit on `pupils` said this list was `attributes`
   * on the session view, because two lists of the same nineteen rows is one
   * list that will disagree with itself. It was right about the danger and
   * wrong about the rows: the session's list is every attribute in the game,
   * which a tree and a member panel both need in order to put a name to an
   * id, and the tutor's list is the subset a tutor can actually move. They
   * were never the same list, and the client offered a term in Madness for a
   * year and a half because they were spelled the same.
   */
  teachable: { attr: string; name: string }[];
  /**
   * THE HOUSE'S SERVANTS, and which of them it is holding by debt (world §12).
   *
   * `loyalty` is on here because it is the whole of what a bond costs and the
   * player cannot otherwise see it moving — a bondsman bleeds a little every
   * year and the bill arrives, years later, as a secret nobody can trace back
   * to the decision that caused it. Showing the number is not showing the
   * mechanism; it is the difference between a cost and a punishment.
   */
  servants: {
    person: string;
    name: string;
    role: string;
    term: string;
    wage: number;
    debt: number;
    bonded: boolean;
    loyalty: number;
  }[];
  /** What a bond may run to, and the two grades of pedigree, at world §11's prices. */
  maxBond: number;
  /**
   * THE PAPERS (concept §7). Who in the house has a match to make, what their
   * record can show, and what a grandmother costs today. Without this the
   * pedigree order is a verb with nothing to aim it at: the player learns the
   * record is thin only by being refused a card, and cannot act on it before
   * the refusal.
   */
  papers: { person: string; name: string; shows: number; forged: number; exposed: number }[];
  pedigreePrices: { grade: PedigreeGrade; price: number; covers: number; canPay: boolean }[];
  /**
   * THE POSTS, AND WHAT ONE COSTS TODAY. `career` was an order the player had
   * no way to give: this view listed the shelf and the terms and never the
   * places, so a client drawing the table would have offered two of the five
   * orders and the steward would have gone on filling posts unopposed.
   *
   * `eligible` is who is old enough and does not already hold it — the same
   * two tests `order` makes, asked before the money is put up rather than
   * after. Affording it is `canPay`, and it is separate on purpose: a post
   * the house wants and cannot pay for is information (concept §16), and a
   * client greys it and says why rather than hiding it.
   */
  posts: {
    career: string;
    name: string;
    blurb?: string;
    respectYield: string;
    fee: number;
    canPay: boolean;
    holders: { person: string; name: string }[];
    eligible: { person: string; name: string; age: number }[];
  }[];
  /**
   * Who is still young enough for a term, oldest first — a term takes eight
   * years. What they can be taught is `teachable`, above.
   */
  pupils: { person: string; name: string; age: Year }[];
}

export function tableView(ctx: SimCtx): TableView {
  const w = ctx.world;
  const household = w.people.household(w.playerHouse, w.year);
  const name = (id: string) => w.people.get(id)?.name ?? id;

  const shelf = heldBooks(ctx).map((state) => {
    const def = spellbookDef(ctx, state.id);
    const readers = def
      ? household
        .filter((p) => canStudySpellbook(ctx, p, def).ok
          && !p.spellsKnown.some((b) => String(b) === state.id)
          && !w.studies.some((s) => s.person === p.id && s.book === state.id))
        .map((p) => ({ person: p.id, name: p.name }))
      : [];
    return {
      book: state.id,
      name: def?.name ?? state.id,
      years: def?.studyYears ?? 0,
      readers,
    };
  });

  const posts = ctx.content.careers.map((def) => {
    const fee = commissionFor(def);
    const minAge = Math.max(CAREER_AGE, def.minAge);
    const post: TableView['posts'][number] = {
      career: String(def.id),
      name: def.name,
      respectYield: def.respectYield,
      fee,
      canPay: w.treasury - fee >= DEBT_FLOOR,
      holders: household
        .filter((p) => p.career?.career === def.id)
        .map((p) => ({ person: p.id, name: p.name })),
      eligible: household
        .filter((p) => canTakePost(p).ok && w.year - p.born >= minAge && p.career?.career !== def.id)
        .map((p) => ({ person: p.id, name: p.name, age: w.year - p.born })),
    };
    if (def.blurb !== undefined) post.blurb = def.blurb;
    return post;
  });

  const pupils = household
    .filter((p) => w.year - p.born <= TUTOR_AGE_LIMIT && !w.tutoring.some((t) => t.person === p.id))
    .map((p) => ({ person: p.id, name: p.name, age: w.year - p.born }))
    .sort((a, b) => b.age - a.age);

  return {
    treasury: Math.round(w.treasury),
    bidCeiling: w.bidCeiling,
    // The soonest sale, and the cheapest thing in it — a ceiling is a guess
    // until you know what the floor is.
    ...(() => {
      const coming = w.auction.upcoming.filter((l) => l.saleYear > w.year);
      if (!coming.length) return {};
      const year = Math.min(...coming.map((l) => l.saleYear));
      const atYear = coming.filter((l) => l.saleYear === year);
      return {
        auction: {
          year,
          lots: atYear.length,
          lowestReserve: Math.min(...atYear.map((l) => l.reserveCoin)),
        },
      };
    })(),
    marriagePolicy: w.marriagePolicy,
    programmeCandidates: household
      .map((p) => ({ person: p.id, name: p.name, age: w.year - p.born }))
      .sort((a, b) => b.age - a.age || a.name.localeCompare(b.name)),
    ...(w.scion ? { scion: { person: w.scion, name: name(w.scion) } } : {}),
    ...(w.scionVacant ? { scionVacant: { ...w.scionVacant } } : {}),
    ...(w.scionHeir ? { scionHeir: { person: w.scionHeir, name: name(w.scionHeir) } } : {}),
    ...(w.scionHeirVacant ? { scionHeirVacant: { ...w.scionHeirVacant } } : {}),
    ...(w.wardship ? {
      wardship: {
        ward: w.wardship.ward,
        wardName: name(w.wardship.ward),
        since: w.wardship.since,
        boughtBack: w.wardship.boughtBack ?? false,
        ...(w.wardship.boughtBack ? {} : { buyBackCost: Math.round(WARDSHIP_BUYBACK_YEARS * landIncome(ctx)) }),
      },
    } : {}),
    shelf,
    missingPrimers: ctx.content.spellbooks
      .filter((b) => b.tier === 'minor' && !w.library.has(b.id))
      .map((b) => ({
        book: b.id, name: b.name, affinity: b.affinity,
        fee: BOOK_SEARCH_FEE, reserve: b.price.max + 100,
        saleYear: w.year + BOOK_SEARCH_YEARS,
        queued: w.auction.upcoming.some((lot) => lot.kind === 'spellbook' && lot.refId === b.id),
      })),
    ledgerSearch: (() => {
      const offer = ledgerSearchOffer(ctx);
      return offer.ok
        ? { ready: true, fee: LEDGER_SEARCH_FEE }
        : { ready: false, reason: offer.reason, fee: LEDGER_SEARCH_FEE };
    })(),
    unmaking: (() => {
      const offer = riteOffer(ctx, 'the_unmaking', 'unmaking');
      return offer.ok && offer.event && offer.slots
        ? { ready: true, assembly: assemblyFor(ctx, offer.event, offer.slots, 'unmaking', 'The Unmaking') }
        : { ready: false, reason: offer.reason };
    })(),
    vesselRite: (() => {
      const offer = riteOffer(ctx, 'the_vessel_rite', 'vessel');
      return offer.ok && offer.event && offer.slots
        ? { ready: true, assembly: assemblyFor(ctx, offer.event, offer.slots, 'vessel', 'The Vessel') }
        : { ready: false, reason: offer.reason };
    })(),
    greatRite: (() => {
      const offer = riteOffer(ctx, 'the_great_rite', 'great_rite');
      return offer.ok && offer.event && offer.slots
        ? { ready: true, assembly: assemblyFor(ctx, offer.event, offer.slots, 'great_rite', 'The Great Rite') }
        : { ready: false, reason: offer.reason };
    })(),
    tutoring: w.tutoring.map((t) => ({ ...t, name: name(t.person) })),
    studying: w.studies.map((s) => ({ ...s, name: name(s.person) })),
    market: household
      .filter((p) => eligibleToMarry(ctx, p))
      .map((p) => {
        const since = w.withheld[p.id];
        return {
          person: p.id,
          name: p.name,
          age: w.year - p.born,
          held: since !== undefined,
          ...(since !== undefined ? { since } : {}),
        };
      }),
    tutorFee: TUTOR_FEE,
    canTutor: w.treasury - TUTOR_FEE >= DEBT_FLOOR,
    teachable: ctx.content.attributes
      .filter((a) => canBeTaught(a.kind))
      .map((a) => ({ attr: String(a.id), name: a.name })),
    posts,
    pupils,

    // WORLD §12's two tiers of servant, on one list, because the decision the
    // player makes is between them and not about either alone.
    servants: household
      .filter((p) => p.contract)
      .map((p) => ({
        person: p.id,
        name: p.name,
        role: p.contract!.role,
        term: p.contract!.term,
        wage: p.contract!.wage,
        debt: p.contract!.debt,
        bonded: isBonded(p),
        loyalty: Math.round(p.contract!.loyalty),
      })),
    maxBond: MAX_BOND,

    // THE PAPERS, for the people a match is actually made for: the blood of
    // the house. A retainer's pedigree is nobody's negotiation.
    papers: household
      .filter((p) => p.membership.some((m) => m.kind === 'blood' && m.to === undefined))
      .map((p) => ({
        person: p.id,
        name: p.name,
        shows: papersHeld(ctx, p),
        forged: p.lineageDocuments.filter((d) => d.forged && d.exposed === undefined).length,
        exposed: p.lineageDocuments.filter((d) => d.exposed !== undefined).length,
      })),
    pedigreePrices: (['bramme', 'caster'] as const).map((grade) => ({
      grade,
      price: PEDIGREE_PRICE[grade],
      covers: PEDIGREE_COVERS[grade],
      canPay: w.treasury - PEDIGREE_PRICE[grade] >= DEBT_FLOOR,
    })),
  };
}

/**
 * THE STEWARD. Run every year from the `table` phase.
 *
 * Two jobs. Finish the terms the house has paid for, and — where the player
 * has left somebody idle — put readers on books. He never spends money and
 * never touches the market: those are the decisions, and a steward who made
 * them would be the player again.
 */
export function runStandingOrders(
  ctx: SimCtx,
  rng: Rng,
): { taught: string[]; opened: string[]; placed: string[] } {
  const w = ctx.world;
  const taught: string[] = [];
  const opened: string[] = [];
  const placed: string[] = [];

  // THE PROGRAMME LAPSES OUT LOUD (issue #61, Stage C). `preferred` and the
  // Match below both test identity against `w.scion`, so a dead man's id
  // would otherwise simply stop matching anybody and the house would read as
  // though it had never named one — the exact silent failure this whole
  // codebase's test philosophy exists to catch. Noticed here rather than at
  // the moment of death: `kill()` is called from a dozen places (plague, a
  // duel, Madness overflow, an authored `status` effect) and none of them
  // should have to know about a table order that may not even be standing.
  if (w.scion) {
    const stillStanding = w.people.household(w.playerHouse, w.year).some((p) => p.id === w.scion);
    if (!stillStanding) {
      const was = w.people.get(w.scion);
      w.scionVacant = { was: w.scion, wasName: was?.name ?? w.scion, since: w.year };
      w.chronicle.push({
        year: w.year,
        weight: 'line',
        text: `The house has nobody standing where ${was?.name ?? 'the one it named'} did. Nobody has been named in his place.`,
        named: false,
      });
      w.scion = null;
    }
  }

  // THE HEIR'S OWN LAPSE, mirroring the Scion's exactly (issue #61, Stage
  // E4) — same reason, same silent failure it would otherwise be.
  if (w.scionHeir) {
    const stillStanding = w.people.household(w.playerHouse, w.year).some((p) => p.id === w.scionHeir);
    if (!stillStanding) {
      const was = w.people.get(w.scionHeir);
      w.scionHeirVacant = { was: w.scionHeir, wasName: was?.name ?? w.scionHeir, since: w.year };
      const beside = w.scion ? w.people.get(w.scion)?.name ?? w.scion : undefined;
      w.chronicle.push({
        year: w.year,
        weight: 'line',
        text: beside
          ? `The house has nobody standing beside ${beside} where ${was?.name ?? 'the second one'} did. Nobody has been named in his place.`
          : `The house has nobody standing where ${was?.name ?? 'the one it named as heir'} did. Nobody has been named in his place.`,
        named: false,
      });
      w.scionHeir = null;
    }
  }

  // Terms come due. `acquired` is where life's changes go — invariant 6, and
  // writing into the phenotype cache would look like it worked until spring.
  for (const t of [...w.tutoring]) {
    if (w.year < t.completes) continue;
    w.tutoring = w.tutoring.filter((x) => x !== t);
    const p = w.people.get(t.person);
    if (!p || p.status !== 'alive') continue;
    p.acquired[t.attr] = (p.acquired[t.attr] ?? 0) + TUTOR_GAIN;
    // The DURABLE mark (issue #126) — distinct from `acquired`, which any
    // ordinary event effect can also touch. Set once, here, regardless of
    // which door opened the term: the player's order, the steward below, or
    // an authored `tutor` effect all complete through this same loop.
    if (!p.taught.includes(t.attr)) p.taught.push(t.attr);
    taught.push(p.id);
    w.chronicle.push({
      year: w.year,
      weight: 'line',
      text: `${p.name} finished the term, and was better at ${t.attr} than the house had any right to expect.`,
      named: false,
    });
  }

  // Idle readers, and a shelf. The steward reaches for the SHORTEST book
  // anybody can finish, because he is minding the house rather than building
  // a Hierophant — the long ones are the player's call.
  // THE WHOLE HOUSE, not the seat. This read `hall(w, MAIN_BRANCH)` and the
  // ladder paid for it: measured over six thousand-year runs, the strongest
  // men in the family were living and dying in cadet halls with EMPTY
  // BOOKSHELVES — Yarrow the second at power 71.6 and no books in eighty-four
  // years, Uthred at 66.3 and none in eighty-four, Merrick at 67.9 and none
  // in thirty-nine — while the seat's best-read man sat at power 0 with eight
  // books. §22 wants power and books ON THE SAME MAN, and the two halves were
  // in different halls.
  //
  // `measureAscension` has always walked the whole household, with the reason
  // written next to it: a Hierophant in a cadet hall is still the family's
  // Hierophant (invariant 15). The library disagreed, and the library was
  // what the ladder was waiting on.
  const readers = w.people.household(w.playerHouse, w.year);
  const busy = new Set(w.studies.map((s) => s.person));
  const books = heldBooks(ctx)
    .map((s) => spellbookDef(ctx, s.id))
    .filter((d): d is NonNullable<typeof d> => Boolean(d))
    .sort((a, b) => a.studyYears - b.studyYears);
  // THE SCION READS THE LONG ONES (issue #61, Stage B). The shelf sorted
  // shortest-first is the steward minding a house, not building a
  // Hierophant — see the comment on `books` above. A named scion is the one
  // exception to that caution: he takes whichever useful book takes longest,
  // because §22 counts what he has read by the time the gate asks, not by
  // the year the shelf happened to hand it to him.
  const booksLongestFirst = [...books].reverse();

  // THE BLOOD READS FIRST, THE SCION FIRST OF THE BLOOD, THE HEIR SECOND
  // (issue #61, Stages B and E4). A house chasing the ladder puts its
  // books — and, below, its tutor's terms and its posts — in front of the
  // boy who can express, not in front of whoever happens to be idle, and
  // the gates want power AND books ON THE SAME MAN (§22). Sorted rather
  // than filtered: a mundane cousin with a free decade still reads, he just
  // reads third. Both the Scion and the heir go ahead of their own current
  // power — either may be a boy the house is betting on before the font has
  // shown itself at all, which is exactly the case `eldritchPower` alone
  // could never sort to the front. The Scion beats the heir on a tie
  // between them for the same reason he beats everyone: he is the one the
  // house named first, and a pair built by coin toss is not a programme.
  const inProgramme = (id: string) => (w.scion !== null && id === w.scion) || (w.scionHeir !== null && id === w.scionHeir);
  const programmeRank = (id: string) => (id === w.scion ? 2 : id === w.scionHeir ? 1 : 0);
  const byBlood = [...readers].sort((a, b) => {
    const ar = programmeRank(a.id);
    const br = programmeRank(b.id);
    if (ar !== br) return br - ar;
    return eldritchPower(ctx, b) - eldritchPower(ctx, a);
  });

  if (books.length) {
    for (const p of byBlood) {
      if (busy.has(p.id)) continue;
      if (w.year - p.born < READING_AGE) continue;
      const isProgramme = inProgramme(p.id);
      // One at a time, and not everybody every year: a house is not a
      // seminary. Somebody who can express is worth pushing; everybody else
      // is worth letting get on with it. The one man — or two — the house
      // has actually named is worth pushing every year — a coin the
      // programme could lose is not a programme.
      if (!isProgramme) {
        const keen = eldritchPower(ctx, p) > 0 ? STEWARD_DILIGENCE_BLOOD : STEWARD_DILIGENCE;
        if (!rng.bool(keen)) continue;
      }
      const pool = isProgramme ? booksLongestFirst : books;
      const book = pool.find((d) => canStudySpellbook(ctx, p, d).ok
        && !p.spellsKnown.some((b) => String(b) === String(d.id)));
      if (!book) continue;
      if (beginStudy(ctx, p, book)) {
        opened.push(p.id);
        busy.add(p.id);
      }
    }
  }

  // A TERM, FOR WHOEVER THE HOUSE CAN AFFORD ONE (issue #128). §13's whole
  // door was the player's own order; 0 terms completed in 16 thousand-year
  // runs with nobody at the table to give one. Forty crowns and eight years
  // is real money, unlike a book off the shelf, so this rolls far less often
  // than the reading pass above (STEWARD_TUTOR_DILIGENCE) and stops well
  // short of the debt floor `beginTutoring` itself refuses at
  // (STEWARD_TUTOR_FLOOR, the same margin `placePosts` keeps for a
  // commission) — a house is not a seminary, and the auction is still
  // eleven years out. The blood reads first here too, exactly as it does at
  // the shelf: a house chasing the ladder invests in the child who can
  // express.
  const teachable = ctx.content.attributes.filter((a) => canBeTaught(a.kind));
  // THE PROGRAMME'S TERM BUYS MIND (issue #61, Stages B and E4). The
  // Vessel's OTHER gate, and the one no run has ever been tested on — power
  // has always stopped a climbing house first (`gate:ladder`'s own
  // measurement). A term is the one thing at the table that raises it on
  // purpose (`TUTOR_GAIN` on `acquired`, same door a rite or an event
  // uses), so a house that has named a man to hold the Vessel buys it for
  // him specifically rather than whatever the die names — and the heir,
  // reading second in `byBlood`, buys it for himself out of whatever
  // treasury the Scion's own term left standing. Real competition, not a
  // cosmetic tier: `STEWARD_TUTOR_FLOOR` is one shared number, and the
  // Scion spends against it first.
  const mind = teachable.find((a) => String(a.id) === 'mind');
  if (teachable.length) {
    for (const p of byBlood) {
      if (w.treasury - TUTOR_FEE < STEWARD_TUTOR_FLOOR) break;
      if (w.year - p.born > TUTOR_AGE_LIMIT) continue;
      if (w.tutoring.some((t) => t.person === p.id)) continue;
      const isProgramme = inProgramme(p.id);
      if (!isProgramme) {
        const keen = eldritchPower(ctx, p) > 0 ? STEWARD_TUTOR_DILIGENCE_BLOOD : STEWARD_TUTOR_DILIGENCE;
        if (!rng.bool(keen)) continue;
      }
      const subject = (isProgramme && mind) ? mind : rng.pick(teachable);
      beginTutoring(ctx, p, String(subject.id));
    }
  }

  placePosts(ctx, rng, placed);
  return { taught, opened, placed };
}

/**
 * SOMEBODY HAS TO DO SOMETHING WITH THE SPARE SONS.
 *
 * `tickCareers` only ever MAINTAINED a career — paying its income, growing its
 * attribute, granting its trait after enough years. Nothing placed anybody.
 * Placement came only from an authored `career` effect, so the measured answer
 * was three placements a run, twelve of eighteen of them scholars, and seven
 * of the eight authored posts were decoration.
 *
 * The steward places by what the post is FOR, weighted rather than picked, so
 * a house does not end up all clergy. He never buys a commission the treasury
 * cannot stand, and he never touches anybody the player has given an order
 * about.
 */
function placePosts(ctx: SimCtx, rng: Rng, placed: string[]): void {
  const w = ctx.world;
  const posts = ctx.content.careers;
  if (!posts.length) return;

  // A HOUSE HAS A FINITE NUMBER OF COMMISSIONS. The first cut of this had no
  // ceiling and placed 773 people a run, which fixed "seven of the eight posts
  // are decoration" by turning careers into a standing yield: `tickCareers`
  // pays Respect per holder per year, so thirty simultaneous holders drove
  // every one of six runs to exalted and flattened the standing spread that
  // the Assize had just opened up. A post is a thing the house buys and can
  // only afford so many of.
  const household = w.people.household(w.playerHouse, w.year);
  let held = household.filter((p) => p.career).length;
  if (held >= MAX_POSTS) return;

  for (const p of household) {
    if (held >= MAX_POSTS) return;
    if (p.career || p.contract) continue;
    // The steward buys no commission the table would refuse him.
    if (!canTakePost(p).ok) continue;
    const age = w.year - p.born;
    if (age < CAREER_AGE || age > CAREER_AGE_LIMIT) continue;
    // The Head has a post already, and it is the seal.
    if (p.castSlots.includes('head')) continue;
    // THE PROGRAMME HOLDS NO POST (issue #61, Stages B and E4). Not merely
    // the clergy and military doors this loop already refuses an
    // expresser — every post, for both the Scion and the heir, because a
    // commission is years spent on the house's business rather than on the
    // shelf and the tutor's term the house named them for. The existing
    // `removesFromBreedingPool` and `extraMortality` refusals below only
    // fire once he already reads as an expresser; naming him is meant to
    // protect the boy the house is BETTING on, which is often earlier than
    // that.
    if ((w.scion && p.id === w.scion) || (w.scionHeir && p.id === w.scionHeir)) continue;
    if (!rng.bool(STEWARD_PLACEMENT)) continue;

    const open = posts.filter((def) => {
      // A commission is bought (§13). The steward buys only what is already
      // paid for out of the year's surplus, never on credit.
      if (w.treasury - commissionFor(def) < COMMISSION_FLOOR) return false;
      // §16: ordination removes them from the succession entirely. A steward
      // does not remove the only son who can express from the breeding pool —
      // that is a decision, and an expensive one, and it is the player's.
      if (def.removesFromBreedingPool && eldritchPower(ctx, p) > 0) return false;
      // AND THE HOUSE DOES NOT SEND THE BOY WHO CAN EXPRESS TO THE WARS.
      // `military` carries `extraMortality: 0.03` and scores well on strength,
      // so the steward's first cut posted strong expressers to it and they
      // died before they had read three books — the ladder went back to
      // `touched` in every run, from a rung it had just reached in five of
      // six. Everything the family is counting on is concentrated in exactly
      // the people it must not spend (§7), and a steward should know that.
      if (def.extraMortality && eldritchPower(ctx, p) > 0) return false;
      return true;
    });
    const def = rng.weighted(open, (d) => postFit(ctx, p, d));
    if (!def) continue;

    w.treasury -= commissionFor(def);
    p.career = { career: def.id, from: w.year };
    placed.push(p.id);
    held += 1;
  }
}

/**
 * How well a post suits a person. A weight, not a filter — a house puts people
 * where they will do, and sometimes where there is room.
 *
 * Every post scores at least 1 so nothing is unreachable, which is the whole
 * failure this replaces: scholar was twelve of eighteen placements because
 * `study` effects were the only authored placements in the library.
 */
function postFit(ctx: SimCtx, p: Person, def: { id: string; studySpeed?: number }): number {
  const w = ctx.world;
  const of = (k: string) => attr(p, k, ctx.genetics, w.year);
  switch (String(def.id)) {
    // A scholar is for the blood, and for the boy who can actually read.
    case 'scholar': return 1 + (eldritchPower(ctx, p) > 0 ? 4 : 0) + of('mind') / 30;
    case 'clergy': return 1 + of('mind') / 40 + (w.discontent > 40 ? 2 : 0);
    case 'military': return 1 + of('strength') / 25;
    case 'court': return 1 + of('charm') / 25;
    case 'advocate': return 1 + of('mind') / 35;
    case 'merchant': return 1 + (w.treasury < 300 ? 3 : 1);
    case 'factor': return 1 + (w.treasury < 300 ? 2 : 1);
    case 'sea': return 1 + of('strength') / 40;
    default: return 1;
  }
}

/** Past this age nobody is starting a career. */
const CAREER_AGE_LIMIT = 45;
/** The house never buys a place that would leave it under this. */
const COMMISSION_FLOOR = 150;
/** The chance an idle adult is put to a post in a given year. */
const STEWARD_PLACEMENT = 0.09;
/**
 * How many posts the house can hold at once. Six is about one in three of the
 * seat — enough that every authored career is reachable, few enough that the
 * Respect they yield is a decision the house made rather than weather.
 */
const MAX_POSTS = 6;

/** Old enough to be given a book and left alone with it. */
const READING_AGE = 14;
/**
 * The chance an idle reader is set to a book in a given year. Low on purpose:
 * the steward is a floor under the library, not a strategy, and a house that
 * reads everything on the shelf the moment it arrives leaves the player's own
 * orders nothing to be better than.
 */
const STEWARD_DILIGENCE = 0.12;
/** And the chance for somebody who can actually express it. */
const STEWARD_DILIGENCE_BLOOD = 0.45;

/**
 * THE CHANCE AN ELIGIBLE CHILD IS PUT IN A TERM, IN A GIVEN YEAR (issue
 * #128). Far below the reading rates above on purpose: a book off the shelf
 * costs the house nothing, and a term costs `TUTOR_FEE` the day it starts —
 * §13's whole tension, paid by a steward who was never in the room to feel it
 * unless this rolls rarely enough that it reads as a real decision rather
 * than a reflex.
 */
const STEWARD_TUTOR_DILIGENCE = 0.03;
/** And the chance for somebody who can actually express it — still a term, not free money. */
const STEWARD_TUTOR_DILIGENCE_BLOOD = 0.1;
/**
 * The house never buys a term that would leave it under this — the same
 * margin `COMMISSION_FLOOR` keeps for a post, so a term and a commission are
 * weighed by the same standard rather than the treasury being spent to the
 * wire on whichever the steward happens to consider first.
 */
const STEWARD_TUTOR_FLOOR = 150;

/**
 * THE CHOSEN RATE, WRITTEN DOWN (issue #125, Stage 5). These four dials
 * (`STEWARD_TUTOR_DILIGENCE`, `STEWARD_TUTOR_DILIGENCE_BLOOD`,
 * `STEWARD_TUTOR_FLOOR`, `TUTOR_AGE_LIMIT`) together produce, measured on the
 * plain chronicler (no active policy) over sixteen full 500-year runs, gate
 * 4's own seeds (`5000 + i * 7`):
 *
 *   mean 9.36 tutor terms completed per generation (sd 1.65, 14 of 16 seeds
 *   reaching 1542 — see docs/BALANCE-LOG.md, "#125 Stage 5"), which at
 *   `TUTOR_FEE` = 40 crowns is on the order of 375 crowns a generation spent
 *   on schooling, against a treasury the same batch never let drop below
 *   `STEWARD_TUTOR_FLOOR`. Fewer than one term in three tried actually
 *   starts one (0.03 plain, 0.1 for a child who can express), which is the
 *   point — a term reads as a real decision spent rather than a reflex, and
 *   most of the pressure a real player feels at the table is still theirs to
 *   add on top of what the steward does alone.
 *
 * `schooling.slow.test.ts` pins the band (5–16 a generation) so a later
 * change to any of the four dials above has to clear this comment as well as
 * the test, rather than silently re-rolling both.
 */

/** Whether the market may be shown this person (`withhold`). */
export function onTheMarket(ctx: SimCtx, p: Person): boolean {
  return ctx.world.withheld[p.id] === undefined;
}

/** How much this person has been taught, over what the blood gave them. */
export function taught(ctx: SimCtx, p: Person, key: string): number {
  return attr(p, key, ctx.genetics, ctx.world.year);
}
