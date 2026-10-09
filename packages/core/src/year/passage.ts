import { ageAt, type Person } from '@ed/schema';
import { phenotypeOf } from '../people/factory.js';
import type { SimCtx } from '../world.js';
import type { YearReport } from './report.js';
import { msg } from '../messages.js';

/**
 * WHAT THE YEARS DID, AS VALUES (issue #49).
 *
 * `stepYear` has always returned a full account of every year it turned, and
 * no client has ever read one: `session.advance()` handed back `YearReport[]`
 * and `packages/client` threw it away, so pressing "a generation" moved the
 * clock twenty-five years in total silence. This is the same account, folded
 * down to the shape a client can actually draw.
 *
 * It is a MAPPING, not a second record. Nothing here decides anything, nothing
 * here is stored, and it draws from a report that has already happened.
 *
 * ── WHAT IS IN IT, AND WHY IT IS ONLY THIS ────────────────────────────────
 *
 * Births, deaths and awakenings, and nothing else. That is not a first slice
 * of a longer list: it is everything a year does to this family that **the
 * chronicle does not already carry**, checked one at a time.
 *
 *   an Age being named   → `phases.ts` writes a `page` entry
 *   a cadet branch       → `branches.ts` writes one
 *   a clause recovered   → `scheduler.ts` writes one, in the contract's hand
 *   the Narrator crossing→ `phases.ts` writes an `illuminated` entry, and it
 *                          is the best-written thing in the game. Repeating
 *                          it here in eight plain words would be a way of
 *                          spending it.
 *
 * Every one of those is on the right of the board already, in the typography
 * its frequency earned. A passage log that restated them would be a second
 * place saying the same thing, one column over — and this codebase has spent
 * enough on second places that say the same thing.
 *
 * What is left is the demography, and the demography is exactly what vanishes.
 * **Nobody in this family dying is recorded anywhere the player can see**
 * unless an authored event happened to mention it. A house can lose four
 * people and a generation of daughters across one jump and the screen will
 * differ only in that the tree got shorter.
 *
 * ── THE REGISTER ──────────────────────────────────────────────────────────
 *
 * Plain reportage. Not the frame, which is quieter than the tale and gets a
 * screen to itself; not the chronicle, which is written by somebody with an
 * interest. These are the years as they went past. The one flourish allowed is
 * `causeOfDeath`, which is authored where it matters and is already a phrase
 * rather than an id — "the blood, overflowing", "of the years, all of them
 * having been used" — so it is quoted rather than reworded.
 */
/**
 * A BOOK FINISHED CHANGED SIDES (issue #82).
 *
 * The list above used to carry "a book finished → `phases.ts` writes a `line`
 * entry" as a reason to leave studies out of this log. It was the wrong side
 * of the split and had never been argued for. Six to eight readers are
 * mid-book at all times, so it fired about three times a year forever: 2,902
 * of a finished book's 3,738 entries were one sentence about putting a book
 * back on the shelf, and the chronicle panel became a rolling window on the
 * last eighteen years, four-fifths of it study receipts.
 *
 * A study completing is what a family does with its afternoons — the same
 * kind of fact as a birth, and exactly what this log exists to carry. The
 * chronicle keeps the one reading a chronicler would write down: the first
 * time anybody in the house finishes that book.
 *
 * SERVICE ENDING JOINED IT for the same reason (issue #87). An employer dying
 * releases every retainer bound to him at once, and one `line` per servant
 * came to eleven of the sixty entries the chronicle panel draws. The house
 * losing four people out of one death is exactly what this log is for, and
 * the chronicle keeps only the endings the HOUSE caused: wages it could not
 * pay, and a man's will.
 */
export type PassageKind = 'birth' | 'death' | 'awakening' | 'study' | 'service';

export interface PassageLine {
  kind: PassageKind;
  /** The engine's words. A client that wrote its own would be inventing facts about people. */
  text: string;
  /** Who it is about, so a client can open their card from the log. */
  person: string;
}

export interface Passage {
  year: number;
  /** Never empty. A year that did nothing does not get a passage — see `passageOf`. */
  lines: PassageLine[];
}

/**
 * One year, as lines, or `undefined` where the year did nothing worth a line.
 *
 * The undefined is load-bearing: a thousand-year run is mostly quiet, and a
 * log with nine hundred empty dated rows in it is a log nobody reads.
 */
export function passageOf(ctx: SimCtx, report: YearReport): Passage | undefined {
  const lines: PassageLine[] = [];

  // In the order the phases produced them. `lifecycle` wakes and kills before
  // `births` bears, and a log that reordered them would be telling the year
  // differently from the way it happened.
  for (const p of report.awakenings) {
    lines.push({ kind: 'awakening', person: p.id, text: woke(ctx, p) });
  }

  for (const p of report.deaths) {
    lines.push({ kind: 'death', person: p.id, text: died(ctx, p, report.year) });
  }

  // `quarrels` runs after `lifecycle`, and a post falls vacant on a death the
  // log has just reported.
  for (const s of report.serviceEnded) {
    lines.push({ kind: 'service', person: s.person, text: s.text });
  }

  // `library` runs after `quarrels` and before `births`, and the log tells
  // the year in the order the year happened in.
  for (const s of report.studiesFinished) {
    lines.push({ kind: 'study', person: s.person, text: msg(ctx, 'passage.study.finished', '{NAME} finished {BOOK}.', { NAME: s.name, BOOK: s.book }) });
  }

  for (const p of report.births) {
    lines.push({ kind: 'birth', person: p.id, text: born(ctx, p) });
  }

  return lines.length ? { year: report.year, lines } : undefined;
}

/**
 * AWAKENING IS ONE EVENT AND TWO FACTS (issue #78).
 *
 * Most of the house's awakenings are women's — §11 times a daughter's by what
 * she carries rather than by what she can use — and for the whole life of this
 * log both read "she awakened", four words that in a game about who expresses
 * say the wrong one about six people in ten.
 *
 * The houses have no word for the difference; §11 is explicit that *"none of
 * them have a word for why."* So this does not invent one, and it does not
 * explain — that would be the chronicle's job, done in the wrong voice. It
 * reports the second thing that is true, in the same flat six words it
 * reports a death in.
 *
 * No pronoun and no second branch, deliberately. Everyone who wakes without
 * expressing is a woman today, because `rollAwakening` needs carried font and
 * a man with carried font expresses by definition — but §11's Forcing
 * rituals are not built yet, `awakening.forced` is the field waiting for
 * them, and the first thing they will do is wake somebody this sentence would
 * then be wrong about.
 */
function woke(ctx: SimCtx, p: Person): string {
  // The one gate, asked where it is always asked. Never `sex === 'male'`.
  if (phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch.canExpress) {
    return msg(ctx, 'passage.awakening.expressing', '{NAME} awakened.', { NAME: p.name });
  }
  return msg(ctx, 'passage.awakening.unexpressed', '{NAME} awakened, and it will not come through.', { NAME: p.name });
}

function died(ctx: SimCtx, p: Person, year: number): string {
  const age = String(ageAt(p, year));
  // `kill()` takes the cause as a phrase and several of them already begin
  // with "of", so it is set off with a dash rather than joined with a
  // preposition. 'unrecorded' is the store's fallback and says nothing.
  const cause = p.causeOfDeath && p.causeOfDeath !== 'unrecorded' ? p.causeOfDeath : undefined;
  if (cause !== undefined) {
    return msg(ctx, 'passage.death.cause', '{NAME} died at {AGE} — {CAUSE}.', {
      NAME: p.name, AGE: age, CAUSE: cause,
    });
  }
  return msg(ctx, 'passage.death.plain', '{NAME} died at {AGE}.', { NAME: p.name, AGE: age });
}

/**
 * A birth names the MOTHER and not the child, for two reasons that happen to
 * agree. The child may still be in the naming queue, and a line written now
 * with the chronicler's suggestion in it would still say Rowan after the
 * player named him Aldous — a stale fact about a person, which is the one
 * thing the record layer exists to prevent. And in a game about a bloodline,
 * whose daughter it is carries more than what he is called.
 *
 * The CLAIMED mother, not the true one. The documents may not match the blood
 * (§7), and this is the house talking about its own year.
 */
function born(ctx: SimCtx, child: Person): string {
  const motherId = child.claimedParents.mother ?? child.trueParents.mother;
  const mother = motherId ? ctx.world.people.get(motherId) : undefined;
  if (mother) {
    return child.sex === 'female'
      ? msg(ctx, 'passage.birth.daughter.named', 'A daughter born to {MOTHER}.', { MOTHER: mother.name })
      : msg(ctx, 'passage.birth.son.named', 'A son born to {MOTHER}.', { MOTHER: mother.name });
  }
  return child.sex === 'female'
    ? msg(ctx, 'passage.birth.daughter.unknown', 'A daughter born.')
    : msg(ctx, 'passage.birth.son.unknown', 'A son born.');
}
