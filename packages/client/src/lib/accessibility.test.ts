// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
