import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { indexContent, type FrameRead } from '@ed/schema';
import { testWorld } from '../testing.js';
import type { SimCtx } from '../world.js';
import { playToTheEnd } from './ending-gate.js';
import {
  interludeBearing,
  lookForReturns,
  playRecordReturnRun,
  readBearing,
  recordReturnReport,
  summariseRecordReturns,
  watchFrom,
  type AlteredSource,
  type RecordReturn,
  type RecordReturnRun,
} from './record-return-report.js';

const content = indexContent(loadContent());

function source(over: Partial<AlteredSource> = {}): AlteredSource {
  return {
    decision: 'd-1', entry: 'p-src', event: 'the_source', mode: 'embellish', year: 1060, elapsed: 18,
    promptsBefore: 4, truthfulBefore: 0, discrepancies: ['seal_gift_lie'], ...over,
  };
}

/** A world holding just the altered page, and a watch opened right after it. */
function altered(over: Partial<AlteredSource> = {}): { ctx: SimCtx; watch: ReturnType<typeof watchFrom> } {
  const ctx = testWorld(content, 1987, 1060);
  const w = ctx.world;
  const src = source(over);
  w.chronicle.push({
    id: src.entry, year: src.year, weight: 'paragraph', text: src.mode === 'omit' ? null : 'What the house wrote.',
    eventId: src.event, named: false, record: src.mode,
    ...(src.mode === 'embellish' ? { discrepancyId: src.discrepancies[0] } : {}),
  });
  for (const id of src.discrepancies) w.discrepancies.set(id, { severity: 'major', provableBy: [], state: 'open' });
  return { ctx, watch: watchFrom(ctx, src, w.chronicle.length, w.frame.entries.length, 5) };
}

const frameReading = (test: (r: FrameRead) => boolean) =>
  content.events.find((e) => e.tier === 'frame' && e.reads.some(test))!;

function ret(over: Partial<RecordReturn>): RecordReturn {
  return { kind: 'echo', year: 1085, afterYears: 25, afterReigns: 1, afterPrompts: 9, ref: 'p', ...over };
}

function row(over: Partial<RecordReturnRun>): RecordReturnRun {
  return {
    seed: 1, campaign: 'short', policy: 'chronicler', ending: 'forgotten', broke: false, playedElapsed: 300,
    recordOffers: 10, firstOfferElapsed: 18, prompts: 120, interludes: 4, firstInterludeElapsed: 60,
    firstByKind: {}, ...over,
  };
}

describe('the record-return report (#1987)', () => {
  it('only a read naming the page\'s own lie points at the page', () => {
    const src = source();
    const cases: [FrameRead, ReturnType<typeof readBearing>][] = [
      [{ discrepancy: 'seal_gift_lie' }, 'names_lie'],
      [{ discrepancy: 'regalia_lie', state: 'open' }, 'other_lie'],
      [{ anyDiscrepancy: { atLeast: 1 } }, 'lie_count'],
      [{ recorded: { atLeast: 2 } }, 'recorded_count'],
      [{ omitted: { atLeast: 1 } }, 'omitted_count'],
      [{ chronicled: 'the_source' }, 'same_template'],
      [{ chronicled: 'the_drowning' }, 'none'],
    ];
    for (const [read, bearing] of cases) expect(readBearing(read, src), JSON.stringify(read)).toBe(bearing);
    // The strongest of several reads decides.
    expect(interludeBearing([{ recorded: { atLeast: 1 } }, { discrepancy: 'seal_gift_lie' }], src)).toBe('names_lie');
    expect(interludeBearing([], src)).toBe('none');
  });

  it('an echo whose cause is the page is a return; a page of the same template alone is not', () => {
    const { ctx, watch } = altered();
    const w = ctx.world;
    w.year = 1085;
    w.chronicle.push({ id: 'p-same', year: 1085, weight: 'line', text: 'Again.', eventId: 'the_source', named: false });
    w.chronicle.push({ id: 'p-other', year: 1085, weight: 'line', text: 'Elsewhere.', named: false, cause: { year: 1050 } });
    lookForReturns(ctx, watch, 9);
    expect(watch.first).toBeUndefined();

    w.succession.push({ person: 'heir' as never, name: 'Heir', from: 1080 });
    w.chronicle.push({
      id: 'p-echo', year: 1085, weight: 'line', text: 'A copy kept elsewhere.', named: false,
      echoFrame: 'bearing:wrote_it_larger:0', cause: { year: 1060, page: 'p-src' },
    });
    lookForReturns(ctx, watch, 14);
    expect(watch.first).toMatchObject({
      kind: 'echo', afterYears: 25, afterReigns: 1, afterPrompts: 9, ref: 'p-echo', detail: 'bearing:wrote_it_larger:0',
    });
    // Classified once: a second look at the same book changes nothing.
    lookForReturns(ctx, watch, 30);
    expect(watch.firstByKind.echo!.afterPrompts).toBe(9);
  });

  it('an act\'s follow-up citing the page is a return, but not one the alteration made', () => {
    const { ctx, watch } = altered({ mode: 'omit', discrepancies: [] });
    ctx.world.year = 1135;
    ctx.world.chronicle.push({
      id: 'p-next', year: 1135, weight: 'page', text: 'The book again.', eventId: 'the_next', named: false,
      cause: { year: 1060, page: 'p-src' },
    });
    lookForReturns(ctx, watch, 40);
    expect(watch.first).toMatchObject({ kind: 'followup', afterYears: 75, detail: 'the_next' });
  });

  it('the page\'s own lie settling is a dispute, and a discrepancy page then resolves to it', () => {
    const { ctx, watch } = altered();
    const w = ctx.world;
    w.year = 1070;
    // Written while the lie is open, so nothing yet points back.
    w.chronicle.push({
      id: 'p-papers', year: 1070, weight: 'line', text: 'Papers.', named: false, discrepancyId: 'seal_gift_lie',
    });
    lookForReturns(ctx, watch, 6);
    expect(watch.first).toBeUndefined();

    w.year = 1090;
    w.discrepancies.get('seal_gift_lie')!.state = 'proven';
    lookForReturns(ctx, watch, 12);
    expect(watch.firstByKind.dispute).toMatchObject({ afterYears: 30, ref: 'seal_gift_lie', detail: 'proven' });
    expect(watch.firstByKind.discrepancy_page).toMatchObject({ afterYears: 30, ref: 'p-papers' });
    expect(watch.unlinked).toBeUndefined();
  });

  it('an Omit\'s lie settling is unlinked, never a dispute on the blank', () => {
    const { ctx, watch } = altered({ mode: 'omit', discrepancies: ['the_long_room_omission'] });
    ctx.world.year = 1100;
    ctx.world.discrepancies.get('the_long_room_omission')!.state = 'buried';
    lookForReturns(ctx, watch, 20);
    expect(watch.first).toBeUndefined();
    expect(watch.unlinked).toEqual({ year: 1100, afterYears: 40, discrepancy: 'the_long_room_omission', state: 'buried' });
  });

  it('an interlude reading the page\'s lie returns it; one reading only a count is themed', () => {
    const { ctx, watch } = altered();
    const w = ctx.world;
    const counted = frameReading((r) => 'omitted' in r);
    const naming = frameReading((r) => 'discrepancy' in r && r.discrepancy === 'seal_gift_lie');
    w.year = 1100;
    w.frame.entries.push({ year: 1100, eventId: counted.id, outcomeId: 'only', text: '' });
    lookForReturns(ctx, watch, 20);
    expect(watch.first).toBeUndefined();
    expect(watch.themed).toMatchObject({ afterYears: 40, afterPrompts: 15, event: counted.id, read: 'omitted_count' });
    expect(watch.firstInterludeAfterYears).toBe(40);

    w.year = 1150;
    w.frame.entries.push({ year: 1150, eventId: naming.id, outcomeId: 'x', text: '' });
    lookForReturns(ctx, watch, 30);
    expect(watch.first).toMatchObject({ kind: 'interlude', afterYears: 90, ref: naming.id });
    expect(watch.firstInterludeAfterYears).toBe(40);
  });

  it('keeps altered houses in the denominators and censors the ones with no return', () => {
    const echo = ret({});
    const follow = ret({ kind: 'followup', year: 1135, afterYears: 75, afterPrompts: 30 });
    const rows = [
      row({ source: source(), first: echo, firstByKind: { echo, followup: follow } }),
      row({ source: source({ mode: 'omit', discrepancies: [] }), first: follow, firstByKind: { followup: follow } }),
      row({ source: source({ mode: 'omit', discrepancies: [] }), ending: 'broken_line', broke: true, playedElapsed: 40 }),
      row({ recordOffers: 3 }),
      row({ recordOffers: 0, firstOfferElapsed: undefined, interludes: 0, firstInterludeElapsed: undefined }),
    ];
    const [any, omit, embellish] = summariseRecordReturns(rows);
    expect(any).toMatchObject({ mode: 'any', runs: 5, offered: 4, altered: 3, noInterlude: 1 });
    expect(any!.firstInterludeElapsed.n).toBe(4);
    expect(any!.returned).toMatchObject({ hits: 2, n: 3 });
    expect(any!.alterationReturned).toMatchObject({ hits: 1, n: 3 });
    expect(any!.within.map((w) => w.share.hits)).toEqual([1, 1, 2]);
    // The broken house was watched for 22 years, so no "within" cut observes it.
    expect(any!.within.map((w) => [w.observed.hits, w.observed.n])).toEqual([[1, 2], [1, 2], [2, 2]]);
    expect(any!.afterYears).toMatchObject({ n: 2, median: 50, max: 75 });
    // Four prompts before the choice, the choice itself, then nine or thirty.
    expect(any!.fromSigning).toMatchObject({ n: 2, median: 24.5, max: 35 });
    expect(any!.sources).toEqual([['the_source', 3]]);
    expect(any!.firstKinds).toEqual({ echo: 1, followup: 1 });
    expect(any!.anyKind).toEqual({ echo: 1, followup: 2 });
    // The broken house is censored at its own end: 40 played, 18 when it altered.
    expect(any!.censored).toMatchObject({ broken: 1, term: 0, unfinished: 0 });
    expect(any!.censored.yearsAtRisk).toMatchObject({ n: 1, median: 22 });
    expect(omit).toMatchObject({ mode: 'omit', altered: 2 });
    expect(omit!.alterationReturned.hits).toBe(0);
    expect(embellish).toMatchObject({ mode: 'embellish', altered: 1 });
    // The exact 25-year echo has a bucket of its own.
    expect(any!.afterBuckets.find((b) => b.from === 25)!.count).toBe(1);
    expect(recordReturnReport([any!, omit!, embellish!]).join('\n')).toContain('short / chronicler / omit');
  });

  it('the chronicler column plays the same house as playToTheEnd', () => {
    // Forty years diverges on any docket-loop difference: the template-fire
    // map moves with every reseeded answer.
    for (const seed of [198_700, 198_701]) {
      let fires: Record<string, number> = {};
      playRecordReturnRun(content, seed, 'short', 'chronicler', 40,
        (ctx) => { fires = { ...ctx.world.frequency.templateFires }; });
      expect(fires).toEqual(playToTheEnd(content, seed, 40, 'chronicler', 'short').templateFires);
    }
  });

  it('a forcing column is its chronicler twin until the first answer they would give differently', () => {
    // On this seed the chronicler itself embellishes in 1059 and first answers
    // otherwise in 1092, so the shared stretch crosses a Record block and the
    // twenty decisions after it.
    const logOf = (policy: 'chronicler' | 'embellish') => {
      let log: SimCtx['world']['decisionLog'] = [];
      playRecordReturnRun(content, 198_706, 'short', policy, 60, (ctx) => { log = ctx.world.decisionLog; });
      return log;
    };
    const chronicler = logOf('chronicler');
    const forced = logOf('embellish');
    const records = forced.filter((d) => d.kind === 'record');
    expect(records.length).toBeGreaterThan(1);
    expect(records.every((d) => d.kind === 'record' && d.option === 'embellish')).toBe(true);
    const split = chronicler.findIndex((d) => d.kind === 'record' && d.option !== 'embellish');
    const shared = chronicler.slice(0, split);
    expect(shared.filter((d) => d.kind === 'record').length).toBeGreaterThan(0);
    expect(shared.length - shared.findIndex((d) => d.kind === 'record')).toBeGreaterThan(10);
    expect(JSON.stringify(forced.slice(0, split))).toBe(JSON.stringify(shared));
  });
});
