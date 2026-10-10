import type { EndedAge, Register } from '@ed/schema';
import type { ChronicleEntry, SimCtx } from './world.js';
import { renderContentProse } from './prose.js';
import { msg } from './messages.js';

/**
 * THE AGE IS THE SESSION (issue #65).
 *
 * A chapter is not an Age. Measured across six played 1000-year runs: two
 * Ages run at once in 49.4% of all years and none run in 20.1%, so an Age's
 * own span cannot be the verdict's window — reading it that way told 26.1% of
 * the chronicle's page/paragraph entries inside two ended Ages at once and
 * dropped another 28.6% inside none. What partitions cleanly is the CLOSING:
 * of 96 closings across those six runs, zero shared a year with another. A
 * chapter is the years between one closing and the next, named after the Age
 * that just closed — disjoint by construction, so nothing is told twice and
 * nothing is dropped.
 *
 * `chapterOf` is derived, the way `epilogueOf` is (`ending.ts`): nothing here
 * is stored, and a reload reconstructs the same chapter from the same
 * chronicle, the same succession record and the same people store.
 */

/** One fact in a closing verdict. */
export interface ChapterLine {
  text: string;
}

/**
 * The Age has begun, and the house does not have a word for it yet — shown
 * once, the year `tickAges` opens it. Carries no id and no `began` year: an
 * opening is a mood, not a record, and unlike a `ChapterView` it is never
 * reconstructed from a save — a resumed run simply does not replay the beat
 * for an Age already running when it loaded.
 */
export interface ChapterOpening {
  age: string;
  register: Register;
  /** `AgeDef.opening` — the same text the chronicle quotes back once these years are named. */
  text: string;
}

export interface ChapterView {
  /** The Age that closed. One `ChapterView` per closing — see below. */
  age: string;
  /** Absent where the chronicle never gave these years a word (`EndedAge.named`, §20 r1). */
  name?: string;
  register: Register;
  /** The years this chapter covers. `from` is exclusive, `to` is inclusive. */
  from: number;
  to: number;
  /**
   * A chapter at or above `MIN_CHAPTER_YEARS` is a good place to put the
   * story down: a hard, named autosave and the "you can stop here" invitation
   * (issue #65, item 4). A shorter closing still gets its verdict — EVERY
   * closing does, by design — it is just not treated as a stopping point, and
   * does not interrupt play the way a boundary chapter does.
   */
  boundary: boolean;
  /** What happened to this house across `from`..`to`. Never fewer than three lines. */
  verdict: ChapterLine[];
}

/**
 * Measured on ten played 1000-year runs (seeds 4100-4109, 163 closings):
 * gaps under five years are 7.4% of all of them, against a median gap of 36
 * and a floor of 1. Five years clears the Plague's own median span (6) —
 * "one bad decade" is still a chapter — while excluding only the closings
 * that arrive on top of one another.
 */
export const MIN_CHAPTER_YEARS = 5;

/** A verdict is never allowed to fall short of this (issue #65's acceptance). */
const MIN_VERDICT_LINES = 3;

const CHRONICLE_RANK: Partial<Record<ChronicleEntry['weight'], number>> = {
  illuminated: 0,
  page: 1,
  paragraph: 2,
};

/** The opening beat for an Age that just began. `undefined` under the same impossible condition as `chapterOf`. */
export function openingOf(ctx: SimCtx, ageId: string): ChapterOpening | undefined {
  const def = ctx.content.age(ageId);
  if (!def) return undefined;
  // The opening is a prospective presentation beat, never a saved Chronicle
  // rewrite. Address identity follows the authored id, not the Age's name or
  // its position in ages.yaml, and missing variants keep Original playable.
  const file = ctx.content.sourceOf(ageId);
  const text = file === undefined
    ? def.opening
    : renderContentProse(ctx, file, `ages[id=${encodeURIComponent(ageId)}].opening`, def.opening);
  return { age: ageId, register: def.register, text };
}

/**
 * The chapter view for one closing. `ended` should be a member of
 * `ctx.world.age.ended` — this reads the rest of that list to find the
 * previous boundary. Returns `undefined` only if the content bundle no
 * longer defines the Age that closed, which cannot happen in a run that
 * has not had its content pulled out from under it mid-session.
 */
export function chapterOf(ctx: SimCtx, ended: EndedAge): ChapterView | undefined {
  const def = ctx.content.age(ended.age);
  if (!def) return undefined;
  const w = ctx.world;

  // The founding year, read off the succession record rather than
  // `w.founding?.year` — the latter is absent on every world nobody signed a
  // prologue for (the harness, the digest, every gate), and the founder's own
  // succession entry is written at bootstrap, unconditionally (`sim.ts`).
  const founded = w.succession[0]?.from ?? w.year;

  // The most recent OTHER closing strictly before this one. Two closings
  // sharing a year were 0 of 96 in the measurement above; if content ever
  // produces one, both windows fall back to the same `from` and their
  // verdicts overlap rather than the engine throwing.
  const from = w.age.ended
    .filter((e) => e !== ended && e.ended < ended.ended)
    .reduce((max, e) => Math.max(max, e.ended), founded);
  const to = ended.ended;

  // A hidden Age has no name to render (and no missing translation to report).
  // For named Ages this is a prospective read-model label, not a rewrite of
  // the Chronicle page the family actually saved.
  const file = ended.named ? ctx.content.sourceOf(ended.age) : undefined;
  const name = !ended.named
    ? undefined
    : file === undefined
      ? def.name
      : renderContentProse(ctx, file, `ages[id=${encodeURIComponent(ended.age)}].name`, def.name);

  return {
    age: ended.age,
    name,
    register: def.register,
    from,
    to,
    boundary: to - from >= MIN_CHAPTER_YEARS,
    verdict: verdictFor(ctx, from, to),
  };
}

/**
 * What the house has to show for `from`..`to`, most consequential first.
 *
 * Reads the chronicle and the people store — never the passage log
 * (`year/passage.ts`), which exists only for the years a client actually
 * turned in one `advance()` call. A resumed run's `passages` is empty by
 * construction (`game.ts` clears it in `start()`); a verdict built from it
 * would be complete in a live session and silently empty after a reload,
 * which is exactly the kind of thing this codebase's own failure mode looks
 * like from the outside.
 */
function verdictFor(ctx: SimCtx, from: number, to: number): ChapterLine[] {
  const w = ctx.world;

  const told = w.chronicle
    .filter((e): e is ChronicleEntry & { text: string } =>
      e.year > from && e.year <= to && e.weight !== 'line' && e.text !== null)
    .sort((a, b) => (CHRONICLE_RANK[a.weight] ?? 3) - (CHRONICLE_RANK[b.weight] ?? 3));

  const lines: ChapterLine[] = told.map((e) => ({ text: e.text }));
  if (lines.length >= MIN_VERDICT_LINES) return lines;

  // THE STRUCTURAL FALLBACK. Measured: fewer than three page/paragraph
  // chronicle entries in a window is 16% of closings. It is never a window
  // with nothing in it — a family living through five or more years is born
  // into, dies out of, and hands its seal on regardless of whether the
  // chronicler found a sentence for any of it — so this reaches past the
  // book and into the succession record and the people store directly.
  const blood = w.people.blood(w.playerHouse);

  for (const s of w.succession) {
    if (s.from > from && s.from <= to) {
      lines.push({ text: msg(ctx, 'chapter.seal', '{PERSON} took the seal.', { PERSON: s.name }) });
    }
  }
  for (const p of blood) {
    if (p.died !== undefined && p.died > from && p.died <= to) {
      lines.push({ text: msg(ctx, 'chapter.death', '{PERSON} died.', { PERSON: p.name }) });
    }
  }
  const born = blood.filter((p) => p.born > from && p.born <= to).length;
  if (born > 0) {
    lines.push({ text: born === 1
      ? msg(ctx, 'chapter.birth', '{COUNT} child was born to the house.', { COUNT: String(born) })
      : msg(ctx, 'chapter.births', '{COUNT} children were born to the house.', { COUNT: String(born) }) });
  }

  // THE LAST RESORT, unconditional: always true, always available, and what
  // GUARANTEES the floor rather than merely making it likely — found by a
  // test that ran exactly this window (a fresh founding, an empty chronicle)
  // and got two. A window can run five years or more with no birth, no
  // death and no succession change in the smallest and quietest of houses,
  // and these three facts are the ones that are always on the world
  // regardless of what happened in it.
  if (lines.length < MIN_VERDICT_LINES) {
    lines.push({ text: msg(ctx, 'chapter.standing', "The house's standing stood at {RESPECT} when the years turned.",
      { RESPECT: w.respect }) });
  }
  if (lines.length < MIN_VERDICT_LINES) {
    const living = blood.filter((p) => p.status === 'alive').length;
    lines.push({ text: msg(ctx, 'chapter.living', '{COUNT} of the blood were living when it ended.',
      { COUNT: String(living) }) });
  }
  if (lines.length < MIN_VERDICT_LINES) {
    lines.push({ text: msg(ctx, 'chapter.treasury', 'The treasury held {CROWNS} crowns.',
      { CROWNS: String(Math.round(w.treasury)) }) });
  }

  return lines;
}
