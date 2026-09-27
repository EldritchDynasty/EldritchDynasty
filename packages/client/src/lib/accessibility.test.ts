// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrologueView } from '@ed/core';
import Prologue from '../components/Prologue.vue';
import type { GameActions } from './game';
import {
  ACCESSIBILITY_STORAGE_KEY,
  SEEN_PROSE_STORAGE_KEY,
  applyAccessibility,
  chapterReplayDisposition,
  hasSeenProse,
  loadAccessibility,
  loadSeenProse,
  rememberSeenProse,
  replayDisposition,
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


describe('experienced-reader replay beyond Age openings (#267)', () => {
  function storage() {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
  }

  const prologueText = [
    'The room was cold.',
    'A key was given.', 'The door would remember it.',
    'A name was given.', 'The book would keep it.',
    'A line was given.', 'The line would be collected.',
    'What was signed was inherited.',
  ].join('\u0000');

  it('fast-reveals only an exact repeated prologue when the reader opted in', () => {
    const s = storage();
    const beat = { kind: 'prologue' as const, text: prologueText };
    const key = seenProseKey('prologue', prologueText);

    expect(replayDisposition(s, true, beat)).toBe('show');
    expect(hasSeenProse(s, key), 'merely mounting the prologue must not mark it read').toBe(false);

    rememberSeenProse(s, key);
    expect(replayDisposition(s, true, beat)).toBe('fast');
    expect(replayDisposition(s, false, beat)).toBe('show');
    expect(replayDisposition(s, true, {
      kind: 'prologue',
      text: prologueText.replace('cold', 'very cold'),
    })).toBe('show');
  });

  it('marks a repeated authored scene without hiding it or depending on the skip preference', () => {
    const s = storage();
    const scene = {
      kind: 'scene' as const,
      event: 'the_same_room',
      authored: '{HEIR} finds the old key under the ledger.',
    };

    expect(replayDisposition(s, false, scene)).toBe('show');
    expect(replayDisposition(s, true, scene)).toBe('mark');

    // Filled names are deliberately not an input to the identity. The same
    // authored scene is still the same scene when a different heir fills it.
    expect(replayDisposition(s, false, scene)).toBe('mark');

    expect(replayDisposition(s, true, {
      ...scene,
      authored: '{HEIR} finds the old key beside the ledger.',
    })).toBe('show');
  });
});

describe('the prologue earns its seen mark only after it is read (#267)', () => {
  const prologue: PrologueView = {
    id: 'the_signing',
    opening: 'The room was cold.',
    triad: [
      { given: 'A key was given.', owed: 'The door would remember it.' },
      { given: 'A name was given.', owed: 'The book would keep it.' },
      { given: 'A line was given.', owed: 'The line would be collected.' },
    ],
    housePrompt: 'What will the family be called?',
    friendsPrompt: 'Name those who stood outside the blood.',
    friendsWanted: 0,
    heirlooms: [{
      heirloom: 'the_key',
      name: 'The Key',
      blurb: 'Iron, and colder than the room.',
      line: 'He asked for the key.',
    }],
    grudges: [{
      house: 'house_marrow',
      houseName: 'House Marrow',
      line: 'They paid the balance.',
    }],
    thesis: 'What was signed was inherited.',
  };

  const exactText = [
    prologue.opening,
    ...prologue.triad.flatMap((beat) => [beat.given, beat.owed]),
    prologue.thesis,
  ].join('\u0000');

  function actions() {
    return {
      found: vi.fn(() => ({ ok: true })),
      enter: vi.fn(),
    } as unknown as GameActions;
  }

  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal('scrollTo', vi.fn());
  });

  it('does not remember a half-read signing, then remembers the third revealed beat', async () => {
    const game = actions();
    const wrapper = mount(Prologue, {
      props: {
        prologue,
        actions: game,
        refused: null,
        startYear: 1042,
        skipSeenProse: true,
      },
    });
    const key = seenProseKey('prologue', exactText);

    await wrapper.get('button.on').trigger('click');
    await wrapper.get('button.on').trigger('click');
    expect(hasSeenProse(window.localStorage, key)).toBe(false);

    await wrapper.get('button.on').trigger('click');
    expect(hasSeenProse(window.localStorage, key)).toBe(true);
    expect((game.found as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('fast-reveals passive beats but still requires every founding answer before Sign it', async () => {
    rememberSeenProse(window.localStorage, seenProseKey('prologue', exactText));
    const game = actions();
    const wrapper = mount(Prologue, {
      props: {
        prologue,
        actions: game,
        refused: null,
        startYear: 1042,
        skipSeenProse: true,
      },
    });

    expect(wrapper.findAll('.triad li')).toHaveLength(3);
    expect(wrapper.findAll('button').some((button) => button.text() === 'The first thing')).toBe(false);
    expect((game.found as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((game.enter as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();

    const sign = wrapper.get('button.sign');
    expect(sign.attributes('disabled')).toBeDefined();

    const options = wrapper.findAll('button.option');
    await options[0]!.trigger('click');
    await options[1]!.trigger('click');
    await wrapper.get('input[aria-label="Name the house"]').setValue('House Test');

    expect(wrapper.get('button.sign').attributes('disabled')).toBeUndefined();
    await wrapper.get('button.sign').trigger('click');

    expect((game.found as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect((game.enter as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
