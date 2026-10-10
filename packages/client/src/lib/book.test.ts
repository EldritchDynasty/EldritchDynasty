import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChronicleEntry } from '@ed/core';
import { DOWNLOAD_URL_GRACE_MS, downloadBlob } from './download.js';
import {
  afterimageLayout, afterimageModel, afterimageName, afterimageQuote,
  ageBoundariesForPages, plateHeight, plateName, plateRows, plateSpan, plateSubtitle, reads, wrap,
  type Measure,
} from './book.js';

/**
 * READING AND PLATING THE BOOK (issue #69).
 *
 * `VIEW_CHRONICLE_LINES = 60` has always been commented "the whole book is a
 * separate read", and the separate read was never built: the client drew the
 * last sixty entries of a book that ran to 3,576. The acceptance is that any
 * entry is reachable in under three interactions and that one click produces
 * something a person would post.
 *
 * The pane cannot be asserted; these are the parts of it that can.
 */
function entry(over: Partial<ChronicleEntry> = {}): ChronicleEntry {
  return {
    year: 1200, weight: 'paragraph', text: 'A thing happened.', named: false, ...over,
  } as ChronicleEntry;
}

/** A stand-in for `measureText`: monospace, six pixels a character. */
const monospace: Measure = (text) => text.length * 6;

describe('what the reader asked for', () => {
  const all = { lens: 'all' as const, from: null, find: '' };

  it('takes everything when nothing is asked', () => {
    expect(reads(entry(), all)).toBe(true);
  });

  it('lenses the blanks, the improvements and the illuminations apart', () => {
    const blank = entry({ text: null });
    const improved = entry({ record: 'embellish' });
    const lit = entry({ weight: 'illuminated' });

    expect(reads(blank, { ...all, lens: 'blank' })).toBe(true);
    expect(reads(improved, { ...all, lens: 'blank' })).toBe(false);
    expect(reads(improved, { ...all, lens: 'improved' })).toBe(true);
    expect(reads(lit, { ...all, lens: 'improved' })).toBe(false);
    expect(reads(lit, { ...all, lens: 'illuminated' })).toBe(true);
    expect(reads(blank, { ...all, lens: 'illuminated' })).toBe(false);
  });

  it('finds a name in the body and in the title', () => {
    expect(reads(entry({ text: 'Wystan took the east rooms.' }), { ...all, find: 'wystan' })).toBe(true);
    expect(reads(entry({ title: 'The Drowning', text: 'It rained.' }), { ...all, find: 'drowning' })).toBe(true);
    expect(reads(entry({ text: 'Somebody else entirely.' }), { ...all, find: 'wystan' })).toBe(false);
  });

  /**
   * The century buttons are the year control. A search that quietly matched
   * the year too would make the two impossible to tell apart — typing `12`
   * would hand back the whole twelfth century as though it had matched a word.
   */
  it('never matches the year', () => {
    expect(reads(entry({ year: 1204, text: 'Nothing numeric.' }), { ...all, find: '1204' })).toBe(false);
  });

  it('ands the lens with the search, because "the blanks, about Wystan" is a question', () => {
    const blankAboutHim = entry({ text: null, title: 'Wystan' });
    const writtenAboutHim = entry({ text: 'Wystan did something.' });

    expect(reads(blankAboutHim, { lens: 'blank', from: null, find: 'wystan' })).toBe(true);
    expect(reads(writtenAboutHim, { lens: 'blank', from: null, find: 'wystan' })).toBe(false);
  });

  it('draws nothing before the century jumped to', () => {
    expect(reads(entry({ year: 1099 }), { ...all, from: 1100 })).toBe(false);
    expect(reads(entry({ year: 1100 }), { ...all, from: 1100 })).toBe(true);
  });
});


describe('placing Age boundaries in a sparse Chronicle (#1017)', () => {
  const pages = (years: number[]) => years.map((year) => entry({ year }));

  it('places a 1210 Age before the 1212 page, never relabeling it 1212', () => {
    expect(ageBoundariesForPages(pages([1208, 1212]), [
      { began: 1210, name: 'The Long Winter' },
    ], null)).toEqual(new Map([[1, [{ began: 1210, name: 'The Long Winter' }]]]));
  });

  it('keeps multiple intervening Ages in chronological order, including unnamed ones', () => {
    expect(ageBoundariesForPages(pages([1208, 1212]), [
      { began: 1211, name: null },
      { began: 1209, name: 'The Long Winter' },
    ], null)).toEqual(new Map([[1, [
      { began: 1209, name: 'The Long Winter' },
      { began: 1211, name: null },
    ]]]));
  });

  it('keeps the boundary when search or a lens hides its exact starting year', () => {
    const book = [
      entry({ year: 1209, text: null }),
      entry({ year: 1210, text: 'Hidden by the blank lens' }),
      entry({ year: 1212, text: null }),
    ];
    const visible = book.filter((e) => reads(e, { lens: 'blank', from: null, find: '' }));
    expect(visible.map((e) => e.year)).toEqual([1209, 1212]);
    expect(ageBoundariesForPages(visible, [{ began: 1210, name: 'The Age' }], null))
      .toEqual(new Map([[1, [{ began: 1210, name: 'The Age' }]]]));
    const search = book.filter((e) => reads(e, { lens: 'all', from: null, find: 'Hidden' }));
    expect(ageBoundariesForPages(search, [{ began: 1209, name: null }], null))
      .toEqual(new Map([[0, [{ began: 1209, name: null }]]]));
  });

  it('draws once before the first page of a shared year, never once per page', () => {
    const first = ageBoundariesForPages(pages([1209, 1210, 1210, 1212]), [
      { began: 1210, name: 'The Age' },
    ], null);
    expect([...first.keys()]).toEqual([1]);
    expect(first.get(2)).toBeUndefined();
  });

  it('does not reintroduce an Age before the selected century or shift when pages grow', () => {
    const ages = [
      { began: 1199, name: 'Earlier' },
      { began: 1210, name: 'Within the window' },
      { began: 1250, name: 'Later' },
    ];
    const short = pages([1208, 1212]);
    const first = ageBoundariesForPages(short, ages, 1200);
    expect(first).toEqual(new Map([[1, [{ began: 1210, name: 'Within the window' }]]]));
    const extended = ageBoundariesForPages([...short, ...pages([1251, 1260])], ages, 1200);
    expect(extended.get(1)).toEqual(first.get(1));
    expect(extended.get(2)).toEqual([{ began: 1250, name: 'Later' }]);
    expect(ageBoundariesForPages(pages([1208]), ages, 1200).size).toBe(0);
  });
});

describe('wrapping', () => {
  it('breaks at the column and keeps every word', () => {
    const rows = wrap('one two three four five', 'x', 60, monospace);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.join(' ')).toBe('one two three four five');
  });

  it('does not drop a word wider than the column', () => {
    expect(wrap('supercalifragilistic', 'x', 12, monospace)).toEqual(['supercalifragilistic']);
  });

  it('says nothing about nothing', () => {
    expect(wrap('', 'x', 100, monospace)).toEqual([]);
  });
});

describe('the plate', () => {
  /**
   * THE ARTEFACT. §6: omitted entries "print as a dated blank line with no
   * text. Players will screenshot the blanks." A plate that skipped them —
   * which is what any naive DOM-to-image pass does, since the blank is an
   * empty paragraph — would export the one thing the player did NOT choose
   * and drop the thing they did.
   */
  it('draws an omission as a dated rule with no words', () => {
    const rows = plateRows([entry({ year: 1204, text: null, title: 'Never Written' })], monospace);

    expect(rows[0]!.text, 'the blank lost its date').toBe('1204');
    const ruled = rows.filter((r) => r.rule);
    expect(ruled).toHaveLength(1);
    expect(ruled[0]!.text).toBe('');
    // And the title it would have had is not smuggled back in.
    expect(rows.some((r) => r.text === 'Never Written')).toBe(false);
  });

  it('gives an illuminated entry the rubric and the largest hand', () => {
    const lit = plateRows([entry({ weight: 'illuminated', title: 'The Crossing' })], monospace);
    const plain = plateRows([entry({ weight: 'line', title: 'A Tuesday' })], monospace);

    const head = (rows: ReturnType<typeof plateRows>) => rows.find((r) => r.size > 12)!;
    expect(head(lit).size).toBeGreaterThan(head(plain).size);
    expect(head(lit).colour).not.toBe(head(plain).colour);
  });

  it('sets an improvement in italic, because the house is telling it', () => {
    const rows = plateRows([entry({ record: 'embellish' })], monospace);
    expect(rows.some((r) => r.italic)).toBe(true);
  });

  it('grows the page to fit the book rather than clipping it', () => {
    const one = plateHeight(plateRows([entry()], monospace));
    const many = plateHeight(plateRows(Array.from({ length: 40 }, () => entry()), monospace));
    expect(many).toBeGreaterThan(one);
    // A page with nothing on it is still a page, not a zero-height canvas.
    expect(plateHeight([])).toBeGreaterThan(100);
  });

  it('says what it is a plate of', () => {
    const two = [entry({ year: 1100 }), entry({ year: 1400 })];
    expect(plateSpan(two)).toBe('1100–1400');
    expect(plateSubtitle(two, 'blank')).toContain('2 entries');
    expect(plateSubtitle(two, 'blank')).toContain('left blank');
    expect(plateSubtitle([], 'all')).toContain('nothing yet');
  });

  it('names the file after the house and the years', () => {
    expect(plateName('The House of Salt', [entry({ year: 1042 }), entry({ year: 1542 })]))
      .toBe('the-house-of-salt-1042-1542.png');
    expect(plateName('李 家族', [entry({ year: 1042 }), entry({ year: 1542 })]))
      .toBe('李-家族-1042-1542.png');
    expect(plateName('Élodie家 👑', [entry()]))
      .toBe('élodie家-1200-1200.png');
    // A house whose name is all punctuation still produces a filename.
    expect(plateName('!!!', [entry()])).toBe('the-house-1200-1200.png');
  });
});


describe('the house afterimage (#260)', () => {
  const source = {
    houseName: 'House Vey',
    campaignName: 'A Long Line',
    seed: 1042,
    year: 1542,
    endingTitle: 'The House That Endured',
    endingSummary: 'The creditor closed the book and left the seal where it lay.',
    reckoning: {
      pages: 71,
      blanks: 8,
      embellished: 11,
      standingLies: 4,
      provenLies: 2,
      clauses: 7,
      clausesTotal: 9,
      attestedTitle: 'the Fourth Rung',
      livingBlood: 13,
    },
    read: [
      entry({ year: 1301, text: 'An ordinary remembered line.' }),
      entry({ year: 1414, weight: 'illuminated', title: 'The Winter Hand', text: 'Wystan refused the winter hand.' }),
      entry({ year: 1508, record: 'embellish', text: 'A later, smaller improvement.' }),
    ],
  };

  it('is deterministic and changes when the finished account changes', () => {
    const first = afterimageModel(source);
    expect(afterimageModel(source)).toEqual(first);

    const altered = afterimageModel({
      ...source,
      endingTitle: 'The Broken Line',
      reckoning: { ...source.reckoning, livingBlood: 0 },
    });
    expect(altered).not.toEqual(first);
    expect(first.facts.some((fact) => fact.label === 'Of the blood, living' && fact.value === '13')).toBe(true);
  });

  it('quotes the newest illuminated page before a later ordinary line', () => {
    expect(afterimageQuote(source.read)).toEqual({
      year: 1414,
      title: 'The Winter Hand',
      text: 'Wystan refused the winter hand.',
    });
  });

  it('falls back to the newest written line and never reconstructs a blank', () => {
    expect(afterimageQuote([
      entry({ year: 1400, text: 'Earlier.' }),
      entry({ year: 1401, text: null, title: 'Omitted on purpose' }),
      entry({ year: 1402, text: 'Later.' }),
    ])?.text).toBe('Later.');

    expect(afterimageQuote([
      entry({ year: 1401, text: null, title: 'Omitted on purpose' }),
    ])).toBeUndefined();
  });

  it('changes the card when the selected Chronicle line changes', () => {
    const first = afterimageModel(source);
    const changed = afterimageModel({
      ...source,
      read: source.read.map((e, i) => i === 1
        ? { ...e, text: 'Wystan accepted the winter hand.' }
        : e),
    });

    expect(changed.quote).not.toEqual(first.quote);
    expect(changed).not.toEqual(first);
  });

  it('lays out wrapped copy before the canvas is allocated', () => {
    const model = afterimageModel(source);
    const short = afterimageLayout(model, monospace);
    const long = afterimageLayout({
      ...model,
      summary: Array.from({ length: 80 }, () => 'remembered').join(' '),
      quote: model.quote
        ? { ...model.quote, text: Array.from({ length: 90 }, () => 'winter').join(' ') }
        : undefined,
    }, monospace);

    expect(short.endingLines.join(' ')).toBe(model.endingTitle);
    expect(long.summaryLines.length).toBeGreaterThan(short.summaryLines.length);
    expect(long.quoteLines.length).toBeGreaterThan(short.quoteLines.length);
    expect(long.height).toBeGreaterThan(short.height);
  });

  it('keeps the card factual rather than grading the run', () => {
    const model = afterimageModel(source);
    const labels = model.facts.map((fact) => fact.label.toLowerCase()).join(' ');
    expect(labels).not.toMatch(/score|grade|rating|best/);
    expect(model.endingTitle).toBe(source.endingTitle);
  });

  it('names the image after the house, term and seed', () => {
    expect(afterimageName('House of Salt', 8080, 1542))
      .toBe('house-of-salt-1542-seed-8080-afterimage.png');
    expect(afterimageName('李 家族', 8080, 1542))
      .toBe('李-家族-1542-seed-8080-afterimage.png');
    expect(afterimageName('Élodie家 👑', 8080, 1542))
      .toBe('élodie家-1542-seed-8080-afterimage.png');
    expect(afterimageName('!!!', 7, 1242))
      .toBe('the-house-1242-seed-7-afterimage.png');
  });
});

// Download lifecycle assertions share this measured Book/Afterimage suite.

function downloadFixture() {
  const events: string[] = [];
  const link = {
    href: '',
    download: '',
    hidden: false,
    click: vi.fn(() => { events.push('click'); }),
    remove: vi.fn(() => { events.push('remove'); }),
  };
  const appendChild = vi.fn(() => { events.push('append'); });
  const createElement = vi.fn(() => link);
  const createObjectURL = vi.fn(() => 'blob:test-image');
  const revokeObjectURL = vi.fn(() => { events.push('revoke'); });
  vi.stubGlobal('document', { createElement, body: { appendChild } });
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  vi.useFakeTimers();
  return { events, link, appendChild, createElement, createObjectURL, revokeObjectURL };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('browser Blob downloads', () => {
  it('clicks an attached link while the URL is valid, then releases it after a grace period', () => {
    const f = downloadFixture();
    const blob = new Blob(['plate'], { type: 'image/png' });
    downloadBlob(blob, 'house-afterimage.png');

    expect(f.createObjectURL).toHaveBeenCalledWith(blob);
    expect(f.createElement).toHaveBeenCalledWith('a');
    expect(f.link.href).toBe('blob:test-image');
    expect(f.link.download).toBe('house-afterimage.png');
    expect(f.link.hidden).toBe(true);
    expect(f.appendChild).toHaveBeenCalledWith(f.link);
    expect(f.events).toEqual(['append', 'click', 'remove']);
    expect(f.revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(DOWNLOAD_URL_GRACE_MS - 1);
    expect(f.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(f.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:test-image');
    expect(f.events).toEqual(['append', 'click', 'remove', 'revoke']);
  });

  it('cleans up the link and eventually releases the URL if clicking fails', () => {
    const f = downloadFixture();
    f.link.click.mockImplementationOnce(() => { throw new Error('blocked download'); });

    expect(() => downloadBlob(new Blob(['plate']), 'chronicle.png')).toThrow('blocked download');
    expect(f.link.remove).toHaveBeenCalledOnce();
    expect(f.revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(f.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:test-image');
  });
});
