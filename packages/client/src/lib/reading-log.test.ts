import { describe, expect, it } from 'vitest';
import { watch } from 'vue';
import { loadBundle } from '@ed/content';
import { canonical } from '@ed/core';
import type { Platform } from '../platform.js';
import { createGame } from './game.js';
import {
  READING_LOG_MAX_EVENTS, READING_LOG_NOTICE, ReadingLog, attachReadingLog, readingLogRequested, recordActions, summarize,
} from './reading-log.js';

/** A clock the test turns by hand. */
function clock() {
  let t = 1_000;
  return { now: () => t, tick: (ms: number) => { t += ms; } };
}

const BUILD = { sha: 'abc123', platform: 'test' };

function log(c = clock(), initial = { visible: true, focused: true }) {
  return new ReadingLog(c.now, BUILD, '2026-10-28T00:00:00.000Z', initial);
}

/** A document and window that only dispatch what the test tells them to. */
function host() {
  const listeners = new Map<string, () => void>();
  const target = {
    addEventListener: (type: string, fn: () => void) => { listeners.set(type, fn); },
    removeEventListener: (type: string) => { listeners.delete(type); },
  };
  const doc = { ...target, visibilityState: 'visible' as DocumentVisibilityState };
  const fire = (type: string) => listeners.get(type)?.();
  return { doc, win: target, fire, listeners };
}

describe('the reading log is off unless asked for (#1945)', () => {
  it('turns on only for the research switch', () => {
    expect(readingLogRequested('')).toBe(false);
    expect(readingLogRequested('?seed=4')).toBe(false);
    expect(readingLogRequested('?reading-log=0')).toBe(false);
    expect(readingLogRequested('?reading-log=off')).toBe(false);
    expect(readingLogRequested('?reading-log')).toBe(true);
    expect(readingLogRequested('?reading-log=1')).toBe(true);
    expect(readingLogRequested('?x=1&reading-log=on')).toBe(true);
  });

  it('says what it records, that it stays on the device, and that the save is untouched', () => {
    expect(READING_LOG_NOTICE).toMatch(/On this device only/);
    expect(READING_LOG_NOTICE).toMatch(/not part of your saved game/);
    expect(READING_LOG_NOTICE).toMatch(/only if you export it/);
  });

  it('never reaches the network', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./reading-log.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage/);
  });
});

describe('the three clocks', () => {
  it('counts foreground only while visible, focused and not on a declared break', () => {
    const c = clock();
    const l = log(c);
    const { doc, win, fire } = host();
    const detach = attachReadingLog(l, doc, win);

    c.tick(10_000); // foreground
    doc.visibilityState = 'hidden'; fire('visibilitychange');
    c.tick(5_000); // hidden tab
    doc.visibilityState = 'visible'; fire('visibilitychange');
    fire('blur');
    c.tick(3_000); // another app on top
    fire('focus');
    c.tick(2_000); // foreground
    l.note({ kind: 'break', on: true });
    doc.visibilityState = 'hidden'; fire('visibilitychange');
    c.tick(60_000); // a declared break wins over a hidden tab
    doc.visibilityState = 'visible'; fire('visibilitychange');
    l.note({ kind: 'break', on: false });
    c.tick(1_000);
    detach();

    const s = l.artifact().summary;
    expect(s.wallMs).toBe(81_000);
    expect(s.foregroundMs).toBe(13_000);
    expect(s.hiddenMs).toBe(5_000);
    expect(s.unfocusedMs).toBe(3_000);
    expect(s.breakMs).toBe(60_000);
    expect(s.foregroundMs + s.hiddenMs + s.unfocusedMs + s.breakMs).toBe(s.wallMs);
  });

  it('does not split an interval on a repeated state', () => {
    const l = log();
    l.note({ kind: 'focus', focused: true });
    l.note({ kind: 'pane', pane: 'house' });
    l.note({ kind: 'pane', pane: 'house' });
    expect(l.events.map((e) => e.kind)).toEqual(['visible', 'focus', 'pane']);
  });

  it('starts from the state the page was in, not from an assumed foreground', () => {
    const c = clock();
    const l = log(c, { visible: false, focused: false });
    c.tick(4_000);
    expect(l.artifact().summary).toMatchObject({ foregroundMs: 0, hiddenMs: 4_000 });
  });

  it('detaches every listener it attached, and ends on pagehide', () => {
    const l = log();
    const { doc, win, fire, listeners } = host();
    let told = 0;
    const detach = attachReadingLog(l, doc, win, () => { told++; });
    fire('pagehide');
    expect(l.ended).toBe('unloaded');
    expect(told, 'the notice is told it is no longer recording').toBe(1);
    detach();
    expect(listeners.size).toBe(0);
  });
});

describe('answers and the gaps between them', () => {
  it('measures each gap on wall, foreground and game-year clocks, and censors the last', () => {
    const c = clock();
    const l = log(c);
    l.note({ kind: 'year', year: 1042 });
    c.tick(1_000);
    l.page(1050, { id: 'chr_1', eventId: 'plain' });
    l.note({ kind: 'decision', year: 1050, decision: 'dec_1', event: 'plain', seen: false });
    c.tick(2_000);
    l.page(1072, { id: 'chr_2', eventId: 'the_heir_reads_the_tally', answer: 'glimpse' });
    c.tick(4_000);
    l.note({ kind: 'decision', year: 1080, decision: 'dec_2', event: 'plain', seen: true });
    l.note({ kind: 'decision', year: 1090, decision: 'dec_3', event: 'plain', seen: false });
    l.interlude(1120, 'frame_x');
    c.tick(8_000);
    l.note({ kind: 'year', year: 1130 });
    l.end('exported');

    const { gaps, answers, decisions } = l.artifact().summary;
    expect(answers).toBe(2);
    expect(decisions).toBe(3);
    expect(gaps).toEqual([
      { from: { at: 0, year: null, kind: 'start' }, to: { at: 3_000, year: 1072, kind: 'glimpse' },
        wallMs: 3_000, foregroundMs: 3_000, years: null, decisions: 1, censored: false },
      { from: { at: 3_000, year: 1072, kind: 'glimpse' }, to: { at: 7_000, year: 1120, kind: 'interlude' },
        wallMs: 4_000, foregroundMs: 4_000, years: 48, decisions: 2, censored: false },
      { from: { at: 7_000, year: 1120, kind: 'interlude' }, to: { at: 15_000, year: 1130, kind: 'exported' },
        wallMs: 8_000, foregroundMs: 8_000, years: 10, decisions: 0, censored: true },
    ]);
  });

  it('flags a page shown twice as a revisit, and a revisit answers nothing', () => {
    const l = log();
    const page = { id: 'chr_9', eventId: 'e', answer: 'clause' as const };
    l.page(1200, page);
    l.page(1200, page);
    const pages = l.events.filter((e) => e.kind === 'page');
    expect(pages.map((e) => 'revisit' in e && e.revisit)).toEqual([false, true]);
    expect(l.artifact().summary.answers).toBe(1);
  });

  it('notes only the pages new to the chronicle window', () => {
    const l = log();
    l.chronicle([{ id: 'a', year: 1042 }, { id: 'b', year: 1043, answer: 'glimpse' }]);
    l.chronicle([{ id: 'b', year: 1043, answer: 'glimpse' }, { id: 'c', year: 1050 }]);
    l.chronicle(undefined);
    l.chronicle([{ id: 'b', year: 1043, answer: 'glimpse' }, { id: 'c', year: 1050 }]);
    expect(l.events.flatMap((e) => (e.kind === 'page' ? [e.page] : []))).toEqual(['a', 'b', 'c']);
    expect(l.artifact().summary.answers).toBe(1);
  });

  it('carries the window a picked-up save arrives with, and counts what comes after', () => {
    const c = clock();
    const l = log(c);
    l.note({ kind: 'action', verb: 'resume', act: 'start' });
    l.chronicle([{ id: 'old_1', year: 1240, answer: 'clause' }, { id: 'old_2', year: 1290, answer: 'glimpse' }]);
    c.tick(5_000);
    l.chronicle([{ id: 'old_2', year: 1290, answer: 'glimpse' }, { id: 'new_1', year: 1301, answer: 'glimpse' }]);
    const pages = l.events.filter((e) => e.kind === 'page');
    expect(pages.map((e) => [e.page, 'carried' in e && e.carried === true])).toEqual([
      ['old_1', true], ['old_2', true], ['new_1', false],
    ]);
    const { answers, gaps } = l.artifact().summary;
    expect(answers, 'history read in another session answers nothing').toBe(1);
    expect(gaps[0]).toMatchObject({ from: { kind: 'start' }, to: { at: 5_000, year: 1301, kind: 'glimpse' } });
  });

  it('does not invent a new-house boundary when the first Begin follows time on the title screen', () => {
    const c = clock();
    const l = log(c);
    c.tick(5_000);
    l.note({ kind: 'action', verb: 'begin', act: 'start' });
    l.note({ kind: 'run', campaign: 'short', seed: 42 });
    c.tick(2_000);
    l.chronicle([{ id: 'first', year: 1044, answer: 'glimpse' }]);
    const { gaps, answers } = l.artifact().summary;
    expect(answers).toBe(1);
    expect(gaps.some((g) => g.to.kind === 'new-run')).toBe(false);
    expect(gaps[0]).toMatchObject({
      from: { at: 0, year: null, kind: 'start' },
      to: { at: 7_000, year: 1044, kind: 'glimpse' },
      censored: false,
    });
  });

  it('starts fresh Chronicle evidence and censored gaps for a second house with reused ids and seed', () => {
    const c = clock();
    const l = log(c);
    const page = [{ id: 'chr_1', year: 1044, answer: 'glimpse' as const }];
    l.note({ kind: 'run', campaign: 'short', seed: 17 });
    l.chronicle(page);
    c.tick(1_000);
    l.chronicle([]);
    l.chronicle(page); // same house, genuinely a revisit
    c.tick(1_000);
    l.note({ kind: 'action', verb: 'begin', act: 'start' });
    l.note({ kind: 'run', campaign: 'short', seed: 17 }); // repeated run identity
    l.chronicle(page); // different house, fresh despite the same page id
    c.tick(1_000);
    l.chronicle([]);
    l.chronicle(page); // still a revisit inside the second house

    const pages = l.events.filter((e) => e.kind === 'page');
    expect(pages.map((e) => 'revisit' in e && e.revisit === true))
      .toEqual([false, true, false, true]);
    expect(l.events.filter((e) => e.kind === 'run')).toHaveLength(2);
    const summary = l.artifact().summary;
    expect(summary.answers).toBe(2);
    expect(summary.gaps.filter((g) => g.to.kind === 'new-run')).toEqual([
      expect.objectContaining({ censored: true, wallMs: 2_000, from: { at: 0, year: 1044, kind: 'glimpse' } }),
    ]);
    expect(summary.gaps.filter((g) => g.from.kind === 'start')).toHaveLength(2);
    expect(summary.gaps.filter((g) => g.from.kind === 'start')[1]?.years).toBeNull();
  });

  it('a begun run is news from its first page; a failed pick-up leaves the run on screen as news', async () => {
    const l = log();
    l.note({ kind: 'action', verb: 'resume', act: 'start' });
    l.note({ kind: 'action', verb: 'begin', act: 'start' });
    l.chronicle([{ id: 'founding', year: 1042, answer: 'glimpse' }]);

    const actions = recordActions({
      importSave: async () => 'cancelled' as const,
      load: async () => false,
    } as unknown as Parameters<typeof recordActions>[0], l);
    await actions.importSave();
    l.chronicle([{ id: 'founding', year: 1042, answer: 'glimpse' }, { id: 'next', year: 1060, answer: 'clause' }]);
    await actions.load('slot');
    l.chronicle([{ id: 'next', year: 1060, answer: 'clause' }, { id: 'after', year: 1090, answer: 'glimpse' }]);

    expect(l.events.some((e) => e.kind === 'page' && 'carried' in e && e.carried)).toBe(false);
    expect(l.artifact().summary.answers).toBe(3);
  });

  it('records nothing after it ends, and an open log censors as open', () => {
    const c = clock();
    const l = log(c);
    c.tick(500);
    expect(l.artifact().summary.gaps.at(-1)!.to.kind).toBe('open');
    l.end('stopped');
    l.page(1300, { id: 'late', answer: 'glimpse' });
    expect(l.events.some((e) => e.kind === 'page')).toBe(false);
    expect(l.artifact().summary.gaps.at(-1)).toMatchObject({ censored: true, to: { kind: 'stopped' } });
  });

  it('is bounded, says so, and still ends', () => {
    const l = log();
    for (let i = 0; i < READING_LOG_MAX_EVENTS + 10; i++) l.note({ kind: 'year', year: 1042 + i });
    expect(l.truncated).toBe(true);
    expect(l.events.length).toBe(READING_LOG_MAX_EVENTS - 1);
    l.end('exported');
    const artifact = l.artifact();
    expect(artifact.events.length).toBe(READING_LOG_MAX_EVENTS);
    expect(artifact.truncated).toBe(true);
    expect(artifact.summary.gaps.at(-1)).toMatchObject({ censored: true, to: { kind: 'exported' } });
  });

  it('names its build, its format, and the cautions a reader of it needs', () => {
    const artifact = log().artifact();
    expect(artifact).toMatchObject({ format: 'ed-reading-log/4', build: BUILD, startedAt: '2026-10-28T00:00:00.000Z' });
    expect(artifact.caveats.join(' ')).toMatch(/exposure proxy, not reading time/);
    expect(artifact.caveats.join(' ')).toMatch(/not elapsed time/);
    expect(JSON.parse(JSON.stringify(artifact))).toEqual(artifact);
  });

  it('summarises a log handed back to it the same way', () => {
    const c = clock();
    const l = log(c);
    c.tick(2_000);
    l.page(1100, { id: 'a', answer: 'glimpse' });
    c.tick(3_000);
    l.end('exported');
    const artifact = l.artifact();
    expect(summarize(artifact.events, Infinity)).toEqual(artifact.summary);
  });
});

/** Saves land through the platform asynchronously; let them. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function memoryPlatform(): Platform & { saves: Map<string, unknown> } {
  const saves = new Map<string, unknown>();
  let library: unknown | null = null;
  return {
    saves,
    listSaves: async () => [],
    readSave: async (slot) => saves.get(slot) ?? null,
    writeSave: async (slot, save) => { saves.set(slot, structuredClone(save)); },
    deleteSave: async (slot) => { saves.delete(slot); },
    readLibrary: async () => library,
    writeLibrary: async (next) => { library = next; },
    readUserContent: async () => ({}),
    exportSave: async () => undefined, importSave: async () => null,
    onPause: () => () => undefined, onBack: () => () => undefined,
  };
}

/** Turn the run until `done`, the way a reader who lets the chronicler decide would. */
function playUntil(game: ReturnType<typeof createGame>, actions: ReturnType<typeof createGame>['actions'], done: () => boolean, years: number) {
  for (let i = 0; i < years && !done(); i++) {
    actions.advance(1);
    if (game.outcome.value) actions.dismissOutcome();
    if (game.interlude.value) actions.dismissInterlude();
    while (game.chapter.value) actions.dismissChapter();
    if (game.docket.value.length) actions.letHimDecide();
    if (game.view.value?.namesWanted.length) actions.keepSuggestedNames();
  }
}

describe('Table action research (#1992)', () => {
  it('records bounded order and Muster categories with paired attempted/accepted/refused results', () => {
    const l = log();
    const accepted = { ok: true, spent: 2, left: 8 };
    const refused = { ok: false, reason: 'a private reason to omit' };
    const calls: unknown[][] = [];
    const bare = {
      order(o: unknown) {
        calls.push(['order', o]);
        return o === orderA ? accepted : refused;
      },
      muster(o: unknown) {
        calls.push(['muster', o]);
        return o === musterA ? refused : accepted;
      },
    } as unknown as Parameters<typeof recordActions>[0];
    const actions = recordActions(bare, l);
    const orderA = { kind: 'study', person: 'someone' } as unknown as Parameters<typeof actions.order>[0];
    const orderB = { kind: 'lotBid', bid: 5 } as unknown as Parameters<typeof actions.order>[0];
    const musterA = { op: 'reinforce', detail: 'do not export' } as unknown as Parameters<typeof actions.muster>[0];
    const musterB = { op: 'withdraw' } as unknown as Parameters<typeof actions.muster>[0];

    expect(actions.order(orderA)).toBe(accepted);
    expect(actions.order(orderB)).toBe(refused);
    expect(actions.muster(musterA)).toBe(refused);
    expect(actions.muster(musterB)).toBe(accepted);
    expect(calls).toEqual([['order', orderA], ['order', orderB], ['muster', musterA], ['muster', musterB]]);

    const events = l.events.filter((e) => e.kind === 'action').map(({ at: _at, ...e }) => e);
    expect(events).toEqual([
      { kind: 'action', verb: 'order', act: 'table', category: 'study', status: 'attempted' },
      { kind: 'action', verb: 'order', act: 'table', category: 'study', status: 'accepted' },
      { kind: 'action', verb: 'order', act: 'table', category: 'lotBid', status: 'attempted' },
      { kind: 'action', verb: 'order', act: 'table', category: 'lotBid', status: 'refused' },
      { kind: 'action', verb: 'muster', act: 'muster', category: 'reinforce', status: 'attempted' },
      { kind: 'action', verb: 'muster', act: 'muster', category: 'reinforce', status: 'refused' },
      { kind: 'action', verb: 'muster', act: 'muster', category: 'withdraw', status: 'attempted' },
      { kind: 'action', verb: 'muster', act: 'muster', category: 'withdraw', status: 'accepted' },
    ]);
    expect(JSON.stringify(l.artifact())).not.toContain('a private reason to omit');
    expect(JSON.stringify(l.artifact())).not.toContain('someone');
    expect(JSON.stringify(l.artifact())).not.toContain('do not export');
  });

  it('preserves thrown errors and one invocation; delegation completion does not imply an applied change', () => {
    const l = log();
    const failure = new Error('do not log private thrown content');
    const calls: unknown[][] = [];
    const bare = {
      order(o: unknown) {
        calls.push(['order', o]);
        throw failure;
      },
      delegateChoice(event: string, choice: string | null) {
        calls.push(['choice', event, choice]);
      },
      delegateRecord(event: string, option: string | null) {
        calls.push(['record', event, option]);
        if (option !== null) throw failure;
      },
    } as unknown as Parameters<typeof recordActions>[0];
    const actions = recordActions(bare, l);
    const order = { kind: 'seekBook', userText: 'private' } as unknown as Parameters<typeof actions.order>[0];
    expect(() => actions.order(order)).toThrow(failure);
    expect(actions.delegateChoice('unexported-event', null)).toBeUndefined();
    expect(actions.delegateRecord('another-event', null)).toBeUndefined();
    expect(() => actions.delegateRecord('another-event', 'embellish')).toThrow(failure);
    expect(calls).toEqual([
      ['order', order], ['choice', 'unexported-event', null],
      ['record', 'another-event', null], ['record', 'another-event', 'embellish'],
    ]);
    const events = l.events.filter((e) => e.kind === 'action').map(({ at: _at, ...e }) => e);
    expect(events).toEqual([
      { kind: 'action', verb: 'order', act: 'table', category: 'seekBook', status: 'attempted' },
      { kind: 'action', verb: 'order', act: 'table', category: 'seekBook', status: 'threw' },
      { kind: 'action', verb: 'delegateChoice', act: 'delegate', category: 'choice', change: 'clear', status: 'attempted' },
      { kind: 'action', verb: 'delegateChoice', act: 'delegate', category: 'choice', change: 'clear', status: 'returned' },
      { kind: 'action', verb: 'delegateRecord', act: 'delegate', category: 'record', change: 'clear', status: 'attempted' },
      { kind: 'action', verb: 'delegateRecord', act: 'delegate', category: 'record', change: 'clear', status: 'returned' },
      { kind: 'action', verb: 'delegateRecord', act: 'delegate', category: 'record', change: 'set', status: 'attempted' },
      { kind: 'action', verb: 'delegateRecord', act: 'delegate', category: 'record', change: 'set', status: 'threw' },
    ]);
    expect(JSON.stringify(l.artifact())).not.toContain('unexported-event');
    expect(JSON.stringify(l.artifact())).not.toContain('do not log private thrown content');
  });
});

describe('a resumed save is not read twice', () => {
  // The window a resumed view carries is up to sixty pages of history. Before
  // pick-ups were tracked, a save resumed with no play at all logged every
  // answer among them as freshly shown, at t=0.
  it('logs no answer for a resumed window, and counts the next one the reader is shown', async () => {
    const platform = memoryPlatform();
    const bundle = loadBundle();
    const first = createGame(bundle, platform);
    first.actions.begin(1945, 'long');
    if (first.prologue.value) first.actions.enter();
    const answered = (game: ReturnType<typeof createGame>) => () => (game.view.value?.chronicle ?? []).some((e) => e.answer);
    playUntil(first, first.actions, answered(first), 200);
    expect(answered(first)(), 'the first session reached an answer').toBe(true);
    await settle();
    const before = new Set(first.view.value!.chronicle.map((e) => e.id));

    const second = createGame(bundle, platform);
    await settle();
    const l = log();
    const actions = recordActions(second.actions, l);
    const unwatch = watch(() => second.view.value?.chronicle, (pages) => l.chronicle(pages), { immediate: true, flush: 'sync' });
    expect(await actions.resume()).toBe(true);
    expect(l.artifact().summary.answers, 'nothing was shown yet in this session').toBe(0);
    expect(l.events.some((e) => e.kind === 'page' && 'carried' in e && e.carried)).toBe(true);

    const fresh = () => second.view.value!.chronicle.some((e) => e.answer && !before.has(e.id));
    playUntil(second, actions, fresh, 200);
    unwatch();
    expect(fresh(), 'the resumed session reached a new answer').toBe(true);
    const counted = l.events.filter((e) => e.kind === 'page' && e.answer && !('carried' in e && e.carried));
    expect(counted.length).toBeGreaterThan(0);
    expect(counted.every((e) => e.kind === 'page' && !before.has(e.page))).toBe(true);
    expect(l.artifact().summary.answers).toBe(counted.length);
  });
});

describe('watching changes nothing it watches', () => {
  /** The same run, played once with the verbs bare and once through the recorder. */
  async function play(recorded: boolean) {
    const platform = memoryPlatform();
    const game = createGame(loadBundle(), platform);
    const l = recorded ? log() : null;
    const actions = l ? recordActions(game.actions, l) : game.actions;
    actions.begin(1945, 'short');
    if (game.prologue.value) actions.enter();
    for (let i = 0; i < 40; i++) {
      actions.advance(1);
      if (game.outcome.value) actions.dismissOutcome();
      if (game.interlude.value) actions.dismissInterlude();
      while (game.chapter.value) actions.dismissChapter();
      if (game.docket.value.length) actions.letHimDecide();
      if (game.view.value?.namesWanted.length) actions.keepSuggestedNames();
    }
    await settle();
    const save = platform.saves.get('autosave') as Record<string, unknown> | undefined;
    expect(save, 'the run autosaved').toBeDefined();
    return { save: canonical({ ...save, savedAt: '' }), log: l };
  }

  // The save carries the RNG state and the command log, so one identical
  // canonical save is all three — and an identical log replays identically.
  it('leaves the canonical save, the RNG and the command log identical', async () => {
    const bare = await play(false);
    const watched = await play(true);
    expect(watched.save).toBe(bare.save);
    const verbs = watched.log!.events.flatMap((e) => (e.kind === 'action' ? [e.verb] : []));
    expect(verbs, 'the recorder saw the verbs it passed through').toContain('advance');
    expect(verbs).toContain('letHimDecide');
  });
});
