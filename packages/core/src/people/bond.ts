import type { Person } from '@ed/schema';
import type { SimCtx } from '../world.js';
import { msg } from '../messages.js';

/**
 * THE BOND — how this world holds a person who would rather go (world §12).
 *
 * The design says what this may and may not be, and it is worth quoting
 * because it is the whole specification:
 *
 *   *"Nobody in this world is a slave and there is no serfdom in Aubren.
 *   People are held by debt, custom, contract and having nowhere else to go,
 *   which is sufficient."*
 *
 * So there is no chattel tier here and there will not be one. What there is is
 * DEBT, and debt is sufficient: a bonded servant cannot leave for arrears,
 * cannot leave when the house is destitute, and is not released by the death
 * of the man who signed them. Everything an unfree tier does mechanically,
 * done by the one instrument the world actually has.
 *
 * `term: 'bonded'` has been in `RetainerContractS` since its first draft and
 * meant nothing: `releaseContracts` tested `seasonal`, `yearly` and
 * `hereditary` by name and a bonded contract fell through every branch as
 * though it were `lifetime`. It had no sum attached, so there was nothing for
 * it to be a bond ABOUT. `RetainerContract.debt` is that sum and this file is
 * what reads it.
 *
 * THE PRICE OF CHEAP HANDS. A bonded servant is not paid — the wage services
 * the debt instead — so `driftLoyalty` cannot buy their silence, and a bond
 * long enough to be worth taking is long enough to end in somebody who knows
 * things and is owed nothing. That is not a balance penalty bolted on. It is
 * the same trade the rest of this game makes: the cheap option is cheap now
 * and is charged for later, by a system that was already running.
 *
 * Units are MARKS, because `RetainerContract.wage` is marks a year (world §11)
 * and a debt that a wage pays down has to be in the wage's own money. The
 * treasury is in crowns; `CROWN` is the conversion and it is world §13's.
 */

/** 1 crown = 20 marks (concept §13). */
export const CROWN = 20;

/**
 * What the house may not advance beyond, in marks.
 *
 * A bond has to be payable off inside a working life or it is not a debt, it
 * is the thing world §12 says this world does not have. At a steward's 6 marks
 * a year this is a little over thirty years of service, which is long, hard,
 * and finite — and the servant who works it off walks out knowing everything.
 */
export const MAX_BOND = 200;

export function isBonded(p: Person): boolean {
  return p.contract?.term === 'bonded' && p.contract.debt > 0;
}

/** Everyone the house is currently holding by debt. */
export function bondsmen(ctx: SimCtx): Person[] {
  return ctx.world.people.living().filter(isBonded);
}

/**
 * Advance a sum against service. The house buys hands it does not have to pay
 * for, and acquires a person with a reason to resent it.
 *
 * Refuses to bond somebody already bonded rather than stacking debts: a second
 * advance against a standing bond is how a debt stops being payable, and a
 * debt that cannot be paid is the tier this world does not have.
 */
export function bindService(ctx: SimCtx, p: Person, marks: number): boolean {
  const c = p.contract;
  if (!c || isBonded(p)) return false;
  if (marks <= 0 || marks > MAX_BOND) return false;

  c.term = 'bonded';
  c.debt = marks;
  ctx.world.treasury -= marks / CROWN;
  ctx.world.chronicle.push({
    year: ctx.world.year,
    weight: 'line',
    text: msg(ctx, 'bond.advanced',
      '{PERSON} took {MARKS} marks from the house and gave the years back for it.',
      { PERSON: p.name, MARKS: String(marks) }),
    named: false,
  });
  return true;
}

/**
 * What tearing up a bond buys, in loyalty.
 *
 * Large, and it is meant to be: this is the pro, and it is paid in the one
 * currency that decides whether a servant talks. A man freed at 40 sits at 70
 * afterwards, and `leakChance` reads the difference for the rest of his life.
 */
export const FREEDOM_LOYALTY = 30;

/**
 * WHAT THE OTHERS THINK, and the reason freeing is a decision rather than a
 * button marked BE DECENT.
 *
 * It was done, in front of them, for somebody else. Every bondsman still held
 * now knows the house can tear one of these up whenever it likes and did not
 * tear up theirs. Freeing the whole hall costs every debt the house is owed;
 * freeing one costs the goodwill of everyone left, which is worse per head and
 * cheaper to reach for. That is the trade, and it is self-limiting from both
 * ends without a cap anywhere.
 */
export const RESENTMENT_OF_FREEDOM = 8;

/** What freeing somebody actually did, so a caller can say so. */
export interface Freeing {
  ok: boolean;
  forgiven: number;
  resented: number;
}

/**
 * The debt is forgiven and the bond ends.
 *
 * Distinct from being released, and that distinction is the point of the
 * `freed` branch of `onEmployerDeath`, which until now did exactly what
 * `released` did. A freed servant leaves owing nothing and does not carry the
 * grievance that drives a secret out of the house — see `walkSecrets`, whose
 * `ReleaseReason` decides how bitter the leaving was.
 *
 * ─── What it costs, and what it buys ────────────────────────────────────────
 *
 * AGAINST.  The debt is written off, and the sum is an asset. They go onto
 *           `yearly` terms, which means they draw a wage the house has not
 *           been paying and `releaseContracts` can let them go the next lean
 *           quarter — a captive who could not leave becomes an employee who
 *           can. And every other bondsman in the house loses
 *           `RESENTMENT_OF_FREEDOM`, because it was done for him and not for
 *           them.
 *
 * FOR.      The freed man's loyalty jumps by `FREEDOM_LOYALTY`, which is the
 *           whole of the defence in `leakChance`. A bond runs the other way —
 *           `LOYALTY_BONDED` bleeds him a little every year — so the house
 *           that holds a man for thirty years and then lets him go has bought
 *           itself somebody who knows where everything is and owes it nothing.
 *           Freeing him is how that is not what happens.
 *
 * So the two ways out of a bond are: work it off, and end up with a bitter man
 * who knows things; or tear it up, and pay for a loyal one in coin and in the
 * temper of everybody still held. Neither is the safe answer, which is the
 * shape every decision in this game is supposed to have.
 */
export function freeBond(ctx: SimCtx, p: Person): Freeing {
  const c = p.contract;
  if (!c || c.term !== 'bonded') return { ok: false, forgiven: 0, resented: 0 };

  const forgiven = c.debt;
  c.debt = 0;
  c.term = 'yearly';
  c.loyalty = Math.min(100, c.loyalty + FREEDOM_LOYALTY);

  // Counted AFTER he is discharged above, which is why `bondsmen` needs no
  // exception for him: he is `yearly` by this line and is no longer one. Move
  // this block up and the freed man docks his own loyalty for his own freeing.
  let resented = 0;
  for (const other of bondsmen(ctx)) {
    const oc = other.contract!;
    oc.loyalty = Math.max(0, oc.loyalty - RESENTMENT_OF_FREEDOM);
    resented += 1;
  }

  ctx.world.chronicle.push({
    year: ctx.world.year,
    weight: 'paragraph',
    title: msg(ctx, 'bond.freed_title', 'The bond'),
    text: forgiven > 0
      ? msg(ctx, 'bond.forgiven',
        'The house tore up what {PERSON} still owed — {MARKS} marks of it — and said so where people could hear.',
        { PERSON: p.name, MARKS: String(forgiven) })
        + (resented ? ' ' + msg(ctx, 'bond.forgiven_resented', 'Not everybody who heard it was glad.') : '')
      : msg(ctx, 'bond.ended_empty',
        "{PERSON}'s bond was ended, there being nothing left on it worth the ink.",
        { PERSON: p.name }),
    named: false,
  });
  return { ok: true, forgiven, resented };
}

/**
 * A year of service against the debt.
 *
 * The wage is not paid out; it comes off what is owed. A bond therefore costs
 * the house nothing in the years it is running, which is the entire reason a
 * house would take one, and is why the cost has to sit somewhere else.
 *
 * When the last of it is worked off the bond discharges to a `yearly`
 * contract rather than ending the service. They are a servant now, on wages,
 * who spent thirty years not being paid by this family and remembers it — and
 * `releaseContracts` can let them go the next lean quarter, on the ordinary
 * terms, with everything they know.
 */
export function serviceBonds(ctx: SimCtx): Person[] {
  const discharged: Person[] = [];
  for (const p of bondsmen(ctx)) {
    const c = p.contract!;
    c.debt = Math.max(0, c.debt - c.wage);
    if (c.debt > 0) continue;

    c.term = 'yearly';
    discharged.push(p);
    ctx.world.chronicle.push({
      year: ctx.world.year,
      weight: 'line',
      text: msg(ctx, 'bond.discharged',
        '{PERSON} finished paying the house what {PERSON} had borrowed, and stayed on for wages.',
        { PERSON: p.name }),
      named: false,
    });
  }
  return discharged;
}
