import { MAIN_BRANCH, type Person } from '@ed/schema';
import type { SimCtx } from '../world.js';
import { attr, phenotypeOf } from './factory.js';
import { baseName } from './names.js';
import { msg } from '../messages.js';

/**
 * WHO IS WORTH NAMING (issue #62).
 *
 * Measured through the client over five seeds, naming was **188.8 stops a
 * run — 37.1% of everything the player was ever asked**, and 205.6 names
 * typed. The single most frequent act in a game about deciding who marries
 * whom and what the book says was typing a name into a text field, for
 * people who mostly died unremarked. Naming is meant to be one of the four
 * verbs; it was the tax you paid to reach the other three.
 *
 * (It had already been cut once, from 686 to 189, by asking only for the
 * seat's children. That halved a form and left a form.)
 *
 * So the chronicler's suggestion is taken SILENTLY by default, and a prompt
 * is raised only where the child is somebody. `keepSuggestedNames` was
 * already a supported way to play; this makes it the default rather than a
 * 189-click opt-out.
 *
 * ── THE REASON IS PART OF THE PROMPT ──────────────────────────────────────
 *
 * Every surviving prompt says why it is being raised, in the family's own
 * terms. A prompt with no reason on it is indistinguishable from the form
 * this replaced — the player cannot tell a child who matters from the next
 * one in the queue, so they answer both the same way, which is the whole
 * failure being fixed.
 *
 * The reasons are checked in order and the FIRST one wins. A child who is
 * both the heir and a throwback is announced as the heir; a list of four
 * reasons reads as a database record rather than as a chronicler telling you
 * something.
 */

/** How far back "in living memory" reaches for the font drought. Three generations. */
export const FONT_DROUGHT_YEARS = 75;

/**
 * How far outside the line an attribute must sit to be a throwback: a share
 * of the population mean, AND a share of the best the line has ever managed.
 *
 * Both are needed, and the second is the one that does the work. A house of
 * ten living people produces the best living example of SOMETHING almost
 * every birth — the first cut of this asked only that and fired 837 times in
 * five runs, four-fifths of every prompt in the game. Against everybody the
 * line has ever had, living and dead, and with real headroom over them, it
 * means what the sentence says.
 */
export const THROWBACK_MARGIN = 1.6;
export const THROWBACK_OVER_BEST = 1.12;

/**
 * The attributes a family could actually remark on. `ctx.genetics.expected`
 * carries every locus-backed quantity, and four of them are not observations
 * about a newborn: `max_age`, `health` and `fertility` are derived by
 * `applyVitality` from the others, and `madness` and `eldritch_power` are the
 * two things §11 is explicit that nobody in these houses can read off a baby.
 */
const NOT_OBSERVABLE = new Set(['max_age', 'health', 'fertility', 'madness', 'eldritch_power']);

/** Sons in a row before a daughter is news, and vice versa. */
export const SAME_SEX_RUN = 4;

/**
 * Why this child is worth asking the player about, or `undefined` for the
 * overwhelming majority who are not.
 *
 * Pure: reads the world, writes nothing, rolls nothing.
 */
export function nameWorthAsking(ctx: SimCtx, child: Person): string | undefined {
  const w = ctx.world;
  const branch = child.membership[0]?.branch ?? MAIN_BRANCH;

  // ── The first of a new hall ─────────────────────────────────────────────
  // Asked first and answered alone, because it is the one reason that applies
  // to a child of a cadet branch at all. Everything below is about the seat:
  // a cadet's fourth daughter in a hall the chronicle will never mention is
  // not a decision, which is the cut that took naming from 686 to 189 and
  // still holds.
  if (branch !== MAIN_BRANCH) {
    const state = w.branches.get(branch);
    if (!state) return undefined;
    // THE FOUNDER'S OWN FIRST CHILD, not the first child born under that
    // roof. Any child of the hall caught 17.6 a run, most of them born to
    // cousins who merely live there — and a cadet's child in a hall the
    // chronicle will never mention is precisely the category the earlier cut
    // removed. The man who took the east rooms and then had a son there is
    // the founding of a branch, which is the thing worth a name.
    if (!fatheredBy(child, state.founder)) return undefined;
    const older = w.people.children(state.founder).some((c) =>
      c.id !== child.id && c.born > state.foundedYear);
    return older ? undefined : msg(ctx, 'naming.worth.first_cadet_child', 'the first child of a new cadet branch');
  }

  // ── The heir ────────────────────────────────────────────────────────────
  // `heirApparent` cannot answer this: it requires sixteen years, so a
  // newborn is never it. What a family means at a birth is narrower and
  // sharper — the sitting Head has a son, and had none before today.
  // The seal, asked the way every other reader asks it (invariant 12).
  const head = w.people.living().find((p) => p.castSlots.includes('head'));
  if (head && child.sex === 'male' && fatheredBy(child, head.id)) {
    const others = w.people.children(head.id).filter((c) =>
      c.id !== child.id && c.sex === 'male' && c.status === 'alive');
    if (!others.length) return msg(ctx, 'naming.worth.heads_first_son', 'the Head has a son, and had none before today');
  }

  // ── The blood, after a drought ──────────────────────────────────────────
  if (phenotypeOf(child, ctx.genetics, w.year).eldritch.carriedFont !== null) {
    const since = w.year - FONT_DROUGHT_YEARS;
    const anyOther = w.people.all().some((p) =>
      p.id !== child.id
      && p.houseOfOrigin === w.playerHouse
      && p.born >= since
      && phenotypeOf(p, ctx.genetics, w.year).eldritch.carriedFont !== null);
    if (!anyOther) {
      return msg(ctx, 'naming.worth.blood_returns', 'the first of the blood to carry it in three generations');
    }
  }

  // NO TWIN RULE. #62 asks for one and this simulation cannot produce a twin:
  // `rollBirths` walks each mother once a year and pushes at most one
  // conception, so two children of one mother in one year is unreachable. A
  // branch that can never be taken is not a stub, it is a lie about what the
  // predicate does — and it would have sat here reading correctly forever.
  // If twins are wanted they are a change to `rollBirths`, and then this.

  // ── The run broken ──────────────────────────────────────────────────────
  const run = sameSexRun(ctx, child);
  if (run >= SAME_SEX_RUN) {
    return child.sex === 'female'
      ? msg(ctx, 'naming.worth.daughter_after_sons', 'the first daughter after {COUNT} sons', { COUNT: String(run) })
      : msg(ctx, 'naming.worth.son_after_daughters', 'the first son after {COUNT} daughters', { COUNT: String(run) });
  }

  // ── Born the year the seat changed hands ────────────────────────────────
  // The new man's OWN child, not any child of the house. A seal changes about
  // forty times in a thousand years and the house is bearing throughout, so
  // "born in that year" caught nineteen children a run and said nothing about
  // any of them. A son born to a man in the same twelve months he buried his
  // father is a different sentence.
  if (head && w.headSince === w.year && w.succession.length > 1
    && fatheredBy(child, head.id)) {
    return msg(ctx, 'naming.worth.born_to_new_head', 'born to the new Head in the year he took the seal');
  }

  // ── A throwback ─────────────────────────────────────────────────────────
  // LAST, and that is not arbitrary. Every reason above is a structural fact
  // the family states in one clause — he is the Head's first son, she is the
  // first daughter after four sons. This one is a statistical reading of a
  // newborn, which is the vaguest thing on the list and the likeliest to be
  // noise. It is the tie-breaker rather than the headline: where the house
  // has something plainer to say about a child, it says that.
  const throwback = outsideTheLine(ctx, child);
  if (throwback) {
    return msg(ctx, 'naming.worth.throwback', '{ATTRIBUTE} well outside anything the line has produced',
      { ATTRIBUTE: throwback });
  }

  return undefined;
}

/** Whether the documents say this man is the father. The claim, not the blood (§7). */
function fatheredBy(child: Person, id: string): boolean {
  return (child.claimedParents.father ?? child.trueParents.father) === id;
}

/**
 * An attribute this child has and the living blood does not.
 *
 * Measured against the population mean rather than against the family, and
 * then against the family — a house that has been breeding for mind for four
 * hundred years should not be startled by another clever child, and a house
 * that has not should be. Centred on `ctx.genetics.expected`, per invariant 10.
 */
function outsideTheLine(ctx: SimCtx, child: Person): string | undefined {
  const w = ctx.world;
  // EVERYBODY THE LINE HAS EVER PRODUCED, dead included. "Anything the line
  // has produced" is a claim about four hundred years of a family, not about
  // the nine cousins who happen to be alive this spring.
  const line = w.people.blood(w.playerHouse).filter((p) => p.id !== child.id);
  if (line.length < 8) return undefined;

  for (const [key, expected] of ctx.genetics.expected) {
    if (expected <= 0 || NOT_OBSERVABLE.has(key)) continue;
    const mine = attr(child, key, ctx.genetics, w.year);
    if (mine < expected * THROWBACK_MARGIN) continue;
    const best = Math.max(...line.map((p) => attr(p, key, ctx.genetics, w.year)));
    if (mine < best * THROWBACK_OVER_BEST) continue;
    return key.replace(/_/g, ' ');
  }
  return undefined;
}

/** How many of this mother's living children before this one shared the other sex. */
function sameSexRun(ctx: SimCtx, child: Person): number {
  const mother = child.claimedParents.mother ?? child.trueParents.mother;
  if (!mother) return 0;
  const older = ctx.world.people.children(mother)
    .filter((c) => c.id !== child.id && c.born <= child.born)
    .sort((a, b) => b.born - a.born);

  let run = 0;
  for (const c of older) {
    if (c.sex === child.sex) break;
    run += 1;
  }
  return run;
}

/**
 * WHAT A GREAT NAME COSTS (issue #62, second half).
 *
 * Bynames and dynastic ordinals shipped, so nobody in the game is called
 * `Garrick 788` — and nothing whatever happened because of a name. A player
 * could call a son after the founder and the world would not blink.
 *
 * Now it does. A Head the player deliberately named after a man who held the
 * seal before him is **measured against that man**: `assizePressure` grades
 * the house on a rising expectation, and carrying the name raises the bar he
 * is graded on. He does not start with an advantage and he cannot lose the
 * name. It is the world expecting more, which is the only thing §29's world
 * does anyway, and it is a reading rather than a hidden nudge — the view
 * carries it and the chronicle says so the year he takes the seal.
 *
 * ── WHY IT ONLY COUNTS A NAME THE PLAYER CHOSE ────────────────────────────
 *
 * Dynastic naming already reuses a Head's name constantly and by design:
 * `dynasticNames` counts the dead, so the house produces an Edric the fourth
 * without anybody deciding anything. Grading every one of those would make
 * this a tax on the naming system rather than a consequence of a decision,
 * and it would move every number in the harness.
 *
 * So the test is the decision log. `renameChild` writes a `name` entry and
 * nothing else does — a chronicler-driven run has none, which is also why
 * `npm run digest` does not move.
 */
export const NAMESAKE_EXPECTATION = 0.05;
export const NAMESAKE_CAP = 0.1;

export interface Namesake {
  /** The name, without its ordinal. */
  name: string;
  /** How many Heads before this one bore it. */
  before: number;
}

/**
 * The sitting Head's namesake, where the player gave him the name and a Head
 * before him bore it. Derived — from `world.succession` and the decision log,
 * both of which are already saved — because a stored flag would be a second
 * place that can disagree with the first.
 */
export function headNamesake(ctx: SimCtx): Namesake | undefined {
  const w = ctx.world;
  const head = w.people.living().find((p) => p.castSlots.includes('head'));
  if (!head) return undefined;
  if (!w.decisionLog.some((d) => d.kind === 'name' && d.person === head.id)) return undefined;

  const mine = baseName(head.name);
  // Heads before him, by the name the house called them while they held it.
  const before = w.succession.filter((s) => s.person !== head.id && baseName(s.name) === mine).length;
  return before ? { name: mine, before } : undefined;
}

/** How much higher the bar sits for a Head carrying a Head's name. */
export function namesakeBurden(ctx: SimCtx): number {
  const n = headNamesake(ctx);
  return n ? Math.min(NAMESAKE_CAP, n.before * NAMESAKE_EXPECTATION) : 0;
}
