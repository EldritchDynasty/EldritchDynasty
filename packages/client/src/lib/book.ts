import type { ChronicleEntry } from '@ed/core';

/**
 * READING THE BOOK (issue #69), as functions rather than as a component.
 *
 * `VIEW_CHRONICLE_LINES = 60` has always been commented *"the whole book is a
 * separate read"*, and the separate read was never built: the client drew the
 * last sixty entries of a book that ran to 3,576. §24 calls the chronicle
 * *"a persistent, scrollable, searchable document"* and *"the artefact players
 * will screenshot" —* and you cannot screenshot what the client will not draw.
 *
 * The pane's own logic lives here for the reason `assize.ts`, `jump.ts` and
 * `keys.ts` do: a filter written inline in a `computed` is a filter no test
 * can reach, and the one thing worth asserting about a search is what it does
 * NOT match.
 */

export type Lens = 'all' | 'blank' | 'improved' | 'illuminated';

export const LENSES: { id: Lens; label: string }[] = [
  { id: 'all', label: 'The whole book' },
  { id: 'blank', label: 'Left blank' },
  { id: 'improved', label: 'Improved' },
  { id: 'illuminated', label: 'Illuminated' },
];

export interface Reading {
  lens: Lens;
  /** Draw nothing before this year. Null is the beginning. */
  from: number | null;
  /** Free text, matched against the title and the body. */
  find: string;
}

/**
 * Whether one entry survives what the reader has asked for.
 *
 * The lens and the search are ANDed rather than exclusive: "the blanks, about
 * Wystan" is a question a player has, and it is the question this pane exists
 * to answer.
 *
 * The search never matches the YEAR. Typing `12` should not hand back the
 * whole twelfth century as though it had matched a word — the century buttons
 * are the year control, and a search that quietly did both would make the two
 * impossible to tell apart.
 */
export function reads(entry: ChronicleEntry, r: Reading): boolean {
  if (r.from !== null && entry.year < r.from) return false;
  if (r.lens === 'blank' && entry.text !== null) return false;
  if (r.lens === 'improved' && entry.record !== 'embellish') return false;
  if (r.lens === 'illuminated' && entry.weight !== 'illuminated') return false;

  const needle = r.find.trim().toLowerCase();
  if (!needle) return true;
  return `${entry.title ?? ''} ${entry.text ?? ''}`.toLowerCase().includes(needle);
}

/** One drawn line of the exported plate. */
export interface PlateRow {
  text: string;
  size: number;
  colour: string;
  italic?: boolean;
  /** A dated blank line: a rule across the page and no text. */
  rule?: boolean;
  gap: number;
}

export const PLATE = {
  width: 1200,
  pad: 64,
  head: 132,
  foot: 56,
  ink: '#241f18',
  soft: '#5d5344',
  faint: '#8b8067',
  rubric: '#7d2f26',
  rule: '#cdbfa4',
  ground: '#f4ecd8',
  serif: 'Georgia, "Iowan Old Style", "Palatino Linotype", serif',
} as const;

const SIZE: Record<string, number> = { line: 15, paragraph: 17, page: 19, illuminated: 22 };

/** How wide a string is, in the font the plate is about to draw it in. */
export type Measure = (text: string, font: string) => number;

/** Greedy wrap. Never drops a word, even one wider than the column. */
export function wrap(text: string, font: string, max: number, measure: Measure): string[] {
  const out: string[] = [];
  let row = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = row ? `${row} ${word}` : word;
    if (measure(next, font) > max && row) { out.push(row); row = word; }
    else row = next;
  }
  if (row) out.push(row);
  return out;
}

/**
 * The page, laid out. Pure, and separated from the drawing for two reasons:
 * the canvas height cannot be known until the layout is done — a fixed height
 * either clips the book or pads it with dead ground — and this is the half
 * with the omissions in it.
 *
 * AN OMISSION IS A RULED BLANK, not a skipped entry. It is the single most
 * striking thing this game produces and the thing a naive DOM-to-image pass
 * renders as nothing at all, so it is a row here with `rule` set and no text.
 */
export function plateRows(entries: readonly ChronicleEntry[], measure: Measure): PlateRow[] {
  const inner = PLATE.width - PLATE.pad * 2;
  const rows: PlateRow[] = [];

  for (const e of entries) {
    rows.push({ text: String(e.year), size: 11, colour: PLATE.faint, gap: 6 });
    const size = SIZE[e.weight] ?? 15;

    if (e.title && e.text !== null) {
      const font = `500 ${size + 1}px ${PLATE.serif}`;
      for (const l of wrap(e.title, font, inner, measure)) {
        rows.push({
          text: l,
          size: size + 1,
          colour: e.weight === 'illuminated' ? PLATE.rubric : PLATE.ink,
          gap: 4,
        });
      }
    }

    if (e.text === null) {
      rows.push({ text: '', size: 15, colour: PLATE.ink, rule: true, gap: 18 });
      continue;
    }

    const italic = e.record === 'embellish';
    const font = `${italic ? 'italic ' : ''}${size}px ${PLATE.serif}`;
    const wrapped = wrap(e.text, font, inner, measure);
    wrapped.forEach((l, i) => rows.push({
      text: l,
      size,
      colour: e.weight === 'line' ? PLATE.soft : PLATE.ink,
      italic,
      gap: i === wrapped.length - 1 ? 18 : 4,
    }));
  }

  return rows;
}

/** How tall the plate has to be to hold those rows. */
export function plateHeight(rows: readonly PlateRow[]): number {
  return Math.ceil(PLATE.head + rows.reduce((h, r) => h + r.size * 1.5 + r.gap, 0) + PLATE.foot);
}

/** What the plate says under the house's name. */
export function plateSubtitle(entries: readonly ChronicleEntry[], lens: Lens): string {
  const label = (LENSES.find((l) => l.id === lens) ?? LENSES[0]!).label.toLowerCase();
  if (!entries.length) return `nothing yet · ${label}`;
  return `${entries.length} entries · ${plateSpan(entries)} · ${label}`;
}

export function plateSpan(entries: readonly ChronicleEntry[]): string {
  if (!entries.length) return 'nothing';
  return `${entries[0]!.year}–${entries[entries.length - 1]!.year}`;
}

/** A filename a person would not be embarrassed to have in their downloads. */
export function plateName(houseName: string, entries: readonly ChronicleEntry[]): string {
  const house = houseName.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'the-house';
  return `${house}-${plateSpan(entries).replace('–', '-')}.png`;
}


/**
 * THE HOUSE AFTERIMAGE (issue #260).
 *
 * A finished Chronicle is a volume; this is the single page a player can hand
 * to somebody else. It is deliberately assembled only from the ending read
 * model and the Chronicle pages the creditor already selected. Nothing here
 * asks the client to infer hidden truth, and nothing is scored.
 */
export interface AfterimageInput {
  houseName: string;
  campaignName: string;
  seed: number;
  year: number;
  endingTitle: string;
  endingSummary: string;
  reckoning: {
    pages: number;
    blanks: number;
    embellished: number;
    standingLies: number;
    provenLies: number;
    clauses: number;
    clausesTotal: number;
    attestedTitle: string;
    livingBlood: number;
  };
  read: readonly ChronicleEntry[];
}

export interface AfterimageModel {
  houseName: string;
  strap: string;
  endingTitle: string;
  summary: string;
  facts: { label: string; value: string }[];
  quote?: { year: number; title?: string; text: string };
}

/**
 * One remembered line for the small page. Illuminated pages are already the
 * Chronicle's own "this mattered" signal, so the newest one wins. If the last
 * night read no illuminated prose, the newest non-blank page wins instead.
 * A blank stays a blank; this helper never reconstructs what the house omitted.
 */
export function afterimageQuote(
  read: readonly ChronicleEntry[],
): AfterimageModel['quote'] | undefined {
  const written = [...read].reverse().filter(
    (entry): entry is ChronicleEntry & { text: string } => entry.text !== null,
  );
  const picked = written.find((entry) => entry.weight === 'illuminated') ?? written[0];
  if (!picked) return undefined;
  return {
    year: picked.year,
    ...(picked.title ? { title: picked.title } : {}),
    text: picked.text,
  };
}

/** The factual small page: no grade, no rank, no "best" ending. */
export function afterimageModel(input: AfterimageInput): AfterimageModel {
  const r = input.reckoning;
  const quote = afterimageQuote(input.read);
  return {
    houseName: input.houseName,
    strap: `${input.campaignName} · ${input.year} · seed ${input.seed}`,
    endingTitle: input.endingTitle,
    summary: input.endingSummary,
    facts: [
      { label: 'Pages written', value: String(r.pages) },
      { label: 'Left blank', value: String(r.blanks) },
      { label: 'Improved', value: String(r.embellished) },
      {
        label: 'Lies still standing',
        value: r.provenLies > 0 ? `${r.standingLies} · ${r.provenLies} caught` : String(r.standingLies),
      },
      { label: 'The contract, recovered', value: `${r.clauses} of ${r.clausesTotal} clauses` },
      { label: 'What the book attests', value: r.attestedTitle },
      { label: 'Of the blood, living', value: String(r.livingBlood) },
    ],
    ...(quote ? { quote } : {}),
  };
}

/**
 * The measured half of the Afterimage renderer. Keep line selection and canvas
 * height out of the component so long endings and Chronicle excerpts cannot
 * silently clip when copy changes.
 */
export interface AfterimageLayout {
  endingFont: string;
  summaryFont: string;
  quoteFont: string;
  endingLines: string[];
  summaryLines: string[];
  quoteLines: string[];
  height: number;
}

export function afterimageLayout(model: AfterimageModel, measure: Measure): AfterimageLayout {
  const inner = PLATE.width - PLATE.pad * 2;
  const endingFont = `500 28px ${PLATE.serif}`;
  const summaryFont = `18px ${PLATE.serif}`;
  const quoteFont = `italic 19px ${PLATE.serif}`;
  const endingLines = wrap(model.endingTitle, endingFont, inner, measure);
  const summaryLines = wrap(model.summary, summaryFont, inner, measure);
  const quoteLines = model.quote
    ? wrap(model.quote.text, quoteFont, inner - 36, measure)
    : [];
  const height = Math.max(
    760,
    214
      + endingLines.length * 38
      + summaryLines.length * 30
      + model.facts.length * 42
      + (model.quote ? 88 + quoteLines.length * 31 : 0)
      + 80,
  );

  return {
    endingFont,
    summaryFont,
    quoteFont,
    endingLines,
    summaryLines,
    quoteLines,
    height,
  };
}

/** Stable, collision-resistant enough for several finished houses in one folder. */
export function afterimageName(houseName: string, seed: number, year: number): string {
  const house = houseName.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'the-house';
  return `${house}-${year}-seed-${seed}-afterimage.png`;
}
