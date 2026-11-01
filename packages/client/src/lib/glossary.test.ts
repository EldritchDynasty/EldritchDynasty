import { describe, expect, it } from 'vitest';
import { glossaryDefinition, splitFirstGlossary, splitFirstStanding, standingGlossaryDefinition } from './glossary.js';

describe('first Standing glossary term in saved Chronicle text', () => {
  it('preserves every character while marking only the first standalone label', () => {
    const text = 'Standing fell. Standing rose.';
    const segments = splitFirstStanding(text, 'original');
    expect(segments.map((s) => s.text).join('')).toBe(text);
    expect(segments.filter((s) => s.term)).toEqual([{ text: 'Standing', term: 'standing' }]);
  });

  it('matches the Plain English label without marking the Original label', () => {
    // Saved Original prose stays Original when the reader switches mode.
    expect(splitFirstStanding('Standing and Reputation.', 'plainenglish')).toEqual([
      { text: 'Standing', term: 'standing' },
      { text: ' and Reputation.' },
    ]);
    expect(splitFirstStanding('Reputation is known.', 'original')).toEqual([
      { text: 'Reputation', term: 'standing' },
      { text: ' is known.' },
    ]);
    expect(standingGlossaryDefinition('plainenglish')).toBe('How the wider world regards this family.');
  });

  it('never marks an embedded or semantically unrelated lowercase word', () => {
    const text = 'outStanding Standingé Standing2 Standing_name Standing\u0301 standing preference';
    expect(splitFirstStanding(text, 'original')).toEqual([{ text }]);
    expect(splitFirstStanding('Reputational reputation', 'plainenglish'))
      .toEqual([{ text: 'Reputational reputation' }]);
  });

  it('does not mark labels inside supplementary-plane Unicode words', () => {
    // An astral letter or digit is two UTF-16 units. Examining just the
    // neighbour's last/first unit misses its Unicode word-character class.
    for (const value of ['𐐀Standing', 'Standing𐐀', '𝟘Standing', 'Reputation𐐀']) {
      expect(splitFirstStanding(value, 'original')).toEqual([{ text: value }]);
    }
    const text = '𐐀Standing Standing𐐀 ✨Standing✨';
    const segments = splitFirstStanding(text, 'plainenglish');
    expect(segments).toEqual([
      { text: '𐐀Standing Standing𐐀 ✨' },
      { text: 'Standing', term: 'standing' },
      { text: '✨' },
    ]);
    expect(segments.map((segment) => segment.text).join('')).toBe(text);
  });

  it('does not disclose aliases connected to Unicode words by joiners', () => {
    // ZWNJ and ZWJ can form part of a written word, even though Unicode
    // categorizes them as format characters rather than letters or marks.
    for (const mode of ['original', 'plainenglish'] as const) {
      for (const joiner of ['\u200C', '\u200D']) {
        for (const alias of ['Standing', 'Reputation']) {
          for (const text of [`${alias}${joiner}word`, `word${joiner}${alias}`]) {
            expect(splitFirstGlossary(text, mode)).toEqual([{ text }]);
          }
        }
      }
    }

    // Skipping an embedded use must not hide the next standalone label.
    const text = 'word\u200DStanding Standing';
    const pieces = splitFirstGlossary(text, 'original');
    expect(pieces).toEqual([
      { text: 'word\u200DStanding ' },
      { text: 'Standing', term: 'standing' },
    ]);
    expect(pieces.map((piece) => piece.text).join('')).toBe(text);
  });

  it('marks standalone labels at either end and leaves unmatched text unchanged', () => {
    expect(splitFirstStanding('Standing', 'original'))
      .toEqual([{ text: 'Standing', term: 'standing' }]);
    expect(splitFirstStanding('A story of Standing', 'original')).toEqual([
      { text: 'A story of ' },
      { text: 'Standing', term: 'standing' },
    ]);
    expect(splitFirstStanding('No glossary word here.', 'original'))
      .toEqual([{ text: 'No glossary word here.' }]);
    expect(splitFirstStanding('', 'original')).toEqual([{ text: '' }]);
  });
});


describe('glossary collection integration (#1991)', () => {
  it('uses the same two definitions for inline and ledger disclosures', () => {
    expect(glossaryDefinition('standing', 'original')).toBe('the regard the wider world gives the house.');
    expect(glossaryDefinition('standing', 'plainenglish')).toBe('How the wider world regards this family.');
    expect(glossaryDefinition('missing')).toBeUndefined();
  });
  it('matches the earliest alias from authored data in either reading mode', () => {
    const source = 'Reputation, then Standing.';
    for (const mode of ['original', 'plainenglish'] as const) {
      const pieces = splitFirstGlossary(source, mode);
      expect(pieces.map(p => p.text).join('')).toBe(source);
      expect(pieces.filter(p => p.term)).toEqual([{ text: 'Reputation', term: 'standing' }]);
    }
  });
});
