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
    expect(splitFirstStanding('Standing and Reputation.', 'plainenglish')).toEqual([
      { text: 'Standing and ' },
      { text: 'Reputation', term: 'standing' },
      { text: '.' },
    ]);
    expect(standingGlossaryDefinition('plainenglish')).toBe('How the wider world regards this family.');
  });

  it('never marks an embedded or semantically unrelated lowercase word', () => {
    expect(splitFirstStanding('outStanding Standingé Standing2 Standing_name standing preference', 'original'))
      .toEqual([{ text: 'outStanding Standingé Standing2 Standing_name standing preference' }]);
    expect(splitFirstStanding('Reputational reputation', 'plainenglish'))
      .toEqual([{ text: 'Reputational reputation' }]);
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
