import type { ActiveAge, AgeDef, Register } from '@ed/schema';
import type { SimCtx } from '../world.js';
import { evalCondition } from '../events/conditions.js';
import type { Rng } from '../rng.js';
import { campaignDef, isLateCampaignYear } from '../campaign.js';
import { proseForClause } from '../prose.js';

const MAX_CONCURRENT = 2;

/**
 * An Age is a HAZARD PROCESS, not a phase with a length. Terminations roll
 * first, then onsets. The same Age runs a different span every run, and the
 * player can never learn a calendar.
 */
export function tickAges(ctx: SimCtx, rng: Rng): { began: AgeDef[]; ended: AgeDef[]; named: AgeDef[] } {
  const w = ctx.world;
  const began: AgeDef[] = [];
  const ended: AgeDef[] = [];
  const named: AgeDef[] = [];

  // ── 1. Terminations ────────────────────────────────────────────────────
  for (const active of [...w.age.active]) {
    const def = ctx.content.age(active.age);
    if (!def) continue;
    const elapsed = w.year - active.began;
    if (elapsed < def.duration.minYears) continue;
    if (rng.bool(endHazard(def, elapsed))) {
      w.age.active = w.age.active.filter((a) => a !== active);
      // Carried out of `active` with the record, not dropped with it: whether
      // the family ever had a word for these years is the one thing §20 says
      // about them, and it is only knowable at this moment (issue #81).
      w.age.ended.push({
        age: active.age,
        began: active.began,
        ended: w.year,
        named: active.named,
        ...(active.namedAt !== undefined ? { namedAt: active.namedAt } : {}),
      });
      w.age.lastEndedRegister = def.register;
      ended.push(def);

      // An Age that had something to say about the debt and went out with the
      // house keeping no records. The player should be able to feel the lack
      // coming for two hundred years (§18), which means seeing it happen.
      if (def.clauseBearing && !active.paid.clause && active.named) {
        w.chronicle.push({
          year: w.year,
          weight: 'line',
          text: 'The Age ended. If it had anything more to say about the debt, the book kept no line of it.',
          named: false,
          greyed: true,
        });
      }
    }
  }

  // ── 2. Naming (the chronicle names an Age late) ─────────────────────────
  for (const active of w.age.active) {
    const def = ctx.content.age(active.age);
    if (!def || active.named) continue;
    if (w.year - active.began >= def.namedAfterYears) {
      active.named = true;
      active.namedAt = w.year;
      named.push(def);
    }
  }

  // ── 3. The Ledger pays (concept §18) ───────────────────────────────────
  for (const active of w.age.active) {
    revealClause(ctx, active);
  }

  // ── 4. Onsets ──────────────────────────────────────────────────────────
  if (w.age.active.length < MAX_CONCURRENT) {
    const eligible = ctx.content.ages.filter((def) => isEligible(def, ctx));
    const chosen = rng.weighted(eligible, (def) => onsetWeight(def, ctx));
    // Onset is itself a yearly chance, not a certainty: a world with no Age
    // running is a world between things, and that is allowed.
    if (chosen && rng.bool(0.035)) {
      w.age.active.push({
        age: chosen.id,
        began: w.year,
        named: false,
        paid: { standing: false },
      });
      began.push(chosen);
    }
  }

  return { began, ended, named };
}

/**
 * rising       likelier to end the longer it has run. The default feel.
 * front_loaded burns out fast. Right for the Plague.
 * flat         memoryless — the player can infer nothing from elapsed time.
 *              The most unsettling of the three. Use deliberately.
 */
export function endHazard(def: AgeDef, elapsed: number): number {
  const { medianYears, minYears, shape } = def.duration;
  const span = Math.max(1, medianYears - minYears);
  const t = (elapsed - minYears) / span;
  switch (shape) {
    case 'flat': return 1 / span;
    case 'front_loaded': return Math.min(0.5, (1 / span) * (1.9 - Math.min(1.4, t * 0.7)));
    case 'rising': return Math.min(0.5, (1 / span) * (0.45 + t * 1.1));
  }
}

function isEligible(def: AgeDef, ctx: SimCtx): boolean {
  const w = ctx.world;
  if (w.age.active.some((a) => a.age === def.id)) return false;
  if (def.onset.earliestYear !== undefined && w.year < def.onset.earliestYear) return false;

  const last = [...w.age.ended].reverse().find((e) => e.age === def.id);
  if (last && w.year - last.ended < def.onset.cooldownYears) return false;

  // Alternate the register: never two Ages of the same texture consecutively.
  if (w.age.lastEndedRegister && w.age.lastEndedRegister === def.register && w.age.active.length === 0) return false;
  if (w.age.active.some((a) => ctx.content.age(a.age)?.register === def.register)) return false;

  return evalCondition(def.onset.conditions, ctx);
}

function onsetWeight(def: AgeDef, ctx: SimCtx): number {
  let weight = def.onset.weight;
  // Ages are the difficulty curve. The old millennium made its final 20%
  // harsher after 1842; #133 preserves the RELATIVE rule so shortening the
  // campaign does not strand the late table beyond collection.
  const late = isLateCampaignYear(ctx.world.year);
  const harsh: Register[] = ['cold', 'institutional'];
  if (late && harsh.includes(def.register)) weight *= 3;
  if (late && def.register === 'warm') weight *= 0.3;
  return weight;
}

export function activeAgeIds(ctx: SimCtx): string[] {
  return ctx.world.age.active.map((a) => a.age);
}

/** The clause the player has always had. Applied once, at bootstrap. */
export function grantOpeningClause(ctx: SimCtx): void {
  for (const c of ctx.content.clauses) {
    if (c.known) ctx.world.clausesRecovered.add(c.id);
  }
}

/**
 * EVERY AGE REVEALS EXACTLY ONE CLAUSE (concept §18).
 *
 * This is the design's own answer to promise debt — "opening a thousand-year
 * mystery and paying nothing until hour eleven" — and it did not exist.
 * `ActiveAge.paid.clause` was in the schema and written by nothing;
 * `clauseBearing` was validated and read by nothing. Measured over a thousand
 * years a run recovered two clauses of nine, from the three authored events
 * that happen to grant one. The God rung needs seven. The ending the entire
 * game points at could not be reached, and no test, warning or log said so.
 *
 * Paid at NAMING rather than at onset, because a clause arriving in the
 * chronicle is how the player learns the Age was a real thing and not weather.
 *
 * ONE JUDGEMENT CALL, and it is worth stating. §18 says two things that this
 * simulation cannot both honour: "every Age reveals exactly one clause", and
 * "a run that reaches 2042 having recovered three clauses has a genuinely
 * worse endgame than one that recovered eight". The brief was written assuming
 * roughly nine Ages in a run; Ages are a hazard process here and a thousand
 * years produces thirty-odd, so paying every one of them hands over all nine
 * clauses by 1400 in every run and the variance the second sentence describes
 * cannot happen.
 *
 * So an Age pays its clause only to a house that is KEEPING RECORDS. The
 * household already has two authored posts that do exactly that: the Archivist
 * keeps the archive, and the Chronicler writes what the house did and knows
 * `what_the_archive_holds`. Either is sufficient; having neither is still a
 * deliberate gap in the record. That preserves both sentences (every Age pays
 * a house that can read it) and keeps recovery something the player caused
 * rather than something the calendar did.
 *
 * PER-AGE ASSIGNMENT (issue #4). Every clause names the Ages that can reveal
 * it (`clause/ages`, CI gate 7, requires at least two apiece), and this draws
 * from the ACTIVE Age's own assigned set rather than the global weight order.
 * Which clauses a run recovers now varies between seeds, not merely how many
 * — an Age whose assigned clauses are already gone simply pays nothing this
 * time, which is why a clause-bearing Age's occurrence is not the same thing
 * as a clause reveal.
 */
export function revealClause(ctx: SimCtx, active: ActiveAge): string | undefined {
  const w = ctx.world;
  if (active.paid.clause) return undefined;
  // #66: Short is a three-clause contract, not the first three hundred years
  // of a nine-clause one. Once its account is complete, later Ages can still
  // be named without inventing extra contractual obligations.
  if (w.clausesRecovered.size >= campaignDef(w.campaign).clauses) return undefined;
  if (!active.named) return undefined;

  const def = ctx.content.age(active.age);
  if (!def?.clauseBearing) return undefined;

  // Somebody has to be writing it down. Both are authored record-keeping
  // posts; neither is a calendar fallback, and a house with neither still loses
  // the chance to learn what this Age would have revealed.
  const recordKeeper = w.people.living().some(
    (p) => p.contract?.role === 'archivist' || p.contract?.role === 'chronicler',
  );
  if (!recordKeeper) return undefined;

  // Low weight first: the early clauses establish that the debt is real and
  // exact, the late ones close the doors the player has been walking toward.
  const next = [...ctx.content.clauses]
    .filter((c) => !w.clausesRecovered.has(c.id) && c.ages.includes(active.age))
    .sort((a, b) => a.weight - b.weight)[0];
  if (!next) return undefined;

  w.clausesRecovered.add(next.id);
  active.paid.clause = next.id;

  // In the contract's own hand. No chronicler edits this and no Record choice
  // is offered on it — it is the one thing in the book nobody in the family
  // wrote.
  const prose = proseForClause(ctx, next);
  w.chronicle.push({
    year: w.year,
    weight: 'illuminated',
    title: prose.name,
    text: prose.text,
    named: true,
  });
  return next.id;
}
