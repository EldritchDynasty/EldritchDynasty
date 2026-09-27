import { describe, expect, it } from 'vitest';
import type { ChronicleCause, ChronicleEntry } from '@ed/core';
import { answeredLabel, causeLink, linksFor } from './causes';

/**
 * THE WAY BACK NAMES A YEAR AND NOTHING ELSE (issue #269, §29 rule 1).
 *
 * Bearing is never named. A link that carried a weight, a count or a time to
 * bill would hand the reader the mechanism the design hides, so the one thing
 * worth asserting about these labels is that every number in them is a year.
 */
const digitsAreYears = (label: string, years: number[]) =>
  (label.match(/\d+/g) ?? []).every((d) => years.includes(Number(d)));

describe('a link back to the act', () => {
  it('points at the page when the book wrote one', () => {
    const link = causeLink({ year: 1042, page: 'chr_7', blank: false });
    expect(link).toEqual({ kind: 'see', page: 'chr_7', label: 'see 1042' });
  });

  it('says the book has no page, rather than inventing one', () => {
    // A Match or a withheld daughter: the house did it and never wrote it down.
    const link = causeLink({ year: 1042, blank: false });
    expect(link.kind).toBe('unwritten');
    expect(link.label).toBe('1042; the book has no page for it');
  });

  it('reaches an omitted page as a link like any other, carrying no words of it', () => {
    const link = causeLink({ year: 1042, page: 'chr_blank', blank: true });
    expect(link).toEqual({ kind: 'see', page: 'chr_blank', label: 'see 1042' });
  });

  it('lists the years that answered a page, in the book\'s own order', () => {
    expect(answeredLabel([])).toBeNull();
    expect(answeredLabel([1067])).toBe('answered in 1067');
    expect(answeredLabel([1067, 1092])).toBe('answered in 1067 and 1092');
    expect(answeredLabel([1067, 1080, 1092])).toBe('answered in 1067, 1080 and 1092');
  });

  it('carries no digit in any label but a year', () => {
    const causes: ChronicleCause[] = [
      { year: 1042, page: 'chr_12', blank: false },
      { year: 1103, blank: false },
      { year: 1250, page: 'chr_99', blank: true },
    ];
    for (const c of causes) expect(digitsAreYears(causeLink(c).label, [c.year]), causeLink(c).label).toBe(true);
    const years = [1067, 1080, 1092];
    expect(digitsAreYears(answeredLabel(years)!, years)).toBe(true);
  });
});

describe('links for what is drawn', () => {
  const page = (id: string, year: number): ChronicleEntry =>
    ({ id, year, weight: 'line', text: 'x', named: false }) as ChronicleEntry;

  it('asks the engine only about the pages being drawn, and keeps only pages with a link', () => {
    const asked: string[] = [];
    const reads = {
      causeOf: (id: string) => { asked.push(id); return id === 'b' ? { year: 1042, page: 'a', blank: false } : undefined; },
      answeredBy: (id: string) => (id === 'a' ? [1067] : []),
    };
    const links = linksFor([page('a', 1042), page('b', 1067), page('c', 1070)], reads);

    expect(asked).toEqual(['a', 'b', 'c']);
    expect([...links.keys()]).toEqual(['a', 'b']);
    expect(links.get('a')).toEqual({ answered: [1067] });
    expect(links.get('b')?.cause?.page).toBe('a');
  });
});
