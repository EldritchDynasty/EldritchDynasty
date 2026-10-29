import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { emptyPanel } from '../people/panel.js';
import type { MatchCard } from '../people/match.js';
import { playToTheEnd } from './ending-gate.js';
import {
  continuityCard,
  lineBreakReport,
  medianInterval,
  playLineBreakRun,
  quantile,
  summariseLineBreaks,
  type LineBreakRun,
} from './line-break-report.js';

function card(id: string, over: Partial<MatchCard> = {}): MatchCard {
  return {
    id, kind: 'outsider', name: id, sex: 'female', age: 20, house: 'h', houseName: 'H',
    blurb: '', dowry: 0, kinship: 0, line: 'unknown', words: '', lineSeen: 0,
    papersAsked: 0, papersShown: 0, panel: emptyPanel(), available: true, ...over,
  };
}

function row(over: Partial<LineBreakRun>): LineBreakRun {
  return {
    seed: 1, campaign: 'short', policy: 'chronicler', ending: 'forgotten', broke: false,
    playedElapsed: 300, interludes: 3, firstInterludeYear: 1100, firstInterludeElapsed: 58,
    offers: [], thinYears: 0, oneBloodYears: 0, bloodAtEnd: 5, householdAtEnd: 20, heirMatchesTaken: 0, matchesTaken: 0, matchesDeclined: 0,
    ...over,
  };
}

const broken = (elapsed: number, over: Partial<LineBreakRun> = {}) => row({
  ending: 'broken_line', broke: true, breakYear: 1042 + elapsed, breakElapsed: elapsed, playedElapsed: elapsed, ...over,
});

describe('the line-break report (#1993)', () => {
  it('takes the open card whose face reads for continuity, never a closed one', () => {
    const fertile = card('fertile', { line: 'fertile', lineSeen: 3, dowry: 40 });
    const closed = card('closed', { line: 'fertile', lineSeen: 4, available: false });
    const cousin = card('cousin', { kind: 'household', kinship: 0.0625, line: 'ordinary', lineSeen: 2 });
    expect(continuityCard([cousin, closed, fertile])?.id).toBe('fertile');
    // Equal faces fall to the smaller dowry, and nothing open means no answer.
    expect(continuityCard([card('dear', { dowry: 90 }), card('cheap', { dowry: 10 })])?.id).toBe('cheap');
    expect(continuityCard([closed])).toBeUndefined();
  });

  it('keeps survivors and missing interludes in the all-run denominators only', () => {
    const rows = [
      broken(30, { interludes: 0, firstInterludeYear: undefined, firstInterludeElapsed: undefined }),
      broken(80),
      broken(150),
      row({ interludes: 0, firstInterludeYear: undefined, firstInterludeElapsed: undefined }),
      row({}),
    ];
    const [s] = summariseLineBreaks(rows);
    expect(s!.broke).toMatchObject({ hits: 3, n: 5 });
    expect(s!.brokeBeforeInterlude).toMatchObject({ hits: 1, n: 5 });
    expect(s!.beforeInterludeGivenBreak).toMatchObject({ hits: 1, n: 3 });
    expect(s!.brokeBeforeElapsed100).toMatchObject({ hits: 2, n: 5 });
    expect(s!.beforeElapsed100GivenBreak).toMatchObject({ hits: 2, n: 3 });
    // A survivor with no interlude is counted as such, not given a year.
    expect(s!.noInterlude).toBe(2);
    expect(s!.survivorsCensored).toBe(2);
    expect(s!.breakElapsed).toMatchObject({ n: 3, min: 30, median: 80, max: 150 });
    expect(s!.firstInterludeElapsed.n).toBe(3);
    expect(lineBreakReport([s!]).join('\n')).toContain('short / chronicler');
  });

  it('reads an offer before the break with its blood count and answer', () => {
    const rows = [
      broken(60, { offers: [{ year: 1090, elapsed: 48, blood: 4, answer: 'write_it_all_down' }] }),
      broken(70, { offers: [{ year: 1120, elapsed: 78, blood: 1, answer: null }], oneBloodYears: 2 }),
      row({ offers: [{ year: 1200, elapsed: 158, blood: 1, answer: 'recall_everyone' }] }),
    ];
    const [s] = summariseLineBreaks(rows);
    // The second offer came after its own run's break year, so it was not "first".
    expect(s!.offeredBeforeBreak).toBe(1);
    expect(s!.offers).toEqual({
      total: 3, atOneBlood: 2, answers: { recall_everyone: 1, unanswered: 1, write_it_all_down: 1 },
    });
    expect(s!.brokeAfterOneBloodYear).toBe(1);
  });

  it('quantiles interpolate and the median interval refuses a tiny sample', () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(medianInterval([1, 2, 3, 4, 5])).toBeNull();
    const ci = medianInterval(Array.from({ length: 100 }, (_, i) => i))!;
    expect(ci.lower).toBeLessThan(50);
    expect(ci.upper).toBeGreaterThan(50);
  });

  it('the chronicler column plays the same house as playToTheEnd', () => {
    // Forty years diverges on any docket-loop difference (the template-fire
    // map moves with every reseeded answer) and is far too short to mean
    // anything about breaks.
    const content = loadContent();
    for (const seed of [199_300, 199_301]) {
      let fires: Record<string, number> = {};
      const ours = playLineBreakRun(content, seed, 'short', 'chronicler', 40,
        (ctx) => { fires = { ...ctx.world.frequency.templateFires }; });
      const theirs = playToTheEnd(content, seed, 40, 'chronicler', 'short');
      expect(fires).toEqual(theirs.templateFires);
      expect(ours.bloodAtEnd).toBe(theirs.bloodLeft);
      expect(ours.householdAtEnd).toBe(theirs.survivors);
      expect(ours.thinYears).toBe(theirs.bottleneckYears);
      expect(ours.broke).toBe(theirs.ending === 'broken_line');
    }
  });
});
