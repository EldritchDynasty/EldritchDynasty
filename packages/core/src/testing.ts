import type { Content, ContentBundle, Person, Sex } from '@ed/schema';
import { asId, MAIN_BRANCH } from '@ed/schema';
import type { SimCtx } from './world.js';
import { bootstrap } from './sim.js';
import { makePerson } from './people/factory.js';
import { makeRng, hashSeed } from './rng.js';
import { emptyReport, type YearReport } from './year/report.js';
import { YEAR_PHASES } from './year/phases.js';
import { streamFor } from './rng.js';
import { livingBlood } from './ending.js';
import { isCaput } from './land.js';

/**
 * TEST SCAFFOLDING.
 *
 * Every test in this codebase used to reach the state it wanted by simulating
 * its way there — four hundred years to get a widow, six hundred to get a
 * cadet branch with a grievance — which is why the suite costs twenty-one
 * minutes of CPU and why a failure takes a while to localise.
 *
 * The long runs are not the problem: `demography.test.ts` and `arcs.test.ts`
 * assert the SHAPE OF A HEALTHY RUN, and there is no way to check that except
 * by running one. The problem is that a test about one function had no other
 * option. These helpers are the other option — build the world you mean, run
 * the one phase you are testing, assert.
 *
 * Real content throughout. A hand-built miniature bundle would be a second
 * definition of the game, and the second definition is always the one that
 * quietly stops matching.
 */

/** A world with the founding cast in it and nothing else having happened. */
export function testWorld(source: ContentBundle | Content, seed = 1042, year = 1042): SimCtx {
  return bootstrap(source, seed, year);
}

export interface PlacedPerson {
  sex: Sex;
  /** Age this year, which is friendlier to write than a birth year. */
  age: number;
  name?: string;
  house?: string;
  branch?: string;
  /** 'head' makes them the sitting Head; anything else is an ordinary cast tag. */
  castSlots?: string[];
  traits?: string[];
  contract?: Person['contract'];
  /**
   * A post already held, and how long they have held it. Deliberately not
   * routed through the `career` effect: scaffolding builds the state a test
   * means, including states the effect's own `minAge` guard would refuse.
   */
  career?: { career: string; heldYears?: number };
  /**
   * Already woken, as of this year (issue #79).
   *
   * §11's learning gate means an unwoken person cannot open a book at all, so
   * a test about the LIBRARY — the shelf, a copy's condition, what a study
   * costs — has to say so, or it is a test about the gate instead. Scaffolding
   * on the same principle as `career`: it builds the state the test means,
   * without routing through `rollAwakening`, which needs a font and a die.
   */
  awakened?: boolean;
}

/**
 * Put someone in the world, fully formed.
 *
 * Their genome is lazy and derived from their name and age, so the same call
 * produces the same person every time the test runs — a test that places "a
 * forty-year-old man of the house" and gets a different Strength each run is a
 * test that will eventually fail for no reason.
 */
export function place(ctx: SimCtx, spec: PlacedPerson): Person {
  const w = ctx.world;
  const house = spec.house ?? w.playerHouse;
  const name = spec.name ?? `Test${w.counters.person + 1}`;
  const seed = hashSeed(w.seed, 'placed', name, spec.age);

  const p = makePerson({
    sex: spec.sex,
    born: w.year - spec.age,
    house,
    name,
    genome: { kind: 'lazy', pool: house, seed },
    seed,
    seq: w,
  });

  p.castSlots = [...(spec.castSlots ?? [])];
  if (spec.awakened) p.awakening = { ...p.awakening, awakened: true, year: w.year, age: spec.age };
  for (const t of spec.traits ?? []) p.traits.add(asId(t));
  if (spec.contract) p.contract = spec.contract;
  if (spec.career) {
    p.career = { career: asId(spec.career.career), from: w.year - (spec.career.heldYears ?? 0) };
  }
  if (spec.branch && spec.branch !== MAIN_BRANCH && p.membership[0]) {
    p.membership[0].branch = spec.branch;
  }

  ctx.takenNames.add(name);
  w.people.add(p);
  return p;
}

/** Marry two people as of this year, on both sides, the way `kill` expects. */
export function marry(ctx: SimCtx, a: Person, b: Person): void {
  a.marriages.push({ spouse: b.id, from: ctx.world.year });
  b.marriages.push({ spouse: a.id, from: ctx.world.year });
}

/** Give a child two parents after the fact, keeping the kin index honest. */
export function beget(ctx: SimCtx, child: Person, mother?: Person, father?: Person): void {
  ctx.world.people.setParents(child.id, {
    ...(mother ? { mother: mother.id } : {}),
    ...(father ? { father: father.id } : {}),
  });
  child.claimedParents = { ...child.trueParents };
}

/**
 * Run one named phase of the year, with that phase's own stream, and hand back
 * what it reported. The year does NOT advance — the point is to exercise one
 * system against a state you built by hand.
 */
export function phase(name: string, ctx: SimCtx, autoResolve = true): YearReport {
  const found = YEAR_PHASES.find((p) => p.name === name);
  if (!found) {
    throw new Error(`no year phase '${name}'; there are ${YEAR_PHASES.map((p) => p.name).join(', ')}`);
  }
  const report = emptyReport(ctx.world.year);
  found.run({ ctx, rng: streamFor(ctx.world, found.name), report, autoResolve });
  return report;
}

/** A throwaway stream, for calling an engine function directly. */
export function testRng(...salt: (string | number)[]) {
  return makeRng(hashSeed('test', ...salt));
}

/**
 * ─── BATCH CLAIMS, AND WHETHER THEY CAN CARRY THEIR OWN THRESHOLD ───────────
 *
 * Three tests in this suite have now broken on commits that changed nothing
 * they measured, and all three failed the same way: a threshold set by eye off
 * the same batch it was about to be tested on.
 *
 * `gives the family somewhere to quarrel with itself` is the clearest. It
 * counted feuds across twelve runs and asserted more than eight. Measured over
 * 48 seeds the underlying rate is 81%–90%, so at twelve runs that assertion
 * fails somewhere between one time in eleven and one time in four WITH NOTHING
 * WRONG. It duly went red on two household templates that fire under once a run
 * between them and create no grudges at all — because adding any template to
 * the pool re-rolls which scene wins every draw for a thousand years. That is
 * not a regression. It is what a shared draw means.
 *
 * The trouble is that a thin margin is INVISIBLE. A passing test looks exactly
 * like a well-powered one, right up until an unrelated commit spends its luck,
 * and then somebody reads a real finding into a coin landing tails.
 *
 * So the margin is asserted alongside the claim. `expectRate` fails twice over:
 * once if the claim is false, and once if the claim is true BY LUCK — if the
 * observed rate is not at least `MIN_MARGIN_SE` standard errors clear of the
 * floor. The second failure is not a bug report about the game. It is a bug
 * report about the test, and it says what to do: widen the batch.
 *
 * This is deliberately not a gate and not a lint. It runs inside the test that
 * makes the claim, on the batch that test actually ran, so it cannot drift out
 * of date and there is no second list for anybody to maintain.
 */

/**
 * How many standard errors a threshold must sit clear of the measured rate.
 *
 * Two. At two SE a claim survives about nineteen unrelated commits in twenty,
 * which is the point at which a red test is worth reading. One SE is a third of
 * builds and teaches everybody to re-run and shrug, which is worse than having
 * no test at all — a test nobody believes still costs the wall time.
 */
export const MIN_MARGIN_SE = 2;

export interface RateClaim {
  /** Runs where the thing happened. */
  hits: number;
  /** Runs in the batch. */
  n: number;
  /** The claim: the true rate is above this. Exactly one of `floor`, `ceiling`. */
  floor?: number;
  /**
   * The claim: the true rate is BELOW this.
   *
   * `expectMean` grew this first, for the reason written on it — half the
   * batch claims in these suites are budgets rather than floors. Rates are the
   * same story: "under a tenth of the dead reached their own ceiling", "under
   * three per cent of an outbred population is homozygous". Every one of those
   * was a bare `toBeLessThan` on a proportion, which is exactly what this
   * helper exists to replace, so the guard was missing from precisely the
   * assertions nobody had checked the margin on.
   */
  ceiling?: number;
  /** What the rate is OF, for the failure message. */
  what: string;
}

/**
 * The standard error of a proportion, with a floor under it.
 *
 * A batch where everything happened gives `p = 1` and an SE of exactly zero,
 * which would report infinite confidence off a sample that has simply not seen
 * the other outcome yet. The Laplace-style floor of `1/n` is what a single
 * counter-example would cost, and it keeps a small clean batch honest: twelve
 * for twelve is good evidence, not proof.
 */
export function proportionSE(hits: number, n: number): number {
  if (n <= 0) return Infinity;
  const p = hits / n;
  return Math.max(Math.sqrt((p * (1 - p)) / n), 1 / n);
}

/**
 * Assert a rate claim AND that the batch is big enough to make it.
 *
 * Returns the margin in standard errors so a caller can print it; throws
 * through `expect` on either failure.
 */
export function expectRate(claim: RateClaim): number {
  const { n, what } = claim;
  if ((claim.floor === undefined) === (claim.ceiling === undefined)) {
    throw new Error(`${what}: name exactly one of floor and ceiling — a claim with both is two claims`);
  }

  /**
   * A CEILING IS A FLOOR READ IN A MIRROR, which is `expectMean`'s trick and
   * is borrowed rather than reinvented. For a proportion the mirror is the
   * complement: "under a tenth did" is "over nine tenths did not", and the
   * standard error of a proportion is symmetric about a half, so the margin
   * that comes out is the same number the direct calculation would give.
   *
   * One piece of statistics, not two. Only the messages have to remember
   * which way round the claim was made.
   */
  const under = claim.ceiling !== undefined;
  const hits = under ? n - claim.hits : claim.hits;
  const floor = under ? 1 - claim.ceiling! : claim.floor!;

  const p = hits / n;
  const se = proportionSE(hits, n);
  const margin = (p - floor) / se;
  const shown = under ? claim.hits : hits;
  const seen = `${shown} of ${n} runs (${((shown / n) * 100).toFixed(0)}%)`;
  const said = `${under ? 'under' : 'more than'} ${((under ? claim.ceiling! : floor) * 100).toFixed(0)}%`;

  // A PLAIN THROW, not `expect`. This file is re-exported from the package
  // index — `place`, `testWorld` and `phase` are how every suite builds the
  // state it means — so importing vitest here would put the test runner into
  // the dependency graph of the client and the shell. Vitest reports a thrown
  // Error as a failure with its message, which is all that is wanted.
  if (!(p > floor)) {
    throw new Error(`${what}: ${seen}, and the claim is ${said}`);
  }

  if (margin < MIN_MARGIN_SE) {
    // The batch that would carry it, plus a fifth. `n` scales as the SQUARE of
    // the margin wanted, so the bare figure lands exactly on the bar — and a
    // recommendation that only just clears it fails as soon as the widened
    // batch's own rate drifts a run either way, which is the same mistake this
    // helper exists to catch, made by the helper. Its own test asserts the
    // advice actually works when taken.
    const wants = Math.ceil(n * (MIN_MARGIN_SE / Math.max(margin, 0.1)) ** 2 * 1.2);
    throw new Error(
      `${what}: the claim holds at ${seen}, but only by ${margin.toFixed(1)} standard errors — under `
      + `${MIN_MARGIN_SE}, so an unrelated commit re-rolling the draw flips it. This is a finding about `
      + `the TEST, not the game. Widen the batch (about ${wants} runs would carry it), or move the `
      + `${under ? 'ceiling' : 'floor'} to what the game actually does.`,
    );
  }

  return margin;
}

export interface MeanClaim {
  /** The batch. One number per run. */
  values: number[];
  /** The claim: the true mean is above this. Exactly one of `floor`, `ceiling`. */
  floor?: number;
  /**
   * The claim: the true mean is BELOW this.
   *
   * Half the batch claims in these suites are budgets rather than floors —
   * "asks under 25 times a run", "spends under a hundred crowns" — and until
   * this existed the only helper took a floor, so every budget was written as
   * a bare `toBeLessThan` on an average, which is the exact thing `expectMean`
   * was built to stop. One of them then failed at a mean of 25.0 against a
   * threshold of 25, on a commit that changed nothing it measured.
   */
  ceiling?: number;
  what: string;
}

/**
 * The same guard for a claim about a MEAN rather than a rate.
 *
 * Proportions are not the only statistic these suites bet on, and the other
 * kind is worse behaved. `hotPairs` in `blood.slow.test.ts` runs 0 to 45 with
 * a standard deviation of about 12 — larger than its own mean — so a five-seed
 * average carried a standard error of 5.8 against a threshold of 5, and passed
 * at 5.40 until an unrelated commit re-rolled it to 4.40.
 *
 * A heavy tail is exactly where eyeballing a batch goes wrong, because the
 * eye reads the median and the assertion reads the mean.
 */
export function expectMean(claim: MeanClaim): number {
  let { values } = claim;
  const { what } = claim;
  const n = values.length;
  if (n < 2) throw new Error(`${what}: a mean claim needs at least two runs, got ${n}`);
  if ((claim.floor === undefined) === (claim.ceiling === undefined)) {
    throw new Error(`${what}: name exactly one of floor and ceiling — a claim with both is two claims`);
  }

  // A ceiling is a floor read in a mirror, so there is one piece of statistics
  // here and not two. Everything below works on `flip`ped values; only the
  // failure messages have to remember which way round the claim was made.
  const under = claim.ceiling !== undefined;
  const flip = (v: number) => (under ? -v : v);
  const floor = flip(under ? claim.ceiling! : claim.floor!);
  values = values.map(flip);

  const mean = values.reduce((a, b) => a + b, 0) / n;
  // Sample standard deviation (n-1): with n this small the population form is
  // biased low, which would flatter the margin exactly where it matters.
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const se = Math.sqrt(variance / n);
  const margin = se === 0 ? Infinity : (mean - floor) / se;
  const seen = `mean ${flip(mean).toFixed(2)} of ${n} runs (sd ${Math.sqrt(variance).toFixed(2)})`;
  const said = `${under ? 'less' : 'more'} than ${flip(floor)}`;

  if (!(mean > floor)) throw new Error(`${what}: ${seen}, and the claim is ${said}`);

  if (margin < MIN_MARGIN_SE) {
    const wants = Math.ceil(n * (MIN_MARGIN_SE / Math.max(margin, 0.1)) ** 2 * 1.2);
    throw new Error(
      `${what}: the claim holds at ${seen}, but only by ${margin.toFixed(1)} standard errors — under `
      + `${MIN_MARGIN_SE}, so an unrelated commit re-rolling the draw flips it. This is a finding about `
      + `the TEST, not the game. Widen the batch (about ${wants} runs would carry it), or move the `
      + `${under ? 'ceiling' : 'floor'} to what the game actually does.`,
    );
  }

  return margin;
}

/**
 * ── THE SHAPE OF A WORLD, ASSERTED WHEREVER ONE EXISTS ────────────────────
 *
 * Forty-three suites play millennia and, before this, not one of them asked
 * whether the world that came out was STRUCTURALLY COHERENT. They each
 * checked their own subsystem — did the ladder move, did the record drift,
 * did the branches grieve — and a widow still married to a dead man would
 * have passed every one of them, because no suite owns "marriages agree with
 * deaths".
 *
 * That is not hypothetical. `docs/FAILURES.md` catalogues the exact shapes:
 * children in the wrong household, widows still married to dead men, cast
 * slots never refilled, the seal out of the main house twice. Every one is a
 * predicate over a single world, and every one shipped.
 *
 * So: one function, called at the tail of a run that already happened. It
 * costs nothing — the expensive part is the thousand years, and those are
 * already paid for.
 *
 * IT RETURNS VIOLATIONS RATHER THAN THROWING, like a gate. A throw gives you
 * the first thing wrong; a list tells you whether one person is broken or
 * four hundred are, which is the difference between a bug in `kill()` and a
 * bug in one authored effect.
 *
 * WHAT IS NOT IN HERE IS DELIBERATE. Every check below is a rule the game
 * actually keeps — verified by running it over played millennia and deleting
 * the ones the world does not owe. A checker that fails on healthy runs gets
 * muted, and a muted checker is worse than none: it looks like coverage.
 */
export interface WorldViolation {
  /** Which invariant, by CLAUDE.md's numbering, or a named structural rule. */
  rule: string;
  detail: string;
}

export function worldViolations(ctx: SimCtx): WorldViolation[] {
  const w = ctx.world;
  const out: WorldViolation[] = [];
  const say = (rule: string, detail: string) => { out.push({ rule, detail }); };

  const all = w.people.all();
  const byId = new Map(all.map((p) => [String(p.id), p]));
  const openMemberships = (p: Person) => p.membership.filter((m) => m.to === undefined);

  // ── INVARIANT 15: a hall is not a house ─────────────────────────────────
  // Two open membership records puts someone in two halls at once, and half
  // of `core` reads their household with `.find(m => m.to === undefined)`,
  // which silently picks whichever was written first.
  for (const p of all) {
    const open = openMemberships(p);
    if (open.length > 1) {
      say('INVARIANT 15', `${p.id} has ${open.length} open membership records: `
        + open.map((m) => `${m.house}/${m.branch ?? MAIN_BRANCH}(${m.kind} from ${m.from})`).join(' + '));
    }
  }

  // ── INVARIANT 2: `kill` is the only death gate ──────────────────────────
  // Everything that goes through it comes out with a year and a cause. A
  // death without them came from somewhere else.
  for (const p of all) {
    if (p.status !== 'dead') continue;
    if (p.died === undefined) say('INVARIANT 2', `${p.id} is dead with no year of death`);
    if (!p.causeOfDeath) say('INVARIANT 2', `${p.id} is dead with no cause`);
  }

  // ── Nobody dies before they are born, or after the world ends ───────────
  for (const p of all) {
    if (p.died !== undefined && p.died < p.born) {
      say('chronology', `${p.id} died in ${p.died}, born ${p.born}`);
    }
    if (p.born > w.year) say('chronology', `${p.id} was born in ${p.born}, and it is ${w.year}`);
    if (p.died !== undefined && p.died > w.year) {
      say('chronology', `${p.id} died in ${p.died}, and it is ${w.year}`);
    }
  }

  // ── Widows are not still married ────────────────────────────────────────
  // `docs/FAILURES.md`: "widows still married to dead men". An open marriage
  // whose other half is in the ground is the record the Match reads when it
  // decides who is available.
  for (const p of all) {
    for (const m of p.marriages) {
      if (m.to !== undefined) continue;
      const spouse = byId.get(String(m.spouse));
      if (!spouse) { say('marriage', `${p.id} is married to ${m.spouse}, who is not in the store`); continue; }
      if (spouse.status === 'dead') {
        say('marriage', `${p.id} still has an open marriage to ${spouse.id}, dead since ${spouse.died}`);
      }
    }
  }

  // ── A marriage has two sides and they agree ─────────────────────────────
  for (const p of all) {
    for (const m of p.marriages) {
      if (m.to !== undefined) continue;
      const spouse = byId.get(String(m.spouse));
      if (!spouse) continue;
      const back = spouse.marriages.find((x) => String(x.spouse) === String(p.id) && x.to === undefined);
      if (!back) say('marriage', `${p.id} has an open marriage to ${spouse.id} and ${spouse.id} does not agree`);
    }
  }

  // ── INVARIANT 3: the Narrator does not die ──────────────────────────────
  if (w.narrator) {
    const daveed = byId.get(String(w.narrator));
    if (!daveed) say('INVARIANT 3', `the narrator ${w.narrator} is not in the store`);
    else if (w.guardianSince !== undefined && daveed.status !== 'guardian') {
      say('INVARIANT 3', `the narrator has been the guardian since ${w.guardianSince} `
        + `and his status is '${daveed.status}' — a guardian is never 'alive' again`);
    } else if (daveed.status === 'dead') {
      say('INVARIANT 3', 'the narrator is dead; his death is redirected, never taken');
    }
  }

  // ── INVARIANT 12: nothing takes the seal out of the main house ──────────
  //
  // AMONG THE LIVING, and that is not a hedge. `kill()` leaves cast markers
  // on the dead on purpose — only the guardian is stripped of `head` — and
  // `cast.ts` reads every role off `living()` before asking who holds it. So
  // a marker on a corpse is history, not an office, and asserting otherwise
  // fails on 150 healthy people per six runs. Measured, then narrowed.
  //
  // EXCEPT WHEN THERE IS NOBODY LEFT WHO COULD HOLD IT (issue #42). A house
  // with no living blood is `broken_line`, not a bug — `stepYear` stops
  // turning the year the moment `livingBlood` reaches zero, for exactly this
  // reason, so the household that is left behind (retainers, still standing)
  // never gets a head again and is not supposed to. Without this the check
  // would fire on every checkpoint sampled after the line breaks rather than
  // finding a mechanical fault once: `livingBlood(w) === 0` is the same test
  // `stepYear` already used to decide the run was over, asked here of the
  // same fact rather than a second one that could drift from it.
  const livingHeads = w.people.living().filter((p) => p.castSlots.includes('head'));
  const household = w.people.household(w.playerHouse, w.year);
  // AND EXCEPT WHILE A WARDSHIP STANDS (issue #91). "The Warden may take the
  // estate's management until majority": nobody of the house holds the seal
  // for exactly as long as `world.wardship` is set, by design — `ensureHead`
  // deliberately seats no one until the ward turns sixteen or dies. Still
  // caught if it somehow leaves MORE than one head standing; a Wardship
  // explains zero, never two.
  const inWardship = w.wardship !== undefined && livingHeads.length === 0;
  if (household.length && livingHeads.length !== 1 && livingBlood(w) > 0 && !inWardship) {
    say('INVARIANT 12', `the house has ${household.length} living members and `
      + `${livingHeads.length} of them hold the seal — [${livingHeads.map((p) => p.id).join(', ')}]`);
  }
  for (const p of livingHeads) {
    const seat = openMemberships(p)[0];
    if (!seat) { say('INVARIANT 12', `${p.id} holds the seal and belongs to no house`); continue; }
    if (seat.house !== w.playerHouse) {
      say('INVARIANT 12', `${p.id} holds the seal and sits in ${seat.house}, not ${w.playerHouse}`);
    }
    if (seat.branch !== undefined && seat.branch !== MAIN_BRANCH) {
      say('INVARIANT 12', `${p.id} holds the seal from the ${seat.branch} hall, not the main house`);
    }
  }

  // ── Land: caput and branch holders (issue #91, Stage H) ─────────────────
  //
  // The two silent-state-corruption shapes the branch-land ruling was
  // written to prevent: a caput parcel that ended up with a branch holder
  // (`endowParcel` refuses this, so it can only happen through a path that
  // does not ask), and a parcel pointing at a branch that no longer exists —
  // `escheatBranchLand` is the one place extinction clears a holder, so a
  // stale one means that path was bypassed.
  for (const [, state] of w.parcels) {
    if (state.heldSince > w.year || state.holder === undefined) continue;
    const def = state.defId ? ctx.content.parcel(String(state.defId)) : undefined;
    if (def && isCaput(def)) say('land/holder', `${state.id} is ${def.name}, the seat's own ground, but is held by hall ${state.holder}`);
    if (!w.branches.has(state.holder)) say('land/holder', `${state.id} is held by ${state.holder}, which is not a hall of this house`);
  }

  // ── A lie is provable by a HOUSE (#1190) ────────────────────────────────
  // The auction sells the page to whoever is named here, threads are drawn
  // to them, and proof scenes narrow by them. A name that is not a house is
  // a bidder nobody can be and a prover no scene can match.
  for (const [id, d] of w.discrepancies) {
    for (const house of d.provableBy) {
      if (!ctx.content.house(house)) say('discrepancy/prover', `${id} is provable by '${house}', which is not a house`);
    }
  }

  // ── Nobody is their own ancestor ────────────────────────────────────────
  for (const p of all) {
    const id = String(p.id);
    if (String(p.trueParents.mother ?? '') === id || String(p.trueParents.father ?? '') === id) {
      say('descent', `${p.id} is their own parent`);
    }
  }

  // ── INVARIANT 8: ids are unique, and the counters cover what exists ─────
  if (byId.size !== all.length) {
    say('INVARIANT 8', `${all.length} people share ${byId.size} distinct ids`);
  }

  // ── INVARIANT 14: the ladder remembers the best it ever did ─────────────
  // `best` is the only thing stored, precisely because a family that made a
  // Hierophant once made one. It can therefore never sit below the rung the
  // house is standing on right now.
  const RUNGS = ['none', 'touched', 'adept', 'hierophant', 'vessel', 'demigod', 'god'];
  const now = RUNGS.indexOf(w.ascension.rung);
  const best = RUNGS.indexOf(w.ascension.best);
  if (now < 0) say('INVARIANT 14', `the house stands on an unknown rung '${w.ascension.rung}'`);
  if (best < 0) say('INVARIANT 14', `the house's best is an unknown rung '${w.ascension.best}'`);
  if (now >= 0 && best >= 0 && best < now) {
    say('INVARIANT 14', `the house stands at '${w.ascension.rung}' and remembers only '${w.ascension.best}'`);
  }

  return out;
}

/**
 * The same thing, as an assertion. Call it at the tail of any run — the years
 * are already paid for, so this is free, and it is the only check in the
 * repository that a played world is internally coherent rather than merely
 * interesting.
 */
export function expectHealthyWorld(ctx: SimCtx): void {
  const bad = worldViolations(ctx);
  if (!bad.length) return;
  const byRule = new Map<string, string[]>();
  for (const v of bad) byRule.set(v.rule, [...(byRule.get(v.rule) ?? []), v.detail]);
  const report = [...byRule.entries()]
    .map(([rule, details]) => `${rule} — ${details.length} violation(s):\n`
      + details.slice(0, 5).map((d) => `    ${d}`).join('\n')
      + (details.length > 5 ? `\n    …and ${details.length - 5} more` : ''))
    .join('\n');
  throw new Error(`the world at ${ctx.world.year} is not internally coherent:\n${report}`);
}
