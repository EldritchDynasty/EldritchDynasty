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

const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

/**
 * Only the capitalized vocabulary label, not "standing preference" in a
 * Chronicle note or a substring of another word. Return a split with at most
 * one term, preserving every input character in its original order.
 */
export function splitFirstStanding(text: string, mode?: ProseMode): GlossarySegment[] {
  const alias = mode === 'plainenglish' ? 'Reputation' : 'Standing';
  let position = 0;
  for (;;) {
    const index = text.indexOf(alias, position);
    if (index < 0) return [{ text }];
    const preceding = index > 0 ? text[index - 1]! : '';
    const following = text[index + alias.length] ?? '';
    if ((!preceding || !WORD_CHARACTER.test(preceding))
      && (!following || !WORD_CHARACTER.test(following))) {
      return [
        ...(index ? [{ text: text.slice(0, index) }] : []),
        { text: text.slice(index, index + alias.length), term: 'standing' },
        ...(index + alias.length < text.length
          ? [{ text: text.slice(index + alias.length) }] : []),
      ];
    }
    position = index + alias.length;
  }
}
