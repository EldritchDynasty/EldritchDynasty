import type { Year } from '@ed/schema';
import { MAIN_BRANCH, assertNever } from '@ed/schema';
import { chronicleEntryId, type SimCtx } from './world.js';
import { activeBranches } from './people/branches.js';

/**
 * BEARING — how the house carries what it has, as distinct from what it has
 * (concept §29, issue #45).
 *
 * It sits beside `assizePressure` and is read the same way: derived,
 * recomputed every year, explicit in its consequences and never in its name.
 * It is not a second Assize. The Assize is the world's opinion of how the
 * house is DOING and it announces itself in the chronicle by design
 * (invariant 13). This is the world's memory of how the house has BEHAVED,
 * and it never announces itself at all, because the whole of what it is for
 * is that the player runs out of options and does not immediately know why.
 *
 * ─── The five rules it is built to keep ─────────────────────────────────────
 *
 * 1. NEVER NAME IT. No stat, no meter, no bar, and no player-facing string
 *    containing pride, arrogance, hubris or vanity. `prose/bearing` fails the
 *    build on all four, anywhere in authored content.
 * 2. PRIDE MUST USUALLY BE CORRECT. It is how a house climbs. A tax gets
 *    optimised away inside an hour and teaches nothing, so nothing here
 *    subtracts from a number the player is watching.
 * 3. IT NEVER COSTS ON THE DAY. `REMEMBERED_AFTER` is two generations, and an
 *    act younger than that is not in the reading at all. A consequence that
 *    lands in the same decade as its cause is a rule, and the player will
 *    learn the rule and stop doing the thing.
 * 4. ONLY OTHER PEOPLE SAY IT. Nothing here writes a chronicle line in the
 *    house's own voice.
 * 5. REVERSIBLE BY ACT, NEVER BY APOLOGY. The reading falls when the acts
 *    stop and the ledger of them ages out. There is no humility button.
 *
 * ─── Why five inputs are remembered and two are derived ─────────────────────
 *
 * Invariant 6: derived state is not storage. Two of the seven inputs are live
 * readings off state the world already holds: a cadet hall's standing
 * grievance and a long tenure in the seat.
 *
 * The other five are discrete acts whose timing matters: writing the family
 * larger, refusing a hand, keeping somebody off the market, taking the cousin
 * over an outsider, and taking a bite of the common. Some leave traces in
 * other systems, but none of those traces is the Bearing ledger: rule 3 needs
 * the exact year of the act so its bill cannot arrive before two generations
 * have passed. Those five are therefore remembered here rather than derived.
 */

/**
 * The acts the world remembers. A closed union, and every site handling one
 * ends in `assertNever` — a kind that falls through would be an act the house
 * is never charged for, which is invisible from outside.
 */
export type BearingAct =
  /** An Embellish: the family written larger than it was. */
  | 'wrote_it_larger'
  /** A hand refused outright, as beneath the house. */
  | 'refused_a_hand'
  /** Somebody kept off the marriage market by standing order. */
  | 'kept_her_back'
  /** The cousin card taken with an outside card sitting on the table. */
  | 'took_the_cousin'
  /** Ground taken off the common — the acquisition route that costs nothing on the day (issue #91, Stage G). */
  | 'bit_the_common';

/** One act, and the year it was taken. */
export interface BearingEntry {
  year: Year;
  kind: BearingAct;
  /** Concrete thing the act was about: a match, claim, or parcel. Player-visible provenance for its echo. */
  about?: string;
  /** Set once the fiction has acknowledged this act, before it can enter the mechanical reading. */
  echoed?: boolean;
  /**
   * The year its echo line was actually written. Absent when the echo was held
   * back as a repeat of its kind (issue #326), and on saves from before that.
   */
  echoedIn?: Year;
  /** The Chronicle page the act wrote, when it wrote one. */
  page?: string;
}

/**
 * What each act weighs against the others.
 *
 * Refusing a hand is the loudest because it is the one the market itself
 * witnesses: a broker who is turned down twice stops calling. Writing the
 * family larger is quieter and slower, because the only people who can catch
 * it are the ones who kept their own copy.
 */
function weightOf(kind: BearingAct): number {
  switch (kind) {
    case 'refused_a_hand': return 1;
    case 'kept_her_back': return 0.8;
    case 'took_the_cousin': return 0.6;
    case 'wrote_it_larger': return 0.5;
    // Quiet in the same way `wrote_it_larger` is: nobody outside the
    // household's own affairs sees it happen, only the village slowly
    // working out what stopped feeding its own cattle. One-shot content
    // (`the_marker_stays_moved`), so this can only ever add its weight once
    // a run — unlike the other three, which a policy can repeat for centuries.
    case 'bit_the_common': return 0.5;
    default: return assertNever(kind, 'bearing act');
  }
}

/**
 * TWO GENERATIONS, and this is rule 3 made into a number.
 *
 * A generation in this game is about twenty-five years, so an act is not in
 * the reading until it is fifty years old. The man who refused the hand is
 * dead, and the grandson finds the market thin and has no idea it is his.
 */
export const ECHO_AFTER = 25;
export const REMEMBERED_AFTER = 50;

/**
 * How many remembered acts a century it takes to read as a house that carries
 * itself.
 *
 * SIX, and measured rather than argued. The first cut was sixteen, reasoned
 * from a run's arithmetic — the player is dealt about one hand a generation,
 * so four a century, so a proud house does about four proud things a century,
 * so set it at four times that. Every step of that was right except the
 * conclusion, because a house cannot do four times what the maximum is.
 *
 * Measured over twelve played thousand-year runs at three policies, where
 * `proud` refuses every hand it is ever dealt:
 *
 *                  peak bearing   cards on the table
 *     modest           0.37             2.75
 *     unattended       0.56             2.45
 *     proud            0.74             2.02
 *
 * At sixteen the proud column peaked at 0.44 and still saw 2.64 cards — the
 * ceiling was unreachable by any play at all, so §29's stated end state
 * (*until the cousin card is the only card on the table*) could not happen in
 * any run. At six it happens, and the modest house still sees 2.75 of its
 * three cards, which is rule 2: pride must usually be CORRECT, and a house
 * that does not carry itself this way is barely touched.
 */
const PROUD_PER_CENTURY = 6;

/** A hall this angry is a hall that has been left standing. */
const GRIEVANCE_FULL = 60;

/**
 * A tenure past this is being sat on rather than held. §22's Demigod
 * Stagnation uses forty-five for the same shape and the same reason; this is
 * the softer reading of it, and starts counting where that one starts acting.
 */
const LONG_TENURE = 45;

export interface Bearing {
  /** Acts old enough to be remembered, per century of the run so far. */
  carriage: number;
  /** What the halls are owed and have not been given. */
  grievance: number;
  /** How far past a long tenure the seat has been held. */
  tenure: number;
  /** The combined read, 0 (the house keeps its head down) to 1. */
  score: number;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * How the world has come to read the house. Derived, recomputed, stored
 * nowhere except as `world.bearing.score` for the same reason
 * `assize.pressure` is: so a client, an authored condition and the phase that
 * acted all read one number rather than three recomputations of it.
 */
export function bearingOf(ctx: SimCtx): Bearing {
  const w = ctx.world;

  // RULE 3. Anything younger than two generations is not in the reading, and
  // that is the whole of why entries carry a year.
  let remembered = 0;
  for (const e of w.bearing.acts) {
    if (w.year - e.year >= REMEMBERED_AFTER) remembered += weightOf(e.kind);
  }
  // Per century of the run so far, so a house is read on how it has carried
  // itself rather than on how long it has been carrying. Measured from the
  // first year that could hold a remembered act, never from zero: dividing by
  // an elapsed time shorter than the lag makes the first remembered act read
  // as a century's worth of them.
  const centuries = Math.max(1, (w.year - w.assize.openedAt - REMEMBERED_AFTER) / 100);
  const carriage = clamp01(remembered / (centuries * PROUD_PER_CENTURY));

  const halls = activeBranches(w).filter((b) => b.id !== MAIN_BRANCH);
  const grievance = halls.length
    ? clamp01(halls.reduce((n, b) => n + b.grievance, 0) / (halls.length * GRIEVANCE_FULL))
    : 0;

  const held = w.headSince === undefined ? 0 : w.year - w.headSince;
  const tenure = clamp01((held - LONG_TENURE) / LONG_TENURE);

  // Weighted toward the acts, because the acts are what the player DID and the
  // other two are what the house let stand. A hall left angry for a century is
  // real and is not a decision anybody took on a particular afternoon.
  const score = clamp01(carriage * 0.6 + grievance * 0.25 + tenure * 0.15);
  return { carriage, grievance, tenure, score };
}

/**
 * THE TAG AN OUTCOME WEARS WHEN SOMEBODY IS TRYING TO TELL THE HOUSE SOMETHING.
 *
 * §29 stage 3: *bearing suppresses the retainer's warning, the steward's
 * objection, the cadet's letter.* An author marks the branch where the warning
 * is actually spoken, and this file decides how often the house gets it.
 */
export const WARNING_TAG = 'warning';

/**
 * HOW HARD THE WARNING IS SUPPRESSED, at the top of the reading.
 *
 * A multiplier on the warning outcome's draw weight, so at a bearing of 1 the
 * house hears about a fifth of what it would otherwise have been told, and at
 * 0 it hears everything. Not a gate: a house that has carried itself for eight
 * centuries is still told things occasionally, by people who have not learned
 * yet, and a hard cutoff would be a rule the player can name — which is rule 1.
 *
 * Swept in `gate:bearing`, and the number to watch is not the suppression rate
 * but what it does to the SPREAD of outcomes across the bins. The whole reason
 * stage 3 exists is that stage 2 alone produces a house that loses slowly and
 * predictably, and a moral needs a tail.
 */
export const WARNING_FLOOR = 0.2;

/** What a warning-tagged outcome's weight is multiplied by this year. */
export function warningWeight(ctx: SimCtx): number {
  return 1 - (1 - WARNING_FLOOR) * clamp01(ctx.world.bearing.score);
}

/**
 * SOMEBODY HAD SOMETHING TO SAY AND DID NOT SAY IT.
 *
 * Written where the outcome is picked, and only where a warning was actually
 * on the table — a scene with nothing to warn about cannot withhold anything.
 * The trace is what makes the suppression fair (issue #45): a player who is
 * never told, and can never afterwards find out that they were not told, is a
 * player being handed bad dice.
 */
export function noteUnheard(ctx: SimCtx, event: string): void {
  ctx.world.bearing.unheard.push({ year: ctx.world.year, event });
}

/**
 * Write one act down. Called from the verb that performs it and from nowhere
 * else, so the ledger cannot drift from what the player actually did.
 */
export function noteBearing(ctx: SimCtx, kind: BearingAct, about?: string, page?: string): void {
  ctx.world.bearing.acts.push({
    year: ctx.world.year,
    kind,
    ...(about ? { about } : {}),
    ...(page ? { page } : {}),
  });
}

/**
 * The echo's lines, three per act kind. Each says only what is TRUE the year
 * it is written (issue #326): an echo comes at `ECHO_AFTER`, a generation
 * before `bearingOf` counts the act at `REMEMBERED_AFTER`, so no echo may claim
 * the bill has already landed. The refused hand used to say "Fewer names came
 * back with the next letter" twenty-five years before the market thinned by so
 * much as one card — the world reporting a consequence it had not dealt, which
 * is invariant 13 read backwards.
 *
 * Three, because one sentence frame came back ten to twelve times in a run:
 * a house that takes the cousin card every generation heard "People still
 * spoke of…" at every one of them. The lines rotate in order, and
 * `ECHO_SPACING` holds a kind to one echo a generation besides.
 */
function echoLines(kind: BearingAct, about: string): string[] {
  const About = about.charAt(0).toUpperCase() + about.slice(1);
  switch (kind) {
    case 'wrote_it_larger':
      return [
        `A copy kept elsewhere still named ${about}, and did not tell it quite as the house had.`,
        `A clerk from another house asked about ${about}, and wrote down an answer that was not the house's.`,
        `${About} was read aloud at somebody else's table, from somebody else's copy.`,
      ];
    case 'refused_a_hand':
      return [
        `A matchmaker remembered ${about}, and said as much to the next house that asked.`,
        `${About} was still told in the market towns, by people who had not been in the room.`,
        `An old broker's book still had a line against ${about}.`,
      ];
    case 'took_the_cousin':
      return [
        `People still spoke of ${about}: the outside hand had been there, and the house had chosen its own blood.`,
        `At a wedding in another hall somebody's aunt brought up ${about}, and nobody changed the subject.`,
        `${About} was the example a priest reached for, a generation on, when a family asked him about cousins.`,
      ];
    case 'bit_the_common':
      return [
        `At ${about}, old boundary stones were still pointed out in the village, though the house's map had moved on.`,
        `Children at ${about} still walked the old line on feast days, the way their grandparents had.`,
        `A tenant's widow at ${about} still called the field by the name it had before the house took it.`,
      ];
    case 'kept_her_back':
      return [
        `The market had not forgotten ${about}, who had been kept from it when a hand might still have been made.`,
        `A broker asked after ${about} a generation late, as if the offer might still stand.`,
        `${About} came up in a letter from another house, as the daughter this one had kept at home.`,
      ];
    default:
      return assertNever(kind, 'bearing echo');
  }
}

/**
 * One echo's line. `ordinal` is how many echoes of this kind the run has
 * already written, which picks the line in rotation.
 */
export function echoText(entry: BearingEntry, ordinal = 0): string {
  // Every call site names the act; a save from before `about` existed names
  // the year instead, never a generic "old decision" (#211's own rule).
  const lines = echoLines(entry.kind, entry.about ?? `what the house did in ${entry.year}`);
  return lines[ordinal % lines.length]!;
}

/** How many sentence frames a kind rotates through. */
export const ECHO_VARIANTS = echoLines('wrote_it_larger', '').length;

/**
 * At most one echo of a kind a generation. Acts of one kind cluster — a house
 * takes the cousin card for every child of a marrying generation — and an echo
 * held back is still billed at `REMEMBERED_AFTER` by `bearingOf`, which reads
 * the act, not the line.
 */
export const ECHO_SPACING = ECHO_AFTER;

/**
 * The fiction acknowledges a concrete old act one generation after it
 * happened, while the mechanical bill remains owned by bearing at fifty years.
 */
export function echoBearing(ctx: SimCtx): number {
  const acts = ctx.world.bearing.acts;
  let written = 0;
  for (const entry of acts) {
    if (entry.echoed || ctx.world.year - entry.year < ECHO_AFTER) continue;
    entry.echoed = true;
    const sameKind = acts.filter((a) => a.kind === entry.kind && a.echoedIn !== undefined);
    if (sameKind.some((a) => ctx.world.year - a.echoedIn! < ECHO_SPACING)) continue;
    entry.echoedIn = ctx.world.year;
    ctx.world.chronicle.push({
      id: chronicleEntryId(ctx),
      year: ctx.world.year,
      weight: 'line',
      text: echoText(entry, sameKind.length),
      echoFrame: `bearing:${entry.kind}:${sameKind.length % ECHO_VARIANTS}`,
      named: false,
      cause: {
        year: entry.year,
        ...(entry.page ? { page: entry.page } : {}),
      },
    });
    written++;
  }
  return written;
}

/**
 * What a run's echoes came to (issue #326's instrument): how many lines were
 * written, and the most copies of any ONE sentence frame. Read off the acts,
 * never off the chronicle's words.
 */
export function echoTally(acts: readonly BearingEntry[]): { written: number; maxCopies: number } {
  const byKind = new Map<BearingAct, number>();
  for (const a of acts) if (a.echoedIn !== undefined) byKind.set(a.kind, (byKind.get(a.kind) ?? 0) + 1);
  let maxCopies = 0;
  for (const n of byKind.values()) maxCopies = Math.max(maxCopies, Math.ceil(n / ECHO_VARIANTS));
  return { written: [...byKind.values()].reduce((a, b) => a + b, 0), maxCopies };
}

/** One reading, written to the world. Draws no dice. */
export function tickBearing(ctx: SimCtx): Bearing {
  echoBearing(ctx);
  const now = bearingOf(ctx);
  ctx.world.bearing.score = now.score;
  return now;
}

/**
 * STAGE 2, AND FOR NOW THE ONLY BITE (issue #45).
 *
 * The world stops offering. A house that has refused enough hands is offered
 * fewer, and the ones it is offered come with less, until the cousin is the
 * only card on the table.
 *
 * This is the moral in one loop and it needs no text: §7 already says cousin
 * marriage is *not a temptation, it is the mechanism*, and this makes it also
 * a CONSEQUENCE. The pride that refuses to dilute the blood is what forces the
 * marriage that ruins it.
 *
 * Returns the market's appetite, 1 (it offers what it always did) to 0 (it
 * sends only what it cannot place elsewhere). Deliberately not a cliff: a
 * threshold would be a rule, and a rule gets learned and played around.
 */
export function marketAppetite(ctx: SimCtx): number {
  return 1 - ctx.world.bearing.score;
}
