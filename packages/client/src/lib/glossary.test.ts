import { describe, expect, it } from 'vitest';
import { splitFirstStanding, standingGlossaryDefinition } from './glossary.js';

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
