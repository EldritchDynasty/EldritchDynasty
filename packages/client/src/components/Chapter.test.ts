// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import Chapter from './Chapter.vue';
import type { ChapterBeat, GameActions } from '../lib/game';
import {
  hasSeenProse,
  loadSeenProse,
  rememberSeenProse,
  seenProseKey,
} from '../lib/accessibility';

function spyActions() {
  return {
    dismissChapter: vi.fn(),
  } as unknown as GameActions;
}

function opening(text: string): ChapterBeat {
  return {
    kind: 'opening',
    opening: { text },
  } as unknown as ChapterBeat;
}

function closing(): ChapterBeat {
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
    const actions = spyActions();
    const text = 'The bells had not rung since winter.';
    const key = seenProseKey('chapter-opening', text);
    const w = mount(Chapter, {
      props: { beat: opening(text), actions, skipSeenProse: true },
    });

    expect(actions.dismissChapter).not.toHaveBeenCalled();
    expect(w.text()).toContain(text);
    expect(hasSeenProse(window.localStorage, key)).toBe(true);
  });

  it('skips an exact repeat when the reader opted in', () => {
    const actions = spyActions();
    const text = 'The bells had not rung since winter.';
    rememberSeenProse(window.localStorage, seenProseKey('chapter-opening', text));

    mount(Chapter, {
      props: { beat: opening(text), actions, skipSeenProse: true },
    });

    expect(actions.dismissChapter).toHaveBeenCalledTimes(1);
  });

  it('does not skip an exact repeat while the preference is off', () => {
    const actions = spyActions();
    const text = 'The bells had not rung since winter.';
    rememberSeenProse(window.localStorage, seenProseKey('chapter-opening', text));

    const w = mount(Chapter, {
      props: { beat: opening(text), actions, skipSeenProse: false },
    });

    expect(actions.dismissChapter).not.toHaveBeenCalled();
    expect(w.text()).toContain(text);
  });

  it('treats changed opening prose as unseen', () => {
    const actions = spyActions();
    const oldText = 'The bells had not rung since winter.';
    const newText = 'The bells had scarcely rung since winter.';
    rememberSeenProse(window.localStorage, seenProseKey('chapter-opening', oldText));

    const w = mount(Chapter, {
      props: { beat: opening(newText), actions, skipSeenProse: true },
    });

    expect(actions.dismissChapter).not.toHaveBeenCalled();
    expect(w.text()).toContain(newText);
    expect(hasSeenProse(
      window.localStorage,
      seenProseKey('chapter-opening', newText),
    )).toBe(true);
  });

  it('never skips or records an Age closing', () => {
    const actions = spyActions();
    const w = mount(Chapter, {
      props: { beat: closing(), actions, skipSeenProse: true },
    });

    expect(actions.dismissChapter).not.toHaveBeenCalled();
    expect(w.text()).toContain('The Quiet Years');
    expect(w.text()).toContain('The house came through with less silver and more names.');
    expect(loadSeenProse(window.localStorage).size).toBe(0);
  });
});
