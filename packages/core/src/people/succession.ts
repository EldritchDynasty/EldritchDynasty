import type { CharacterRole, Person, RetainerRole } from '@ed/schema';
import { RetainerRoleS } from '@ed/schema';
import type { SimCtx } from '../world.js';
import { DEBT_FLOOR } from '../economy.js';
import { landIncome } from '../land.js';
import { isBonded } from './bond.js';
import type { Rng } from '../rng.js';
import { phenotypeOf } from './factory.js';
import { branchOf, recallToMain } from './branches.js';
import { eligibleTemplates, mint, mintForRole, pickTemplate } from './minting.js';
import { walkSecrets, type ReleaseReason } from './secrets.js';
import { headNamesake } from './naming.js';
import { MAIN_BRANCH } from '@ed/schema';
import { answerGenerationQuestion, chooseGenerationQuestion } from '../generation.js';

/**
 * Succession, and keeping the recurring cast filled.
 *
 * Without this, every `head`, `tutor` and `rival` slot becomes unfillable
 * within one generation and the event pool silently collapses to nothing. The
 * failure mode is not a crash — it is a thousand years in which nothing
 * happens, which is exactly the drift the design is most afraid of.
 */

export interface SuccessionResult {
  newHead?: Person;
  regency: boolean;
}

/**
 * Only a man who expresses may lead the house. When no living son of the blood
 * expresses, a woman of the blood holds it instead — she can defend, enrich,
 * negotiate and arrange marriages with precision, and she cannot advance
 * ascension by a single point. Nor can she accrue a single point of Madness.
 */
/**
 * WHO TAKES THE SEAT IF IT FALLS VACANT TODAY. Pure: it seats nobody, writes
 * nothing, and draws no dice.
 *
 * Split out of `ensureHead` rather than copied, because the succession is a
 * rule and a rule kept in two places is two rules by the second content drop.
 * `ensureHead` seats exactly what this returns; the cast reading (`cast.ts`)
 * shows exactly who that is, a generation before it happens, which is the
 * whole of what "the heir" means to a player.
 *
 * `excluding` is how a client asks for the heir while the head is still
 * alive — the sitting man is otherwise his own successor.
 *
 * `minAge` defaults to 16, the floor below which nobody has ever been
 * offered the seal (`naming.ts`'s own note on why it cannot answer "is this
 * newborn the heir"). `ensureHead` passes 0 to ask a different question —
 * who is next in line, full stop, minor or not — so Wardship can tell a
 * minor who outranks every living adult from one who does not.
 */

function successionSeniority(ctx: SimCtx, a: Person, b: Person): number {
  const w = ctx.world;
  const ab = branchOf(w, a, w.year) === MAIN_BRANCH ? 0 : 1;
  const bb = branchOf(w, b, w.year) === MAIN_BRANCH ? 0 : 1;
  return ab - bb || a.born - b.born;
}

function successionCandidates(ctx: SimCtx, excluding?: string, minAge = 16): Person[] {
  const w = ctx.world;
  return w.people.household(w.playerHouse, w.year)
    .filter(
      (p) => p.id !== excluding
        && p.membership.some((m) => m.kind === 'blood' || m.kind === 'cadet')
        && w.year - p.born >= minAge,
    )
    .sort((a, b) => successionSeniority(ctx, a, b));
}

export function heirApparent(ctx: SimCtx, excluding?: string, minAge = 16): Person | undefined {
  const blood = successionCandidates(ctx, excluding, minAge);

  const expressing = blood
    .filter((p) => p.sex === 'male' && phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch.canExpress);
  if (expressing.length) return expressing[0];

  // No expressing son. The house enters Regency, and the Ledger keeps counting.
  const women = blood.filter((p) => p.sex === 'female');
  if (women.length) return women[0];

  // A mundane man is better than nobody: he can hold a house, just not advance it.
  return blood.find((p) => p.sex === 'male');
}

export interface SuccessionView {
  /** Set only when every assignment of what the unwoken might reveal gives the same answer. */
  heir?: string;
  /** Everyone the seal could go to, in the same seniority order succession uses. */
  possible: string[];
  /** Why the answer is not yet settled, expressed only in facts the house knows. */
  because?: string;
}

/**
 * WHO THE HOUSE CAN HONESTLY CALL NEXT.
 *
 * The simulation rule may inspect an unwoken son's genome because the world
 * already has one. A view may not. Before Awakening, the family does not know
 * whether the font will come through him, and marking him (or skipping him) as
 * heir would turn a UI badge into a genetic test.
 *
 * This asks the rule under every relevant assignment of those unknowns without
 * inspecting their actual genome. Once a man awakens, canExpress is public and
 * the ordinary gate may be read.
 */
export function knownSuccession(ctx: SimCtx): SuccessionView {
  const sitting = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)
    .find((p) => p.castSlots.includes('head') && p.status === 'alive');
  const blood = successionCandidates(ctx, sitting?.id);
  const knownExpressers = blood.filter(
    (p) => p.sex === 'male'
      && p.awakening.awakened
      && phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch.canExpress,
  );
  const firstKnown = knownExpressers[0];

  // An unwoken man can alter the answer only if no already-known expresser
  // outranks him. With no known expresser, any unwoken man can win under some
  // assignment of what Awakening eventually reveals.
  const unknown = blood.filter(
    (p) => p.sex === 'male'
      && !p.awakening.awakened
      && (!firstKnown || successionSeniority(ctx, p, firstKnown) < 0),
  );

  const fallback = firstKnown
    ?? blood.find((p) => p.sex === 'female')
    ?? blood.find((p) => p.sex === 'male');

  const possiblePeople = [...unknown, ...(fallback ? [fallback] : [])]
    .filter((p, i, all) => all.findIndex((x) => x.id === p.id) === i)
    .sort((a, b) => successionSeniority(ctx, a, b));
  const possible = possiblePeople.map((p) => p.id);

  if (possible.length <= 1) {
    return {
      ...(possible[0] ? { heir: possible[0] } : {}),
      possible,
    };
  }

  const names = unknown
    .filter((p) => possible.includes(p.id))
    .map((p) => p.name);
  const named = names.length <= 1
    ? names[0]
    : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  return {
    possible,
    ...(named
      ? {
        because: named + ' ' + (names.length === 1 ? 'has' : 'have')
          + ' not yet awakened; the house does not know what the blood will reveal.',
      }
      : {}),
  };
}

/**
 * PUT THE SEAL ON HIM. The one place `castSlots` gains `'head'`, so
 * `ensureHead`'s ordinary path and Wardship's majority path share it rather
 * than keeping two copies of what taking the seat means.
 */
function seatHead(ctx: SimCtx, next: Person): boolean {
  const w = ctx.world;
  /** Seat him, and bring him home if he was not living in the main house. */
  next.castSlots.push('head');
  w.headSince = w.year;
  // THE LINE (issue #56). `castSlots` holds one head at a time and the caller
  // has already taken the seal off everybody, so this is the only moment the
  // handover exists to be written down. The name is copied because the player
  // renames people and this is what the house called him while he held it.
  const sitting = w.succession[w.succession.length - 1];
  if (sitting && sitting.to === undefined) {
    if (sitting.question) sitting.answer = answerGenerationQuestion(ctx, sitting.question);
    sitting.to = w.year;
  }
  const question = chooseGenerationQuestion(ctx, sitting?.question);
  w.succession.push({
    person: next.id, name: next.name, from: w.year,
    ...(question ? { question } : {}),
  });
  recallToMain(ctx, next);

  // A GREAT NAME IS SAID OUT LOUD THE YEAR IT TAKES THE SEAL (issue #62).
  //
  // The bar `assizePressure` grades this house on has just risen, and a
  // reading the player can feel and cannot name is the one thing invariant 13
  // forbids. Written here rather than in `assize.ts` because it is not a
  // response — nothing has been done to the house — it is the world noticing
  // what the house has just called its Head. `headNamesake` is computed after
  // the seal is on him, since it reads the sitting Head.
  const namesake = headNamesake(ctx);
  if (namesake) {
    w.chronicle.push({
      year: w.year,
      weight: 'paragraph',
      title: `${namesake.name}, again`,
      text: `The house had a ${namesake.name} before, and everyone who deals with it `
        + 'remembers what that name was worth. They will expect the same, and they will '
        + 'not be gentle about the difference.',
      named: false,
    });
  }

  // A woman holding the seat IS the Regency — invariant 1 means she cannot
  // express, and `ensureHead`'s early return above reads it the same way.
  const regency = next.sex === 'female';
  if (regency) {
    w.chronicle.push({
      year: w.year,
      weight: 'paragraph',
      title: 'A Regency',
      text: `No son of the house woke, and so ${next.name} held it. She held it well, and she could not move it an inch.`,
      named: false,
    });
  }
  return regency;
}

export function ensureHead(ctx: SimCtx, rng: Rng): SuccessionResult {
  const w = ctx.world;
  const living = w.people.household(w.playerHouse, w.year);
  const current = living.find((p) => p.castSlots.includes('head') && p.status === 'alive');
  if (current) return { newHead: undefined, regency: current.sex === 'female' };

  // WARDSHIP (world "Taxes": "If an heir is under 16, the Warden may take the
  // estate's management until majority"). The ward reaching sixteen, or dying
  // first, ends this either way — `tickEconomy` stops reading `w.wardship`
  // the same year, so a stale flag can never go on diverting income nobody
  // is collecting for.
  if (w.wardship) {
    const ward = w.people.get(w.wardship.ward);
    if (ward && ward.status === 'alive' && w.year - ward.born < 16) {
      void rng;
      return { regency: false };
    }
    // `delete`, not `= undefined` — the latter leaves `wardship` an own,
    // enumerable key holding `undefined`, so a world that passed through a
    // Wardship and left it would carry a key a freshly loaded save never
    // gets to assign at all, and `corpus.slow.test.ts`'s key-parity check
    // catches exactly that divergence.
    delete w.wardship;
    if (ward && ward.status === 'alive') {
      for (const p of w.people.all()) p.castSlots = p.castSlots.filter((s) => s !== 'head');
      const regency = seatHead(ctx, ward);
      const pronoun = ward.sex === 'female' ? 'she' : 'he';
      w.chronicle.push({
        year: w.year,
        weight: 'paragraph',
        title: 'Come of age',
        text: `${ward.name} turned sixteen this year, and the Warden's clerk rode out to hand `
          + `back the keys ${pronoun} had never yet held.`,
        named: false,
      });
      void rng;
      return { newHead: ward, regency };
    }
    // The ward died a minor. Ordinary succession decides who is next —
    // which may itself be a minor, and open a second Wardship below.
  }

  for (const p of w.people.all()) {
    p.castSlots = p.castSlots.filter((s) => s !== 'head');
  }

  // The age-blind rightful heir — who is next in line, full stop — decides
  // whether this is Wardship or an ordinary seating. `heirApparent`'s default
  // 16-year floor would silently hand the seat to an uncle or cousin instead,
  // which is exactly the seniority rule invariant 15 already refuses to bend
  // for a cadet: a better claim does not lose to an available one.
  const rightful = heirApparent(ctx, undefined, 0);
  if (rightful && w.year - rightful.born < 16) {
    w.wardship = { ward: rightful.id, since: w.year };
    const pronoun = rightful.sex === 'female' ? 'she' : 'he';
    w.chronicle.push({
      year: w.year,
      weight: 'paragraph',
      title: 'The Warden takes the roll',
      text: `${rightful.name} is not yet sixteen, and by the Warden's right the estate's `
        + `management passes to Cawdry until ${pronoun} comes of age — or until the house `
        + 'can buy the wardship back.',
      named: false,
    });
    void rng;
    return { regency: false };
  }

  const next = heirApparent(ctx);
  if (!next) {
    void rng;
    return { regency: false };
  }

  const regency = seatHead(ctx, next);
  void rng;
  return { newHead: next, regency };
}

/** World "Taxes": "about three years' income". */
export const WARDSHIP_BUYBACK_YEARS = 3;

/**
 * BUY THE WARDSHIP BACK. Ends the diversion of land income to the Warden
 * without ending the minority itself — the ward still cannot hold the seal
 * before sixteen (`ensureHead`), but from this year the house, not Cawdry,
 * spends what the land makes. `landIncome` rather than `tickEconomy`'s
 * charm-adjusted figure: the world names a price, not a formula, and the
 * base yield is the honest reading of "about three years' income" without
 * also pricing in a Charm the Warden's clerk never asked about.
 */
export function buyBackWardship(ctx: SimCtx): { ok: boolean; reason?: string; spent?: number } {
  const w = ctx.world;
  if (!w.wardship) return { ok: false, reason: 'the house is not under wardship' };
  if (w.wardship.boughtBack) return { ok: false, reason: 'the wardship is already bought back' };
  const cost = WARDSHIP_BUYBACK_YEARS * landIncome(ctx);
  if (w.treasury - cost < DEBT_FLOOR) return { ok: false, reason: 'cannot afford the wardship' };
  w.treasury -= cost;
  w.wardship.boughtBack = true;
  const ward = w.people.get(w.wardship.ward);
  w.chronicle.push({
    year: w.year,
    weight: 'paragraph',
    title: 'The wardship bought back',
    text: ward
      ? `The Warden's clerk took the house's coin and stopped taking the harvest. `
        + `${ward.name} is still not the Head — that waits on sixteen — but the land is the house's again.`
      : 'The Warden\'s clerk took the house\'s coin and stopped taking the harvest.',
    named: false,
  });
  return { ok: true, spent: cost };
}

/**
 * A CONTRACT ENDS WITH THE MAN WHO SIGNED IT.
 *
 * Every field on `RetainerContract` that decides how service ENDS was dead
 * code. `onEmployerDeath` was declared on all four authored contracts and read
 * nowhere; `term` — seasonal, yearly, lifetime, bonded, hereditary — was read
 * nowhere either. Worse, `mint` overwrote the authored `boundTo` with the
 * house id, so the employer could never die and the enum could never fire. A
 * steward's blurb says out loud that his contract is hereditary and that
 * "servant dynasties need real lineage too", and his children inherited
 * nothing for a thousand years.
 *
 * Contracts now bind to the HEAD who hired them, which is what makes
 * `passes_to_heir` mean something, and the term decides what happens after.
 */
export interface ServiceEnded {
  person: Person;
  /** The whole sentence, in the engine's words. */
  text: string;
  reason: ReleaseReason;
}

/**
 * WHICH ENDINGS OF SERVICE A CHRONICLER WRITES DOWN (issue #87).
 *
 * `employer_died` does not. An employer dying releases every retainer bound to
 * him at once and each one wrote its own `line`, so one sentence — *"X was
 * released from service, the one who hired them being some years dead"* — was
 * eleven of the sixty entries the chronicle panel draws. That is 18% of the
 * window, and it is the same class as #82's shelf line exactly: demography on
 * the wrong side of the split `year/passage.ts` draws. Nobody writes a
 * separate paragraph per servant when a man dies; they write that the man
 * died.
 *
 * The other three stay, because each is the HOUSE doing something. `unpaid`
 * and `destitute` are an empty treasury costing the player their staff, which
 * is the first thing an empty treasury actually costs. `freed` is a dead man's
 * will, which is his last act and the house honouring it.
 */
const WORTH_WRITING: Record<ReleaseReason, boolean> = {
  unpaid: true, destitute: true, freed: true, employer_died: false,
};

export function releaseContracts(ctx: SimCtx, rng: Rng): ServiceEnded[] {
  const w = ctx.world;
  const released: ServiceEnded[] = [];
  const head = w.people.living().find((p) => p.castSlots.includes('head'));

  /**
   * Read the contract BEFORE clearing it. What a servant knows lives on the
   * contract, so a secret tested after the release is a secret nobody knows —
   * which is how `knowsSecrets` would have gone on doing nothing even with a
   * mechanism behind it (`people/secrets.ts`).
   */
  const release = (p: Person, why: string, reason: ReleaseReason) => {
    const contract = p.contract;
    p.contract = undefined;
    const text = `${p.name} ${why}`;
    released.push({ person: p, text, reason });
    if (WORTH_WRITING[reason]) {
      w.chronicle.push({ year: w.year, weight: 'line', text, named: false });
    }
    if (contract) walkSecrets(ctx, p, contract, reason, rng);
  };

  for (const p of w.people.living()) {
    const contract = p.contract;
    if (!contract) continue;

    // A BOND IS NOT A WAGE, so none of what follows can end it (world §12).
    // Arrears cannot: there are no arrears, the wage services the debt. The
    // debt floor cannot: a house with nothing left still holds what it is
    // owed, and that is precisely what "held by debt" means. Nor can the death
    // of the man who signed it — a debt is an asset of the HOUSE, and it
    // outlives him the way the mill does.
    //
    // This is the whole of the unfree tier, and it is one `continue`.
    if (isBonded(p)) continue;

    // A short-term contract is renewed while the house can pay for it, and a
    // house that cannot pay loses its staff. This is the first thing an empty
    // treasury actually costs the player.
    if ((contract.term === 'seasonal' || contract.term === 'yearly') && w.treasury < contract.wage / 20) {
      release(p, 'was not kept on, the quarter\'s wages being what they were.', 'unpaid');
      continue;
    }

    // A lifetime contract is a promise of employment, not an exemption from
    // being paid. A house pinned at the borrowing limit loses even the staff
    // it swore to keep — which is what destitution means, and it is why
    // clause recovery is something a solvent house earns rather than
    // something every house is handed. Hereditary service is a family bound
    // to the house rather than a wage, and does not lapse.
    if (w.treasury <= DEBT_FLOOR && contract.term !== 'hereditary') {
      release(p, 'left the house, there being nothing left to pay them with.', 'destitute');
      continue;
    }

    const employer = w.people.get(contract.boundTo);
    if (employer && employer.status === 'alive') continue;
    // Bound to the house itself rather than to a man: never lapses.
    if (!employer && contract.boundTo === w.playerHouse) continue;

    if (contract.onEmployerDeath === 'passes_to_heir' && head) {
      contract.boundTo = head.id;
      continue;
    }
    // FOLLOWS THE PERSON THEY WERE PROMISED TO, which is what the option has
    // always said and never did: with no field naming anybody it rebound to
    // the Head, making it a second spelling of `passes_to_heir`. A named
    // person who is themselves dead falls through to the heir, because that is
    // what happens when the one you were promised to went first.
    if (contract.onEmployerDeath === 'follows_named') {
      const named = contract.follows ? w.people.get(contract.follows) : undefined;
      if (named && named.status === 'alive') {
        contract.boundTo = named.id;
        continue;
      }
      if (head) {
        contract.boundTo = head.id;
        continue;
      }
    }
    // FREED is not RELEASED. The debt dies with him and they go owing nothing,
    // which `walkSecrets` reads as a different kind of leaving — a servant let
    // go in a dead man's will does not take the house's business with them the
    // way a dismissed one does.
    if (contract.onEmployerDeath === 'freed') {
      contract.debt = 0;
      release(p, 'was freed by the will of the one who hired them, owing nothing.', 'freed');
      continue;
    }
    release(p, 'was released from service, the one who hired them being some years dead.', 'employer_died');
  }
  return released;
}

/**
 * Servant dynasties. A hereditary post passes to a child of the house's own
 * staff before anybody thinks to hire a stranger — which is the whole of what
 * "hereditary" was supposed to buy, and is also how a family ends up with an
 * archivist whose great-grandmother filed the thing he is looking for.
 */
export function inheritPost(ctx: SimCtx, role: RetainerRole): Person | undefined {
  const w = ctx.world;
  const last = w.people
    .all()
    .filter((p) => p.contract?.role === role && p.contract.term === 'hereditary' && p.status !== 'alive')
    .sort((a, b) => (b.died ?? 0) - (a.died ?? 0))[0];
  if (!last) return undefined;

  const heir = w.people
    .children(last.id)
    .filter((c) => c.status === 'alive' && w.year - c.born >= 16 && !c.contract)
    .sort((a, b) => a.born - b.born)[0];
  if (!heir) return undefined;

  const head = w.people.living().find((p) => p.castSlots.includes('head'));
  heir.contract = { ...last.contract!, boundTo: (head?.id) ?? w.playerHouse };
  w.chronicle.push({
    year: w.year,
    weight: 'line',
    text: `${heir.name} took up ${last.name}'s post, which had been in that family nearly as long as the seal.`,
    named: false,
  });
  return heir;
}

/**
 * INVARIANT Which posts the house may hire into is a property of CONTENT.
 *
 * `RetainerRoleS` declares eight roles. A role no template can fill is a post
 * `maintainCast` checks every year and can never occupy, so it does not belong
 * in the loop — and for a long time the way this file said so was a hand-kept
 * list of five, which is a second copy of the content and went stale the
 * moment somebody wrote the sixth template. `singer`, `physician` and
 * `chronicler` sat in the union for a year with nothing behind them and
 * nothing anywhere said so.
 *
 * So read the list off the templates. In the union's declared order, because
 * the order decides which post gets this year's hiring roll first and that has
 * to be the same in every run of the same seed — a set's iteration order is
 * the templates' file order, and file order is not a thing a save can hold.
 */
function hireableRoles(ctx: SimCtx): RetainerRole[] {
  const named = new Set<string>();
  for (const t of ctx.content.characterTemplates) {
    if (t.role === 'retainer' && t.contract) named.add(t.contract.role);
  }
  return RetainerRoleS.options.filter((r) => named.has(r));
}

/** Cast slots kept occupied by minting, and the role that refills each. */
const CAST_ROLES: { slot: string; role: CharacterRole; chance: number }[] = [
  { slot: 'rival', role: 'rival', chance: 0.5 },
  { slot: 'the_match', role: 'the_match', chance: 0.25 },
];

/**
 * Recurring roles are refilled with new people every few generations, so the
 * family's history rhymes. Event authors write to SLOTS, not to individuals —
 * which only works if somebody keeps the slots occupied.
 */
/** How far clear of the borrowing limit a house must be to take somebody on. */
const HIRING_HEADROOM = 40;

export function maintainCast(ctx: SimCtx, rng: Rng): Person[] {
  const w = ctx.world;
  const added: Person[] = [];
  const living = w.people.living();

  // ── Household retainers, drawn from character templates ────────────────
  for (const role of hireableRoles(ctx)) {
    if (living.some((p) => p.contract?.role === role)) continue;

    // The staff's own children first. Hiring a stranger into a hereditary post
    // while the last holder's son is in the house is how you lose the son.
    const inherited = inheritPost(ctx, role);
    if (inherited) { added.push(inherited); continue; }

    if (!rng.bool(0.35)) continue;
    // Enough to pay the wage and still be solvent, rather than a flat twenty
    // crowns. The flat bar was written when the house ran to thousands; once
    // the Assize started assessing a visibly rich family, a run spent long
    // stretches under it and the eight household posts emptied — measured at
    // 0.8 of 8 filled, which looks exactly like a hiring system that works.
    if (w.treasury <= DEBT_FLOOR + HIRING_HEADROOM) continue;

    const candidates = eligibleTemplates(ctx, 'retainer').filter((t) => t.contract?.role === role);
    const template = rng.weighted(candidates, (t) => t.weight);
    if (!template) continue;
    added.push(mint(template, ctx, rng, { household: w.playerHouse, membership: 'retainer' }));
  }

  // ── Recurring cast: refilled when the last occupant dies ────────────────
  for (const { slot, role, chance } of CAST_ROLES) {
    if (living.some((p) => p.castSlots.includes(slot))) continue;
    if (!rng.bool(chance)) continue;
    const p = mintForRole(ctx, role, rng);
    if (p) added.push(p);
  }

  // ── Mythic arrivals: rationed by the same tier system events use ────────
  const wanderer = pickTemplate(ctx, 'wanderer', rng);
  if (wanderer && rng.bool(0.05)) {
    const p = mint(wanderer, ctx, rng, { household: w.playerHouse, membership: 'none' });
    added.push(p);
    w.chronicle.push({
      year: w.year,
      weight: 'illuminated',
      title: wanderer.title,
      text: wanderer.blurb ?? `${p.name} arrived, and nobody had sent for them.`,
      named: true,
    });
  }

  // ── The Fragile One: found rather than minted. ────────────────────────
  // Huge font, poor channel — enormous pressure with no vessel. Always a boy,
  // because only those who can express can break.
  if (!living.some((p) => p.castSlots.includes('fragile'))) {
    const candidate = w.people
      .household(w.playerHouse, w.year)
      .filter((p) => {
        const e = phenotypeOf(p, ctx.genetics, w.year).eldritch;
        return e.canExpress && e.overflowMadness > 4;
      })
      .sort((a, b) =>
        phenotypeOf(b, ctx.genetics, w.year).eldritch.overflowMadness
        - phenotypeOf(a, ctx.genetics, w.year).eldritch.overflowMadness)[0];
    if (candidate) candidate.castSlots.push('fragile');
  }

  return added;
}
