import type { ProseMode } from '@ed/schema';

/**
 * First delivered term for #1991. The Standing header and Chronicle share the
 * same reader-facing definition until the validated content glossary replaces
 * this small source. No game state, saved text or prose is changed.
 */
export function standingGlossaryDefinition(mode?: ProseMode): string {
  return mode === 'plainenglish'
    ? 'How the wider world regards this family.'
    : 'the regard the wider world gives the house.';
}

export type GlossarySegment = { text: string; term?: 'standing' };

const WORD_CHARACTER = /[\p{L}\p{M}\p{N}_]/u;

/**
 * Only the capitalized vocabulary label, not "standing preference" in a
 * Chronicle note or a substring of another word. Return a split with at most
 * one term, preserving every input character in its original order.
 */
export function splitFirstStanding(text: string, mode?: ProseMode): GlossarySegment[] {
  // Chronicle prose is a fixed historical artefact: changing the reader's
  // prose mode changes the explanation, not the word already saved on a page.
  // Recognize both authored labels in both modes; earliest eligible wins.
  const aliases = mode === 'plainenglish'
    ? ['Reputation', 'Standing']
    : ['Standing', 'Reputation'];
  let match: { index: number; alias: string } | null = null;
  for (const alias of aliases) {
    let position = 0;
    for (;;) {
      const index = text.indexOf(alias, position);
      if (index < 0) break;
      // JS indexes UTF-16 units, but a boundary is a Unicode character:
      // supplementary-plane letters and digits use two units. Look at the
      // adjacent full code points, not at isolated surrogate halves.
      const preceding = [...text.slice(Math.max(0, index - 2), index)].at(-1) ?? '';
      const following = [...text.slice(index + alias.length, index + alias.length + 2)][0] ?? '';
      if ((!preceding || !WORD_CHARACTER.test(preceding))
        && (!following || !WORD_CHARACTER.test(following))) {
        if (!match || index < match.index) match = { index, alias };
        break;
      }
      position = index + alias.length;
    }
  }
  if (!match) return [{ text }];
  const { index, alias } = match;
  return [
    ...(index ? [{ text: text.slice(0, index) }] : []),
    { text: alias, term: 'standing' },
    ...(index + alias.length < text.length
      ? [{ text: text.slice(index + alias.length) }] : []),
  ];
}
