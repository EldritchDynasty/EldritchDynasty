import type { ProseMode } from '@ed/schema';
import { loadBundle } from './content.js';

/** Text is split for rendering, never rewritten in a save or Chronicle. */
export type GlossarySegment = { text: string; term?: string };
// ZWNJ and ZWJ connect word segments in some scripts; an alias beside one\n// is not a standalone label, even though the joiner is a Unicode format character.\nconst WORD_CHARACTER = /[\p{L}\p{M}\p{N}_\u200C\u200D]/u;

export function glossaryDefinition(id: string, mode: ProseMode = 'original'): string | undefined {
  return loadBundle().glossary.find((term) => term.id === id)?.definition[mode];
}

/** Keep the Standing ledger and inline explanations on one authored source. */
export function standingGlossaryDefinition(mode?: ProseMode): string {
  return glossaryDefinition('standing', mode) ?? '';
}

/** Match the first full-word alias, keeping saved historical wording intact. */
export function splitFirstGlossary(text: string, mode: ProseMode = 'original', onlyIds?: readonly string[]): GlossarySegment[] {
  let match: { index: number; alias: string; id: string } | undefined;
  for (const term of loadBundle().glossary) {
    if (onlyIds && !onlyIds.includes(term.id)) continue;
    for (const alias of term.aliases[mode]) {
      let position = 0;
      for (;;) {
        const index = text.indexOf(alias, position);
        if (index < 0) break;
        // Unicode supplementary-plane letters must be inspected as whole code points.
        const preceding = [...text.slice(Math.max(0, index - 2), index)].at(-1) ?? '';
        const following = [...text.slice(index + alias.length, index + alias.length + 2)][0] ?? '';
        if ((!preceding || !WORD_CHARACTER.test(preceding))
          && (!following || !WORD_CHARACTER.test(following))) {
          if (!match || index < match.index || (index === match.index && alias.length > match.alias.length)) {
            match = { index, alias, id: term.id };
          }
          break;
        }
        position = index + alias.length;
      }
    }
  }
  if (!match) return [{ text }];
  return [
    ...(match.index ? [{ text: text.slice(0, match.index) }] : []),
    { text: match.alias, term: match.id },
    ...(match.index + match.alias.length < text.length
      ? [{ text: text.slice(match.index + match.alias.length) }] : []),
  ];
}

/** Current shipped surfaces intentionally opt in to the first delivered term. */
export function splitFirstStanding(text: string, mode?: ProseMode): GlossarySegment[] {
  return splitFirstGlossary(text, mode, ['standing']);
}
