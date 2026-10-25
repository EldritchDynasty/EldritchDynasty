import type { LibraryBookState, Person, PersonId, SpellbookDef } from '@ed/schema';
import { asId, canLearn, isContentProseField } from '@ed/schema';
import type { SimCtx } from '../world.js';
import { attr } from './factory.js';
import { ageCareerFactor } from '../ages/strategy.js';
import { DEBT_FLOOR } from '../economy.js';
import { msg } from '../messages.js';
import { renderContentProse } from '../prose.js';
import { covertReservation } from '../presence.js';
import { libraryCare, noteBookCare } from '../mystic-civilian.js';

/**
 * THE LIBRARY — applying a spellbook, one mechanism for every book there will
 * ever be, on the same bargain `people/heirlooms.ts` makes: content is open,
 * the verb list is closed.
 *
 * Two layers, kept apart on purpose:
 *
 *   `WorldState.library`   the house's SHELF. A physical copy, bought once,
 *                          degrading with use, inheritable because the copy
 *                          persists. Mirrors `HeirloomState` exactly, and for
 *                          the same reason.
 *
 *   `Person.spellsKnown`   who has actually STUDIED a copy. Persists even if
 *                          the copy is later sold — knowledge already learned
 *                          is not erased by losing the book.
 *
 * Mystic magic shares NO code with the Eldritch font (invariant 4). Nothing
 * below ever reads or writes `madness` or `eldritch`, and it must not.
 */

export function spellbookDef(ctx: SimCtx, id: string): SpellbookDef | undefined {
  return ctx.content.spellbook(id);
}

/** Completed knowledge belongs to the reader, independently of the physical copy. */
export function knowsAffinity(ctx: SimCtx, p: Person, affinity: string): boolean {
  return p.status === 'alive' && canLearn(p.sex, affinity)
    && p.spellsKnown.some((id) => spellbookDef(ctx, id)?.affinity === affinity);
}

export function heldBooks(ctx: SimCtx): LibraryBookState[] {
  return [...ctx.world.library.values()];
}

/** Put a copy on the shelf. Idempotent — the house owns a physical copy once. */
export function acquireLibraryCopy(ctx: SimCtx, id: string): LibraryBookState | undefined {
  const def = spellbookDef(ctx, id);
  if (!def) return undefined;
  const existing = ctx.world.library.get(id);
  if (existing) return existing;
  const state: LibraryBookState = { id, acquiredYear: ctx.world.year, condition: 100 };
  ctx.world.library.set(id, state);
  return state;
}

/**
 * The physical copy leaves the house — burned, stolen, sold, given as tribute.
 * A reader cannot finish a study against a copy that has been taken away.
 * Already learned spells live on the person and are not erased.
 */
export function loseLibraryCopy(ctx: SimCtx, id: string): boolean {
  if (!ctx.world.library.delete(id)) return false;
  ctx.world.studies = ctx.world.studies.filter((study) => study.book !== id);
  return true;
}

/**
 * Distress sale under the debt floor (#1205). Sell at most one copy in a year:
 * the cheapest available book by its authored minimum price, breaking equal
 * prices by stable id rather than Map insertion order. Copies with a binder
 * are not physically on the shelf to sell. The sale is deterministic and
 * belongs to the library phase, not a second economy calculation.
 */
export function tickDistressedBookSale(ctx: SimCtx): void {
  const w = ctx.world;
  if (w.treasury >= DEBT_FLOOR) return;
  const candidates = [...w.library.values()]
    .filter((copy) => copy.restoresAt === undefined)
    .map((copy) => ({ copy, def: spellbookDef(ctx, copy.id) }))
    .filter((item): item is { copy: LibraryBookState; def: SpellbookDef } => item.def !== undefined)
    .sort((a, b) => a.def.price.min - b.def.price.min || a.copy.id.localeCompare(b.copy.id));
  const cheapest = candidates[0];
  if (!cheapest) return;

  // Like a parcel sold under pressure, a book brings less than its list cost.
  const proceeds = Math.max(1, Math.floor(cheapest.def.price.min * 0.75));
  if (!loseLibraryCopy(ctx, cheapest.copy.id)) return;
  w.treasury += proceeds;

  const file = ctx.content.sourceOf(cheapest.copy.id);
  const name = file && isContentProseField('name', cheapest.def.name)
    ? renderContentProse(ctx, file, `spellbooks[id=${encodeURIComponent(cheapest.copy.id)}].name`, cheapest.def.name)
    : cheapest.def.name;
  w.chronicle.push({
    year: w.year, weight: 'line', named: false,
    text: msg(ctx, 'library.distress_sale',
      'To answer its debts, the house sold {BOOK} for {PRICE} crowns.',
      { BOOK: name, PRICE: String(proceeds) }),
  });
}

/**
 * Wear on a copy the house actually holds.
 *
 * This used to call `acquireLibraryCopy`, which MINTS the copy when the shelf
 * has none — so `op: 'degrade'` against a book the house had never bought put
 * it on the shelf at `100 - degradesBy` and handed the player a volume they
 * did not own. Damage created the thing it damaged. The Crusade's second
 * cellar is the live case: a house that never bought the two dark workings
 * was given both of them for choosing to hide them.
 *
 * `gainSpellbook` auto-acquires on purpose and still does — "the house
 * already had it" is a sane default for a grant. It is not a sane default for
 * a fire.
 */
export function degradeLibraryCopy(ctx: SimCtx, id: string, amount?: number): LibraryBookState | undefined {
  const state = ctx.world.library.get(id);
  if (!state) return undefined;
  const def = spellbookDef(ctx, id);
  state.condition = Math.min(100, Math.max(0, state.condition - (amount ?? def?.degradesBy ?? 20)));
  return state;
}

/**
 * Normalise passive wear to tenths, so 0.2 each year cannot accumulate
 * floating-point drift across a 500-year campaign or a save/reload.
 * Authored one-off degradation retains its existing precision and semantics.
 */
const YEARLY_BOOK_WEAR = 0.2;
const SUCCESSFUL_STUDY_WEAR = 5;

function wearHeldCopy(copy: LibraryBookState, amount: number): void {
  copy.condition = Math.round(Math.max(0, copy.condition - amount) * 10) / 10;
}

/**
 * Each previously acquired physical copy wears in the Library year phase.
 * A newly obtained copy is not charged for a year it was not on the shelf.
 * This has no RNG draw, new Person state or effect on absent books.
 *
 * #1293 also provides a paid binder order; an in-progress restoration
 * exempts the physical copy from annual wear until its recorded return.
 */
export function tickLibraryWear(ctx: SimCtx): void {
  for (const copy of ctx.world.library.values()) {
    if (copy.acquiredYear >= ctx.world.year || copy.restoresAt !== undefined) continue;
    const before = copy.condition;
    const reduction = libraryCare(ctx, copy.id)?.benefit.wearReduction ?? 0;
    wearHeldCopy(copy, YEARLY_BOOK_WEAR * (1 - reduction));
    noteBookCare(ctx, copy.id, Math.max(0, Math.min(before, YEARLY_BOOK_WEAR) - (before - copy.condition)));
  }
}

/** The same quote and refusals serve the Table, its read model and the binder. */
export interface RestorationQuote {
  fee: number;
  years: number;
  returns: number;
  ok: boolean;
  reason?: string;
}

export function restorationQuote(ctx: SimCtx, id: string): RestorationQuote | undefined {
  const copy = ctx.world.library.get(id);
  const def = spellbookDef(ctx, id);
  if (!copy || !def) return undefined;
  const missing = Math.max(0, 100 - copy.condition);
  const reduction = libraryCare(ctx, id, 'restorationReduction')?.benefit.restorationReduction ?? 0;
  const fee = Math.max(1, Math.ceil(def.price.min * 0.2 * missing / 100 * (1 - reduction)));
  const years = Math.max(1, Math.ceil(missing / 50));
  const returns = copy.restoresAt ?? ctx.world.year + years;
  if (copy.restoresAt !== undefined) {
    return { fee, years, returns, ok: false, reason: msg(ctx, 'library.restore.in_progress', 'the copy is already with the binder') };
  }
  if (missing === 0) {
    return { fee, years, returns, ok: false, reason: msg(ctx, 'library.restore.pristine', 'the copy needs no repair') };
  }
  if (ctx.world.studies.some((study) => study.book === id
    && ctx.world.people.get(study.person)?.status === 'alive')) {
    return { fee, years, returns, ok: false, reason: msg(ctx, 'library.restore.reading', 'someone is still reading this copy') };
  }
  return { fee, years, returns, ok: true };
}

/** Finish binding AFTER annual wear; the returned copy is pristine this year. */
export function tickRestorations(ctx: SimCtx): void {
  for (const copy of ctx.world.library.values()) {
    if (copy.restoresAt === undefined || copy.restoresAt > ctx.world.year) continue;
    copy.condition = 100;
    delete copy.restoresAt;
    const def = spellbookDef(ctx, copy.id);
    const file = ctx.content.sourceOf(copy.id);
    const name = def && file && isContentProseField('name', def.name)
      ? renderContentProse(ctx, file, `spellbooks[id=${encodeURIComponent(copy.id)}].name`, def.name)
      : def?.name ?? copy.id;
    ctx.world.chronicle.push({
      year: ctx.world.year, weight: 'line', named: false,
      text: msg(ctx, 'library.binder_returned', 'The binder returned {BOOK}, repaired and ready to read.', { BOOK: name }),
    });
  }
}

/**
 * Whether `p` may take up this book at all — canLearn (invariant 4) and the
 * affinity threshold (a Named Art's floor). Separated from `gainSpellbook` on
 * the same principle as `canUseHeirloom`: an option the player cannot take is
 * shown anyway, greyed, with the reason beside it.
 */
export interface CanStudy {
  ok: boolean;
  reason?: string;
}

export function canStudySpellbook(ctx: SimCtx, p: Person, def: SpellbookDef): CanStudy {
  // A study and its eventual grant must address the live, world-owned person.
  // An old snapshot with the same id is not that person: letting it pass can
  // create a ghost study or acquire a shelf copy for someone the world never
  // taught. Dead and guardian records cannot take up new books either.
  if (p.status !== 'alive' || ctx.world.people.get(p.id) !== p) return { ok: false };
  if (p.captivity) return { ok: false, reason: msg(ctx, 'library.refuse.captive', 'they are held away from the house') };
  if (covertReservation(ctx, p.id)) return { ok: false, reason: msg(ctx, 'library.refuse.expedition', 'they are away with an expedition') };
  // A standing Mystic duty is the reader's one intensive occupation (#1873).
  // Their book waits in `world.mystic.pauses` and resumes when the duty ends.
  if (ctx.world.mystic.assignments.some((a) => a.practitioner === p.id)) {
    return { ok: false, reason: msg(ctx, 'library.refuse.on_duty', 'they are keeping a Mystic duty') };
  }
  if (ctx.world.library.get(def.id)?.restoresAt !== undefined) {
    return { ok: false, reason: msg(ctx, 'library.refuse.binder', 'the copy is with the binder') };
  }
  // §11's LEARNING GATE (issue #79). "Until a character Awakens, all power is
  // written down and unreachable. Learning cannot begin."
  //
  // This asked two questions for a long time and this was not one of them.
  // Measured before it was added: 997 of 1,093 readers — 91% of everyone who
  // has ever finished a book in this game — did it without waking, Daveed
  // Gearithy among them with two books to his name. §11 states the rule three
  // times, once for each sex and once as a consequence, and `core` asked it
  // nowhere: `grep -rn "awakening.awakened" packages/core/src` returned
  // `cast.ts`, `ascension.ts`, `match.ts`, `conditions.ts`, `slots.ts` and
  // `expression.ts`, and not this file.
  //
  // It goes FIRST because it is prior to the others in the design: the
  // question is not which book, it is whether this person can reach any of
  // them yet. It is what makes three designed pressures cost something.
  //
  //   The Long Wait  — an unwoken child of promising blood is a year of
  //                    feeding and protecting somebody who cannot yet be
  //                    useful. It was free while he was in the library like
  //                    everybody else.
  //   Mundane        — declaring a child mundane closes off `rollAwakening`.
  //                    It now closes off the library with it, which is what
  //                    the Head giving up on somebody is supposed to mean.
  //   The daughter   — §11's "one honest signal in a marriage market
  //                    otherwise built entirely on forged documents". An
  //                    early waking is the moment she becomes useful; it was
  //                    worth strictly one thing before this, a +2 in
  //                    `pedigreeKnown`.
  //
  // NOT a Madness path and not an eldritch one — invariant 4 holds, because
  // this reads a flag `expression.ts` already computed and shares no code
  // with `eldritch()`. What it does mean is that a person with no font can
  // never study, since `rollAwakening` needs `carriedFont > 0`: §11 says
  // exactly that ("The Unwoken: cannot learn"), and it is the deliberate
  // scope of this gate rather than a side effect of it.
  if (!p.awakening.awakened) return { ok: false, reason: msg(ctx, 'library.refuse.not_woken', 'not woken') };
  // INVARIANT 4: the Mystic restriction. Shares no code with eldritch expression.
  if (!canLearn(p.sex, def.affinity)) {
    return { ok: false, reason: msg(ctx, 'library.refuse.not_hers', 'not hers to learn') };
  }
  if (def.threshold > 0) {
    const have = attr(p, def.affinity, ctx.genetics, ctx.world.year);
    if (have < def.threshold) {
      return { ok: false, reason: msg(ctx, 'library.refuse.affinity_short', 'the affinity is not there yet') };
    }
  }
  return { ok: true };
}

/**
 * Study concludes and the knowledge is theirs. Auto-acquires the shelf copy
 * if the house does not already hold one — "the house already had it" is a
 * simpler default than forcing every study event to separately author a
 * purchase, and matches `grantHeirloom`'s own idempotent-grant convention.
 *
 * A Named Art (tier `named`) is recorded under the name of whoever gains it
 * first, permanently, the moment that happens — the canon a house accumulates.
 */
export function gainSpellbook(ctx: SimCtx, p: Person, def: SpellbookDef): boolean {
  if (!canStudySpellbook(ctx, p, def).ok) return false;
  const state = acquireLibraryCopy(ctx, def.id) ?? { id: def.id, acquiredYear: ctx.world.year, condition: 100 };
  ctx.world.library.set(def.id, state);

  if (def.tier === 'named' && !state.namedFor) {
    state.namedFor = { person: p.id, name: p.name, year: ctx.world.year };
    const file = ctx.content.sourceOf(def.id);
    const name = file === undefined || !isContentProseField('name', def.name)
      ? def.name
      : renderContentProse(ctx, file, `spellbooks[id=${encodeURIComponent(def.id)}].name`, def.name);
    ctx.world.chronicle.push({
      year: ctx.world.year,
      weight: 'paragraph',
      title: name,
      text: msg(ctx, 'library.named_art_record',
        "{PERSON} set it down in writing for the first time, and the family has called it {BOOK} — {PERSON}'s working — ever since.",
        { PERSON: p.name, BOOK: name }),
      named: false,
    });
  }

  const bookId = asId<Person['spellsKnown'][number]>(def.id);
  if (!p.spellsKnown.includes(bookId)) p.spellsKnown.push(bookId);
  return true;
}

/**
 * Has anybody read this book yet (issue #82)?
 *
 * Derived from the people rather than stored as a flag on the shelf copy,
 * because the shelf copy is acquired years before anybody opens it and a
 * second field saying "and somebody has now read it" is a field that can
 * disagree with the first. Everybody is minted with an empty `spellsKnown`
 * (`factory.ts`), so anyone holding this book studied it here.
 *
 * A reader stripped of the book by `loseSpellbookKnowledge` stops counting,
 * which lets a later reading be the first one a second time. That is the
 * honest reading of the sentence: the house no longer has anybody who has
 * read it.
 */
function anybodyHasRead(ctx: SimCtx, book: string): boolean {
  return ctx.world.people.all().some((q) => q.spellsKnown.some((b) => String(b) === book));
}

/** A person forgets, or is stripped of, one book — the shelf copy is untouched. */
export function loseSpellbookKnowledge(ctx: SimCtx, p: Person, id: string): void {
  void ctx;
  p.spellsKnown = p.spellsKnown.filter((b) => String(b) !== id);
}

/**
 * What a RUINED copy (condition 0) multiplies study time by, and the one knob
 * here. 1 turns the drag off entirely; 2 costs a reader a whole second copy's
 * worth of years. Everything between pristine and ruin is linear off it, so a
 * single `degradesBy: 20` knock currently adds a fifth.
 *
 * A multiplier rather than a flat penalty because what damage costs is the
 * READING: a hard book and an easy one do not suffer the same water equally.
 */
const RUIN_STUDY_MULTIPLIER = 2;

/**
 * What a copy's condition costs the man reading it. 1 at pristine, and
 * `RUIN_STUDY_MULTIPLIER` at ruin.
 *
 * A copy the house does not hold reads as pristine, and that is deliberate:
 * `beginStudy` does not require the shelf copy to exist — `gainSpellbook`
 * acquires it on completion — so a study begun against a borrowed or promised
 * volume must not be silently penalised for the shelf being empty.
 */
export function conditionDrag(ctx: SimCtx, id: string): number {
  const state = ctx.world.library.get(id);
  if (!state) return 1;
  return 1 + (RUIN_STUDY_MULTIPLIER - 1) * ((100 - state.condition) / 100);
}

/**
 * How long this man takes over this book. Two multipliers, and they compound:
 *
 *   `studySpeed`  the Scholar's post. Under 1 is faster.
 *   `condition`   the state of the physical copy.
 *
 * The second half is why this comment exists. `LibraryBookState.condition` was
 * declared, initialised to 100, decremented by `op: 'degrade'`, saved and
 * loaded — and read by NOTHING (invariant 11). Its own docstring said
 * degradation "adds years to study time" and left the arithmetic to content,
 * which content could not do: no `Condition` kind exposes a book's condition,
 * so no author could ever branch on it. Five authored outcomes across three
 * files spent a book's condition and bought nothing with it. This is the
 * reader the field was always described as having.
 */
export function effectiveStudyYears(ctx: SimCtx, p: Person, def: SpellbookDef): number {
  const career = p.career && ctx.content.career(p.career.career);
  // An Age magnifies a benefit the post ALREADY owns; it does not invent a
  // study benefit for Military, Clergy, Merchant or Advocate.
  const ageFactor = (career?.studySpeed ?? 1) < 1
    ? ageCareerFactor(ctx, String(career!.id))
    : 1;
  const speed = (career?.studySpeed ?? 1) / ageFactor;
  return Math.max(1, Math.round(def.studyYears * speed * conditionDrag(ctx, def.id)));
}

/**
 * A reader sits down with a book. The knowledge arrives in
 * `effectiveStudyYears`, not now.
 *
 * `canStudySpellbook` is asked HERE rather than on completion, and that is the
 * design rather than an optimisation: a man who cannot learn a thing does not
 * spend six years failing to, and an author who writes the effect against an
 * ineligible reader should see nothing happen immediately rather than nothing
 * happen quietly in 1183.
 *
 * Beginning a book twice is not two studies. The second call is the same man
 * picking up the same volume he is already halfway through.
 */
export function beginStudy(ctx: SimCtx, p: Person, def: SpellbookDef): boolean {
  if (!canStudySpellbook(ctx, p, def).ok) return false;
  if (p.spellsKnown.some((b) => String(b) === def.id)) return false;
  if (ctx.world.studies.some((s) => s.person === p.id && s.book === def.id)) return false;

  ctx.world.studies.push({
    person: p.id,
    book: def.id,
    completes: ctx.world.year + effectiveStudyYears(ctx, p, def),
  });
  return true;
}

/**
 * Finish every study whose year has come. Called by the `library` year phase.
 *
 * A reader who died mid-book, or who lost the eligibility they had when they
 * started, simply drops out — `gainSpellbook` re-asks `canStudySpellbook` and
 * refuses, and the entry leaves the list either way. Six years of reading is
 * long enough that both happen.
 */
export interface FinishedStudy {
  person: PersonId;
  book: string;
  /**
   * Nobody in the house had read this book before (issue #82). Decided HERE,
   * one reader at a time, because it is only true relative to the moment the
   * reader closes the book — and `gainSpellbook` has already run for every
   * other study due the same year by the time this function returns. Asked
   * from the caller instead, two readers finishing the same book in one year
   * each see the other as a prior reader and NEITHER counts as the first,
   * which is a rule that looks correct and silently writes nothing.
   */
  first: boolean;
}

export function completeStudies(ctx: SimCtx): FinishedStudy[] {
  const w = ctx.world;
  const due = w.studies.filter((s) => s.completes <= w.year);
  if (!due.length) return [];

  w.studies = w.studies.filter((s) => s.completes > w.year);

  const finished: FinishedStudy[] = [];
  for (const s of due) {
    const p = w.people.get(s.person);
    const def = spellbookDef(ctx, s.book);
    if (!p || p.status !== 'alive' || !def) continue;
    // Asked before the gain, so the reader is not their own precedent.
    const first = !anybodyHasRead(ctx, s.book);
    if (gainSpellbook(ctx, p, def)) {
      // Study wear is incurred only after learning really succeeds. Dead or
      // newly ineligible readers drop out above without damaging the copy.
      const copy = w.library.get(s.book);
      if (copy) wearHeldCopy(copy, SUCCESSFUL_STUDY_WEAR);
      finished.push({ person: s.person, book: s.book, first });
    }
  }
  return finished;
}
