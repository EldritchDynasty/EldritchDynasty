/**
 * THE FIVE MARKS, AND WHAT THEY SAY (issue #107).
 *
 * ✦ ◈ ◇ ☾ ✎ ⊘ are the entire visual language of the family tree, and every
 * one of them carried its meaning in a `title` attribute and nowhere else.
 * There is no hover on a phone. A player there met six glyphs scattered
 * through eighty-eight cards with no way, anywhere in the game, to learn what
 * a single one of them meant — and nothing about that looked broken, which is
 * how it survived.
 *
 * So the meanings live here, once, and three things read them: the card draws
 * the glyph, the same string goes on `aria-label` for a screen reader, and
 * `App.vue`'s legend prints the whole table where a thumb can reach it. A
 * tooltip is a fine third channel. It was never a first one.
 *
 * `touch.test.ts` fails the build on a `title` whose text has no other route
 * to the player, so a seventh mark cannot arrive the way the first six did.
 */
import type { ProseMode } from '@ed/schema';

export type MarkKind = 'seal' | 'expresses' | 'carries' | 'madness' | 'drift' | 'given';

export interface Mark {
  readonly kind: MarkKind;
  readonly glyph: string;
  /** What it says, in the house's own words. Announced, and printed in the legend. */
  readonly says: string;
}

/**
 * Two marks for the Power, because they are two facts (issue #78). ◈ is it
 * coming through him; ◇ is a daughter who woke to what she carries and will
 * never express it. One glyph for both said the opposite of §7 on every woman
 * in the house.
 */
export const MARKS: Readonly<Record<MarkKind, Mark>> = {
  seal: { kind: 'seal', glyph: '✦', says: 'holds the seal' },
  expresses: { kind: 'expresses', glyph: '◈', says: 'awakened — it comes through them' },
  carries: { kind: 'carries', glyph: '◇', says: 'awakened — they carry it and will not express it' },
  madness: { kind: 'madness', glyph: '☾', says: 'how far the Power has taken them' },
  drift: { kind: 'drift', glyph: '✎', says: 'the record and the person do not agree' },
  given: { kind: 'given', glyph: '⊘', says: 'given to the rite' },
};

/** Plain English reader copy only. Glyphs, meaning and game state never change. */
const PLAIN_SAYS: Readonly<Record<MarkKind, string>> = {
  seal: 'Leads the family',
  expresses: 'Awakened: this person can use the Power',
  carries: 'Awakened: this person carries the Power but cannot use it',
  madness: 'How strongly the Power has affected this person',
  drift: 'The written record differs from this person',
  given: 'Was sacrificed in a rite',
};

/** One identity and one rendering path for both the card's accessible mark and help legend. */
export function markSays(kind: MarkKind, mode: ProseMode = 'original', madness?: number): string {
  if (kind === 'madness' && madness !== undefined) {
    const amount = Math.round(madness);
    return mode === 'plainenglish' ? `Power's effects: ${amount}` : `madness ${amount}`;
  }
  return mode === 'plainenglish' ? PLAIN_SAYS[kind] : MARKS[kind].says;
}

/** The legend, in the order they are worth learning in. */
export const LEGEND: readonly Mark[] = [
  MARKS.seal, MARKS.expresses, MARKS.carries, MARKS.madness, MARKS.drift, MARKS.given,
];

/**
 * The moon carries a number as well as a meaning, and the number is the point:
 * a mark that only says "mad" is a mark that says the same thing at 3 and at
 * 90. The legend teaches the glyph; the card says how far it has gone.
 */
export function madnessMark(madness: number): Mark {
  return { ...MARKS.madness, says: `madness ${Math.round(madness)}` };
}
