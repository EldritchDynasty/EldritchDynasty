import { describe, expect, it } from 'vitest';
import { glossaryDefinition, splitFirstGlossary, splitFirstStanding, standingGlossaryDefinition } from './glossary.js';
import { loadBundle } from './content.js';

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

  it('skips aliases joined by the legacy zero-width no-break space (#2535)', () => {
    // U+FEFF was formerly used as ZERO WIDTH NO-BREAK SPACE. Like U+2060,
    // it does not separate a word even though it is not a Unicode letter.
    const noBreak = '\uFEFF';
    for (const mode of ['original', 'plainenglish'] as const) {
      for (const alias of ['Standing', 'Reputation']) {
        for (const text of [`house${noBreak}${alias}`, `${alias}${noBreak}house`]) {
          expect(splitFirstGlossary(text, mode)).toEqual([{ text }]);
        }
      }
      // A joined use must not consume the one glossary link permitted here.
      const text = `house${noBreak}Standing Standing`;
      const pieces = splitFirstGlossary(text, mode);
      expect(pieces).toEqual([
        { text: `house${noBreak}Standing ` },
        { text: 'Standing', term: 'standing' },
      ]);
      expect(pieces.map(piece => piece.text).join('')).toBe(text);
    }
  });

  it('keeps soft-hyphenated words from disclosing embedded aliases (#2542)', () => {
    // U+00AD is an optional hyphenation opportunity inside one word. It must
    // not make an embedded alias a new, independently clickable glossary term.
    const softHyphen = '\u00AD';
    for (const mode of ['original', 'plainenglish'] as const) {
      for (const alias of ['Standing', 'Reputation']) {
        for (const text of [`house${softHyphen}${alias}`, `${alias}${softHyphen}house`]) {
          expect(splitFirstGlossary(text, mode)).toEqual([{ text }]);
        }
      }

      // Reject the connected occurrence without losing the next real alias.
      const text = `house${softHyphen}Standing Standing`;
      const segments = splitFirstGlossary(text, mode);
      expect(segments).toEqual([
        { text: `house${softHyphen}Standing ` },
        { text: 'Standing', term: 'standing' },
      ]);
      expect(segments.map(segment => segment.text).join('')).toBe(text);
    }
  });

  it('keeps Mongolian vowel separator within words instead of disclosing an embedded alias (#2585)', () => {
    // U+180E is a format control between parts of the same Mongolian word,
    // not whitespace announcing a new standalone English label.
    const separator = '\u180E';
    for (const mode of ['original', 'plainenglish'] as const) {
      for (const alias of ['Standing', 'Reputation']) {
        for (const text of [`house${separator}${alias}`, `${alias}${separator}house`]) {
          expect(splitFirstGlossary(text, mode)).toEqual([{ text }]);
        }
      }

      // The ignored embedded match must not consume the next valid link.
      const text = `house${separator}Standing Standing`;
      const segments = splitFirstGlossary(text, mode);
      expect(segments).toEqual([
        { text: `house${separator}Standing ` },
        { text: 'Standing', term: 'standing' },
      ]);
      expect(segments.map(segment => segment.text).join('')).toBe(text);
    }
  });
  it('keeps WORD JOINER-attached aliases out of standalone glossary disclosures', () => {
    // U+2060 explicitly prevents a word break, despite its Unicode Cf category.
    // Without this boundary check, a joined word receives an intrusive button.
    const joiner = '\u2060';
    for (const mode of ['original', 'plainenglish'] as const) {
      for (const alias of ['Standing', 'Reputation']) {
        for (const text of [`house${joiner}${alias}`, `${alias}${joiner}house`]) {
          expect(splitFirstGlossary(text, mode)).toEqual([{ text }]);
        }
      }
      // Skipping a joined occurrence must still expose the first real label.
      const text = `house${joiner}Standing Standing`;
      const pieces = splitFirstGlossary(text, mode);
      expect(pieces).toEqual([
        { text: `house${joiner}Standing ` },
        { text: 'Standing', term: 'standing' },
      ]);
      expect(pieces.map(piece => piece.text).join('')).toBe(text);
    }
  });

  it('does not disclose aliases joined to a word by Unicode connector punctuation', () => {
    // Pc includes more than ASCII underscore. The undertie, character tie,
    // wavy low line and fullwidth low line must have identical boundaries.
    for (const mode of ['original', 'plainenglish'] as const) {
      for (const connector of ['\u203F', '\u2040', '\uFE4F', '\uFF3F']) {
        for (const alias of ['Standing', 'Reputation']) {
          for (const text of [`word${connector}${alias}`, `${alias}${connector}word`]) {
            expect(splitFirstGlossary(text, mode)).toEqual([{ text }]);
          }
        }

        // A rejected embedded occurrence must not hide a later real term.
        const text = `word${connector}Standing Standing`;
        const pieces = splitFirstGlossary(text, mode);
        expect(pieces).toEqual([
          { text: `word${connector}Standing ` },
          { text: 'Standing', term: 'standing' },
        ]);
        expect(pieces.map(piece => piece.text).join('')).toBe(text);
      }
    }
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

describe('Discrepancy as public glossary vocabulary (#2603)', () => {
  it('matches saved terms in either register without changing or repeating the Chronicle text', () => {
    for (const mode of ['original', 'plainenglish'] as const) {
      const source = 'Discrepancy challenged Standing. Discrepancies remain.';
      const pieces = splitFirstGlossary(source, mode);
      expect(pieces).toEqual([
        { text: 'Discrepancy', term: 'discrepancy' },
        { text: ' challenged Standing. Discrepancies remain.' },
      ]);
      expect(pieces.map(piece => piece.text).join('')).toBe(source);
    }
  });

  it('recognizes the Plain English label and does not disclose embedded aliases', () => {
    expect(splitFirstGlossary('Disputed account challenged the Record.', 'plainenglish')).toEqual([
      { text: 'Disputed account', term: 'discrepancy' },
      { text: ' challenged the Record.' },
    ]);
    expect(splitFirstGlossary('PreDiscrepancy Discrepancies.', 'original')).toEqual([
      { text: 'PreDiscrepancy ' },
      { text: 'Discrepancies', term: 'discrepancy' },
      { text: '.' },
    ]);
    expect(glossaryDefinition('discrepancy', 'original'))
      .toBe("a claim in the house's Record challenged by another account or surviving proof.");
    expect(glossaryDefinition('discrepancy', 'plainenglish'))
      .toBe('When another account or piece of evidence disputes what the family wrote down.');
  });
});


describe('Ledger and clause public glossary vocabulary (#2611)', () => {
  it('explains the Ledger without revealing an unrecovered clause', () => {
    expect(glossaryDefinition('ledger', 'original'))
      .toBe("the house's account of its founding bargain, recovered a clause at a time.");
    expect(glossaryDefinition('ledger', 'plainenglish'))
      .toBe('The agreement that binds the family. Its terms become known as you uncover them.');
    for (const mode of ['original', 'plainenglish'] as const) {
      const source = 'The Ledger has changed. The Ledger remains.';
      const segments = splitFirstGlossary(source, mode);
      expect(segments).toEqual([
        { text: 'The ' },
        { text: 'Ledger', term: 'ledger' },
        { text: ' has changed. The Ledger remains.' },
      ]);
      expect(segments.map(segment => segment.text).join('')).toBe(source);
    }
  });

  it('uses the longest authored alias for Ledger clause(s), then leaves all later words intact', () => {
    for (const mode of ['original', 'plainenglish'] as const) {
      for (const phrase of ['Ledger clause', 'Ledger clauses']) {
        const source = `${phrase} were recovered. Another clause was read.`;
        const segments = splitFirstGlossary(source, mode);
        // The entire contract-term label should link to its own explanation,
        // rather than splitting off the overlapping, shorter 'Ledger' alias.
        expect(segments).toEqual([
          { text: phrase, term: 'clause' },
          { text: ' were recovered. Another clause was read.' },
        ]);
        expect(segments.map(segment => segment.text).join('')).toBe(source);
      }
      expect(splitFirstGlossary('PreLedger Ledger', mode)).toEqual([
        { text: 'PreLedger ' },
        { text: 'Ledger', term: 'ledger' },
      ]);
    }
  });

  it('recognizes both current and saved labels in Plain English without rewording saved prose', () => {
    expect(splitFirstGlossary('Contract terms were found.', 'plainenglish')).toEqual([
      { text: 'Contract terms', term: 'clause' },
      { text: ' were found.' },
    ]);
    expect(splitFirstGlossary('A clause was recorded.', 'original')).toEqual([
      { text: 'A ' },
      { text: 'clause', term: 'clause' },
      { text: ' was recorded.' },
    ]);
    expect(glossaryDefinition('clause', 'original'))
      .toBe("one term of the house's founding bargain, entered in the Record when recovered.");
    expect(glossaryDefinition('clause', 'plainenglish'))
      .toBe("One part of the family's agreement, recorded when the family discovers it.");
  });

  it('links Ledger and clause without adding new mechanics or unvalidated references', () => {
    const terms = loadBundle().glossary;
    expect(terms.find(term => term.id === 'ledger')?.related).toEqual(['clause']);
    expect(terms.find(term => term.id === 'clause')?.related).toEqual(['ledger']);
    for (const id of ['ledger', 'clause']) {
      const term = terms.find(entry => entry.id === id)!;
      expect(term.aliases.original).toContain(term.names.original);
      expect(term.aliases.plainenglish).toContain(term.names.plainenglish);
    }
  });
});


describe('six public rule terms extend the existing glossary (#2808)', () => {
  const expected = [
    { id: 'regency', label: 'Regency', related: ['cadet_hall', 'expresser'] },
    { id: 'cadet_hall', label: 'cadet hall', related: ['regency'] },
    { id: 'muster', label: 'Muster', related: ['cadet_hall'] },
    { id: 'threshold_affinity', label: 'Threshold Arts', related: [] },
    { id: 'expresser', label: 'expressers', related: ['vessel'] },
    { id: 'vessel', label: 'the Vessel', related: ['expresser'] },
  ] as const;

  it('retains every saved character and marks only the first occurrence in both prose modes', () => {
    for (const mode of ['original', 'plainenglish'] as const) {
      for (const { id, label } of expected) {
        const source = `Before ${label}, after ${label}.`;
        const pieces = splitFirstGlossary(source, mode);
        expect(pieces).toEqual([
          { text: 'Before ' },
          { text: label, term: id },
          { text: `, after ${label}.` },
        ]);
        expect(pieces.map(piece => piece.text).join('')).toBe(source);
      }
    }
  });

  it('uses the longest standalone term and avoids word-internal matches', () => {
    for (const mode of ['original', 'plainenglish'] as const) {
      expect(splitFirstGlossary('the Muster was called', mode)[0])
        .toEqual({ text: 'the Muster', term: 'muster' });
      expect(splitFirstGlossary('the Vessel was named', mode)[0])
        .toEqual({ text: 'the Vessel', term: 'vessel' });
      expect(splitFirstGlossary('Threshold affinities', mode)[0])
        .toEqual({ text: 'Threshold affinities', term: 'threshold_affinity' });
      for (const source of [
        'preRegency', 'regencyhouse', 'preMuster', 'Mustered',
        'cadethall', 'expresserhood', 'preVessel', 'Vessels',
        'preThreshold Artsmanship',
      ]) {
        expect(splitFirstGlossary(source, mode)).toEqual([{ text: source }]);
      }
    }
  });

  it('matches new Plain English labels while retaining saved Original terminology', () => {
    expect(splitFirstGlossary('A branch household persists.', 'plainenglish')).toEqual([
      { text: 'A ' }, { text: 'branch household', term: 'cadet_hall' }, { text: ' persists.' },
    ]);
    expect(splitFirstGlossary('Threshold magic was studied.', 'plainenglish')).toEqual([
      { text: 'Threshold magic', term: 'threshold_affinity' }, { text: ' was studied.' },
    ]);
    expect(splitFirstGlossary('A cadet branch persists.', 'plainenglish')).toEqual([
      { text: 'A ' }, { text: 'cadet branch', term: 'cadet_hall' }, { text: ' persists.' },
    ]);
    expect(splitFirstGlossary('A cadet hall persists.', 'original')).toEqual([
      { text: 'A ' }, { text: 'cadet hall', term: 'cadet_hall' }, { text: ' persists.' },
    ]);
  });

  it('uses authored definitions, stable related ids and labels in both registers', () => {
    const glossary = loadBundle().glossary;
    for (const { id, related } of expected) {
      const term = glossary.find(entry => entry.id === id);
      expect(term).toBeDefined();
      expect(term?.related).toEqual([...related]);
      for (const mode of ['original', 'plainenglish'] as const) {
        expect(glossaryDefinition(id, mode)).toBe(term?.definition[mode]);
        expect(term?.definition[mode].length).toBeGreaterThan(35);
        expect(term?.aliases[mode]).toContain(term?.names[mode]);
      }
      for (const other of related) expect(glossary.some(entry => entry.id === other)).toBe(true);
    }
    expect(glossaryDefinition('regency', 'plainenglish'))
      .toContain('A woman of the family holds the seat');
    expect(glossaryDefinition('threshold_affinity', 'plainenglish'))
      .toContain('book-learned magic');
    expect(glossaryDefinition('vessel', 'original'))
      .toContain('beyond Hierophant');
  });
});
