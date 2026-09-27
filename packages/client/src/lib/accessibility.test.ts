// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACCESSIBILITY_STORAGE_KEY,
  SEEN_PROSE_STORAGE_KEY,
  applyAccessibility,
  chapterReplayDisposition,
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


describe('experienced-player Age openings (#258)', () => {
  function storage() {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
  }

  it('shows the first occurrence and records it as seen', () => {
    const s = storage();
    const text = 'The bells had not rung since winter.';

    expect(chapterReplayDisposition(
      s,
      true,
      { kind: 'opening', text },
    )).toBe('show');
    expect(hasSeenProse(s, seenProseKey('chapter-opening', text))).toBe(true);
  });

  it('skips an exact repeat only when the reader opted in', () => {
    const text = 'The bells had not rung since winter.';

    const enabled = storage();
    rememberSeenProse(enabled, seenProseKey('chapter-opening', text));
    expect(chapterReplayDisposition(
      enabled,
      true,
      { kind: 'opening', text },
    )).toBe('skip');

    const disabled = storage();
    rememberSeenProse(disabled, seenProseKey('chapter-opening', text));
    expect(chapterReplayDisposition(
      disabled,
      false,
      { kind: 'opening', text },
    )).toBe('show');
  });

  it('treats changed opening prose as unseen', () => {
    const s = storage();
    const oldText = 'The bells had not rung since winter.';
    const newText = 'The bells had scarcely rung since winter.';
    rememberSeenProse(s, seenProseKey('chapter-opening', oldText));

    expect(chapterReplayDisposition(
      s,
      true,
      { kind: 'opening', text: newText },
    )).toBe('show');
    expect(hasSeenProse(s, seenProseKey('chapter-opening', newText))).toBe(true);
  });

  it('always shows a closing and never records one', () => {
    const s = storage();

    expect(chapterReplayDisposition(
      s,
      true,
      { kind: 'closing' },
    )).toBe('show');
    expect(loadSeenProse(s).size).toBe(0);
  });
});
