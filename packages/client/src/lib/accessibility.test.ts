// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mount } from '@vue/test-utils';
import Chapter from '../components/Chapter.vue';
import type { ChapterBeat, GameActions } from './game';
import {
  ACCESSIBILITY_STORAGE_KEY,
  SEEN_PROSE_STORAGE_KEY,
  applyAccessibility,
  hasSeenProse,
  loadAccessibility,
  loadSeenProse,
  rememberSeenProse,
  saveAccessibility,
  seenProseKey,
  type AccessibilityPreferences,
} from './accessibility';

describe('reading preferences', () => {
  it('round-trips and applies the reader\'s choices', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const wanted: AccessibilityPreferences = {
      textScale: 'largest',
      readingFont: 'readable',
      skipSeenProse: true,
    };

    saveAccessibility(storage, wanted);
    expect(values.has(ACCESSIBILITY_STORAGE_KEY)).toBe(true);
    expect(loadAccessibility(storage)).toEqual(wanted);

    applyAccessibility(document.documentElement, wanted);
    expect(document.documentElement.dataset.textScale).toBe('largest');
    expect(document.documentElement.dataset.readingFont).toBe('readable');
    expect(document.documentElement.style.fontSize).toBe('130%');
  });

  it('falls back safely when stored data is stale or malformed', () => {
    expect(loadAccessibility({ getItem: () => '{broken' })).toEqual({
      textScale: 'standard',
      readingFont: 'book',
      skipSeenProse: false,
    });
    expect(loadAccessibility({ getItem: () => JSON.stringify({ textScale: 'huge' }) })).toEqual({
      textScale: 'standard',
      readingFont: 'book',
      skipSeenProse: false,
    });
  });
});

describe('the stylesheet preserves non-visual preferences', () => {
  const css = readFileSync(join(import.meta.dirname, '..', 'styles.css'), 'utf8');

  it('honours reduced motion and forced colours', () => {
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css).toMatch(/forced-colors:\s*active/);
  });

  it('offers two enlarged scales and a readable face', () => {
    expect(css).toContain("data-text-scale='large'");
    expect(css).toContain("data-text-scale='largest'");
    expect(css).toContain("data-reading-font='readable'");
  });
});


describe('seen passive prose', () => {
  it('remembers exact prose and treats a changed variant as unseen', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const first = seenProseKey('chapter-opening', 'The bells were quiet.');
    const changed = seenProseKey('chapter-opening', 'The bells were almost quiet.');

    rememberSeenProse(storage, first);

    expect(values.has(SEEN_PROSE_STORAGE_KEY)).toBe(true);
    expect(hasSeenProse(storage, first)).toBe(true);
    expect(hasSeenProse(storage, changed)).toBe(false);
    expect(loadSeenProse(storage)).toEqual(new Set([first]));
  });

  it('falls back to an empty history when the stored history is malformed', () => {
    expect(loadSeenProse({ getItem: () => '{broken' })).toEqual(new Set());
  });
});


function chapterActions() {
  return {
    dismissChapter: vi.fn(),
  } as unknown as GameActions;
}

function openingBeat(text: string): ChapterBeat {
  return {
    kind: 'opening',
    opening: { text },
  } as unknown as ChapterBeat;
}

function closingBeat(): ChapterBeat {
  return {
    kind: 'closing',
    view: {
      name: 'The Quiet Years',
      verdict: [{ text: 'The house came through with less silver and more names.' }],
      boundary: true,
    },
  } as unknown as ChapterBeat;
}

describe('experienced-player Age openings (#258)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('always shows the first occurrence and records its exact prose as seen', () => {
    const actions = chapterActions();
    const text = 'The bells had not rung since winter.';
    const key = seenProseKey('chapter-opening', text);
    const w = mount(Chapter, {
      props: { beat: openingBeat(text), actions, skipSeenProse: true },
    });

    expect(actions.dismissChapter).not.toHaveBeenCalled();
    expect(w.text()).toContain(text);
    expect(hasSeenProse(window.localStorage, key)).toBe(true);
  });

  it('skips an exact repeat only when the reader opted in', () => {
    const text = 'The bells had not rung since winter.';
    rememberSeenProse(window.localStorage, seenProseKey('chapter-opening', text));

    const enabled = chapterActions();
    mount(Chapter, {
      props: { beat: openingBeat(text), actions: enabled, skipSeenProse: true },
    });
    expect(enabled.dismissChapter).toHaveBeenCalledTimes(1);

    const disabled = chapterActions();
    const w = mount(Chapter, {
      props: { beat: openingBeat(text), actions: disabled, skipSeenProse: false },
    });
    expect(disabled.dismissChapter).not.toHaveBeenCalled();
    expect(w.text()).toContain(text);
  });

  it('treats changed opening prose as unseen', () => {
    const actions = chapterActions();
    const oldText = 'The bells had not rung since winter.';
    const newText = 'The bells had scarcely rung since winter.';
    rememberSeenProse(window.localStorage, seenProseKey('chapter-opening', oldText));

    const w = mount(Chapter, {
      props: { beat: openingBeat(newText), actions, skipSeenProse: true },
    });

    expect(actions.dismissChapter).not.toHaveBeenCalled();
    expect(w.text()).toContain(newText);
    expect(hasSeenProse(
      window.localStorage,
      seenProseKey('chapter-opening', newText),
    )).toBe(true);
  });

  it('never skips or records an Age closing', () => {
    const actions = chapterActions();
    const w = mount(Chapter, {
      props: { beat: closingBeat(), actions, skipSeenProse: true },
    });

    expect(actions.dismissChapter).not.toHaveBeenCalled();
    expect(w.text()).toContain('The Quiet Years');
    expect(w.text()).toContain('The house came through with less silver and more names.');
    expect(loadSeenProse(window.localStorage).size).toBe(0);
  });
});
