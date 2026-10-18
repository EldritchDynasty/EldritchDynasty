import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChronicleEntry } from '@ed/core';
import type { MemberView } from './kin';
import { DOWNLOAD_URL_GRACE_MS, downloadBlob } from './download.js';
import {
  afterimageLayout, afterimageModel, afterimageName, afterimageQuote,
  ageBoundariesForPages, MAX_PLATE_CANVAS_HEIGHT, plateHeight, plateName, plateRows, plateSpan, plateSubtitle, plateSvg, reads, wrap,
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

  it('keeps explicit line breaks and empty paragraphs in exported Chronicle plates (#1521)', () => {
    expect(wrap('First line\nSecond line', 'x', 200, monospace))
      .toEqual(['First line', 'Second line']);
    expect(wrap('First\r\n\r\nSecond', 'x', 200, monospace))
      .toEqual(['First', '', 'Second']);
    expect(wrap('First\rSecond', 'x', 200, monospace))
      .toEqual(['First', 'Second']);
    expect(wrap('First\n', 'x', 200, monospace)).toEqual(['First', '']);

    // The same rows drive both the PNG renderer and the SVG fallback.
    const rows = plateRows([entry({ text: 'First\n\nSecond' })], monospace);
    expect(rows.map((row) => row.text)).toEqual(['1200', 'First', '', 'Second']);
    const svg = plateSvg(rows, 'House', 'A chronicle');
    expect(svg).toContain('>First</text>');
    expect(svg).toContain('>Second</text>');
    expect(svg.indexOf('>First</text>')).toBeLessThan(svg.indexOf('>Second</text>'));
  });

  it('splits oversized unbroken tokens so a Chronicle plate does not clip them (#1166)', () => {
    const word = 'supercalifragilistic';
    const rows = wrap(word, 'x', 12, monospace);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every((row) => monospace(row, 'x') <= 12)).toBe(true);
    expect(rows.join('')).toBe(word);
    expect(wrap('書院圖譜', 'x', 12, monospace)).toEqual(['書院', '圖譜']);
  });

  it('preserves joined emoji and combining characters when wrapping', () => {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const graphemeWidth: Measure = (text) => [...segmenter.segment(text)].length * 6;
    expect(wrap('a👩‍🔬b', 'x', 12, graphemeWidth)).toEqual(['a👩‍🔬', 'b']);
    expect(wrap('x' + 'e\u0301' + 'y', 'x', 12, graphemeWidth)).toEqual(['xe\u0301', 'y']);

    // If one whole glyph is wider than the column, emit it rather than
    // splitting the glyph or spinning forever.
    expect(wrap('👩‍🔬a', 'x', 5, graphemeWidth)).toEqual(['👩‍🔬', 'a']);
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
    expect(plateSubtitle([entry({ year: 1100 })], 'all'))
      .toBe('1 entry · 1100–1100 · the whole book');
    expect(plateSubtitle(two, 'blank')).toContain('2 entries');
    expect(plateSubtitle(two, 'blank')).toContain('left blank');
    expect(plateSubtitle([], 'all')).toContain('nothing yet');
  });

  it('uses the same Plain English lens names in image subtitles as in the reader controls (#1706)', () => {
    const items = [entry({ year: 1100 }), entry({ year: 1400 })];
    const labels = {
      all: 'all entries',
      blank: 'blank entries',
      improved: 'changed entries',
      illuminated: 'highlighted entries',
    } as const;
    for (const lens of Object.keys(labels) as Array<keyof typeof labels>) {
      const plain = plateSubtitle(items, lens, 'plainenglish');
      expect(plain).toBe(`2 entries · 1100–1400 · ${labels[lens]}`);
      expect(plateSubtitle(items, lens, 'original'))
        .toBe(plateSubtitle(items, lens));
      const svg = plateSvg(plateRows(items, monospace), 'House', plain);
      expect(svg).toContain(plain);
    }
    expect(plateSubtitle([], 'all', 'plainenglish')).toBe('no entries yet · all entries');
    expect(plateSubtitle([], 'all')).toBe('nothing yet · the whole book');
    expect(plateName('House', items)).toBe('house-1100-1400.png');
  });

  it('passes one snapshot of the current image caption to PNG and SVG export paths (#1706)', () => {
    const source = readFileSync(join(import.meta.dirname, '../components/Book.vue'), 'utf8');
    expect(source).toContain('const plateCaption = plateSubtitle(entries, lens.value, props.proseMode);');
    expect(source).toContain('plateSvg(rows, houseName, plateCaption)');
    expect(source).toContain('c.fillText(plateCaption, PLATE.pad, 88)');
    expect(source).not.toContain('plateSubtitle(entries, lens.value)');
    expect(source).toContain('PLAIN_LENS_LABELS[l.id]');
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



describe('full Chronicle plate export beyond canvas limits (#1062)', () => {
  it('recognises a complete Long-Line book cannot safely be one bitmap', () => {
    const longBook = Array.from({ length: 700 }, (_, i) =>
      entry({ year: 1042 + Math.floor(i / 2), text: 'Recorded line ' + i }));
    const rows = plateRows(longBook, monospace);
    expect(plateHeight(rows)).toBeGreaterThan(MAX_PLATE_CANVAS_HEIGHT);
    expect(1200 * MAX_PLATE_CANVAS_HEIGHT).toBeLessThan(16_000_000);
  });

  it('puts all pages in a vector export and uses identical page height', () => {
    const book = Array.from({ length: 220 }, (_, i) =>
      entry({ year: 1100 + i, text: 'PageMarker' + String(i).padStart(3, '0') }));
    const rows = plateRows(book, monospace);
    expect(plateHeight(rows)).toBeGreaterThan(MAX_PLATE_CANVAS_HEIGHT);
    const svg = plateSvg(rows, 'House of Salt', plateSubtitle(book, 'all'));

    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('width="1200" height="' + plateHeight(rows) + '"');
    expect(svg).toContain('House of Salt');
    expect(svg).toContain('220 entries');
    expect(svg).toContain('PageMarker000');
    expect(svg).toContain('PageMarker219');
    expect(svg.match(/PageMarker\d{3}/g)).toHaveLength(220);
    expect(svg).toContain('Eldritch Dynasty');
    expect(plateName('House of Salt', book).replace(/\.png$/, '.svg'))
      .toBe('house-of-salt-1100-1319.svg');
  });

  it('replaces lone surrogate halves without damaging Unicode or XML escaping (#1402)', () => {
    const high = '\uD800';
    const low = '\uDC00';
    const emoji = '🕯️';
    const rows = plateRows([
      entry({ text: `The ${high} page ${low} had ${emoji} & ink.` }),
    ], monospace);
    const svg = plateSvg(rows, `House ${high}${emoji}${low}`, 'A <subtitle>');

    expect(svg).not.toContain(high);
    expect(svg).not.toContain(low);
    expect(svg).toContain(`House \uFFFD${emoji}\uFFFD`);
    expect(svg).toContain(`The \uFFFD page \uFFFD had ${emoji} &amp; ink.`);
    expect(svg).toContain('A &lt;subtitle&gt;');
  });

  it('preserves dated omissions and escapes untrusted Chronicle XML', () => {
    const rows = plateRows([
      entry({ year: 1204, text: null, title: 'The hidden page' }),
      entry({ year: 1205, text: 'The <scandal> & its "cost", isn\u0027t it?' }),
    ], monospace);
    const svg = plateSvg(rows, 'House <Salt> & "Ink"', 'A house \u0027without\u0027 a name');

    expect(svg).toContain('1204');
    expect(svg).toContain('1205');
    expect(svg.match(/<line /g)).toHaveLength(2); // heading divider + dated blank
    expect(svg).not.toContain('The hidden page');
    expect(svg).toContain('House &lt;Salt&gt; &amp; &quot;Ink&quot;');
    expect(svg).toContain('The &lt;scandal&gt; &amp; its &quot;cost&quot;');
    expect(svg).toContain('A house &apos;without&apos; a name');
    expect(svg).not.toContain('<scandal>');
    expect(svg).toContain('<svg');
    expect(svg.trimEnd()).toMatch(/<\/svg>$/);
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

  it('selects reader-local image captions without changing any recorded prose or fact (#1717)', () => {
    const before = structuredClone(source);
    const original = afterimageModel(source);
    expect(afterimageModel(source, 'original')).toEqual(original);
    expect(original.facts.map((f) => f.label)).toEqual([
      'Pages written', 'Left blank', 'Improved', 'Lies still standing',
      'The contract, recovered', 'What the book attests', 'Of the blood, living',
    ]);
    const plain = afterimageModel(source, 'plainenglish');
    expect(plain.facts).toEqual([
      { label: 'Pages recorded', value: '71' },
      { label: 'Pages left blank', value: '8' },
      { label: 'Entries embellished', value: '11' },
      { label: 'Lies not yet exposed', value: '4 · 2 exposed' },
      { label: 'Contract clauses recovered', value: '7 of 9 clauses' },
      { label: 'Highest level claimed in the Chronicle', value: 'the Fourth Rung' },
      { label: 'Living blood relatives', value: '13' },
    ]);
    expect(plain.quoteHeading).toBe('CHRONICLE EXCERPT');
    expect(plain.footer).toBe('Eldritch Dynasty · Ending image');
    expect(original.quoteHeading).toBe('FROM THE CHRONICLE');
    expect(original.footer).toBe('Eldritch Dynasty · House Afterimage');
    for (const key of ['houseName', 'strap', 'endingTitle', 'summary', 'quote'] as const) {
      expect(plain[key]).toEqual(original[key]);
    }
    for (const mode of ['original', 'plainenglish'] as const) {
      const empty = afterimageModel({
        ...source,
        reckoning: { ...source.reckoning, attestedTitle: null, provenLies: 0 },
      }, mode);
      expect(empty.facts[5]!.value).toBe(mode === 'plainenglish' ? 'No level claimed' : 'nothing at all');
      expect(empty.facts[3]!.value).toBe('4');
      expect(afterimageLayout(empty, monospace).height).toBe(afterimageLayout(original, monospace).height);
    }
    expect(afterimageModel(source, 'original')).toEqual(original);
    expect(source).toEqual(before);
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

    expect(short.rows.filter((row) => row.size === 28).map((row) => row.text).join(' ')).toBe(model.endingTitle);
    expect(long.rows.filter((row) => row.size === 18).length).toBeGreaterThan(short.rows.filter((row) => row.size === 18).length);
    expect(long.rows.filter((row) => row.italic).length).toBeGreaterThan(short.rows.filter((row) => row.italic).length);
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

  it('keeps people and moments attributed, and draws only the surviving recorded parent path (#1808)', () => {
    const sourcePage = { year: 1200, page: 'rite-page', title: 'A different account', text: 'The book said Meriel returned.' };
    const members = [
      { id: 'head', name: 'Élodie 家', head: true, parents: { father: 'real' }, record: { parents: { mother: 'recorded' } } },
      { id: 'recorded', name: 'Meriel', record: { parents: {} } },
      { id: 'real', name: 'Unrecorded father', record: { parents: {} } },
    ] as MemberView[];
    const input = { ...source, members, evidence: {
      people: [{ person: 'recorded', name: 'Meriel', sources: [sourcePage] }],
      spent: { person: 'recorded', name: 'Meriel', source: sourcePage },
      brush: { count: 2, source: { year: 1180, text: 'Only two remained at the opening of the generation.' } },
      embellishment: sourcePage,
      blank: { year: 1100, text: null },
    } };
    const before = structuredClone(input);
    const original = afterimageModel(input);
    const plain = afterimageModel(input, 'plainenglish');
    expect(original.memories.map((memory) => memory.text)).toEqual([
      'Meriel', 'Meriel', '2 of the blood, living', '', '', 'Meriel → Élodie 家',
    ]);
    expect(plain.memories[2]!.heading).toBe('Smallest preserved generation-opening count');
    expect(original.memories[1]!.source?.text).toBe(sourcePage.text);
    expect(plain.memories.map((memory) => memory.source)).toEqual(original.memories.map((memory) => memory.source));
    expect(plain.memories.at(-1)!.text).not.toContain('Unrecorded father');
    expect(input).toEqual(before);
    expect(afterimageModel({ ...source, members: [] }).memories).toEqual([]);
  });

  it('measures every name, caption, fact and source before exporting, including unspaced Unicode (#1808)', () => {
    const long = 'Élodie家族'.repeat(90);
    const model = afterimageModel({ ...source, houseName: long, evidence: {
      people: [{ person: 'p', name: long, sources: [{ year: 1400, title: long, text: long }] }],
      blank: { year: 1100, text: null, title: 'This blank must not acquire a heading' },
    } });
    const layout = afterimageLayout(model, monospace);
    expect(layout.rows.every((row) => monospace(row.text, '') <= 1200 - 64 * 2)).toBe(true);
    expect(layout.rows.some((row) => row.rule)).toBe(true);
    expect(layout.rows.some((row) => row.text.includes('must not acquire'))).toBe(false);
    const lastBaseline = 64 + layout.rows.reduce((sum, row) => sum + row.size * 1.5 + row.gap, 0);
    expect(layout.height).toBeGreaterThan(lastBaseline + 24);
    expect(layout.height).toBeGreaterThan(afterimageLayout(afterimageModel(source), monospace).height);
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
