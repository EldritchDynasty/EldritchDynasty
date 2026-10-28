import { describe, expect, it } from 'vitest';
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
    const detach = attachReadingLog(l, doc, win);
    fire('pagehide');
    expect(l.ended).toBe('unloaded');
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
    expect(artifact).toMatchObject({ format: 'ed-reading-log/1', build: BUILD, startedAt: '2026-10-28T00:00:00.000Z' });
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
