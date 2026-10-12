// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import Chapter from './Chapter.vue';
import type { ChapterBeat, GameActions } from '../lib/game';
import { hasSeenProse, rememberSeenProse, seenProseKey } from '../lib/accessibility';

/** An Age opening records its text as seen on presentation. That new mark
 * must not make a current first reading eligible for a live Skip seen toggle. */
describe('live Skip seen preference on an active Age opening (#1516)', () => {
  const opening = (text: string) =>
    ({ kind: 'opening', opening: { text } } as ChapterBeat);

  it('dismisses a previously read opening once when skipping is enabled in place', async () => {
    const text = 'A familiar Age from the live preference regression.';
    rememberSeenProse(window.localStorage, seenProseKey('chapter-opening', text));
    const dismissChapter = vi.fn();
    const actions = { dismissChapter } as unknown as GameActions;
    const wrapper = mount(Chapter, {
      props: { beat: opening(text), actions, skipSeenProse: false },
    });
    try {
      expect(dismissChapter).not.toHaveBeenCalled();
      await wrapper.setProps({ skipSeenProse: true });
      expect(dismissChapter).toHaveBeenCalledTimes(1);
      // Turning off the setting doesn't change the beat or fire a second order.
      await wrapper.setProps({ skipSeenProse: false });
      expect(dismissChapter).toHaveBeenCalledTimes(1);
    } finally {
      // The shared modal defers focus restoration until the next animation frame.
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => callback(0));
      wrapper.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('does not retrospectively skip an opening first encountered on this card', async () => {
    const text = 'A genuinely new Age opening on the live setting test.';
    const key = seenProseKey('chapter-opening', text);
    const dismissChapter = vi.fn();
    const actions = { dismissChapter } as unknown as GameActions;
    const wrapper = mount(Chapter, {
      props: { beat: opening(text), actions, skipSeenProse: false },
    });
    try {
      // Marking a reading as seen is correct, but it was not a repeat on arrival.
      expect(hasSeenProse(window.localStorage, key)).toBe(true);
      await wrapper.setProps({ skipSeenProse: true });
      expect(dismissChapter).not.toHaveBeenCalled();

      // A successor beat with this same text really IS a repeat.
      await wrapper.setProps({ beat: opening(text) });
      expect(dismissChapter).toHaveBeenCalledTimes(1);
    } finally {
      // The shared modal defers focus restoration until the next animation frame.
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => callback(0));
      wrapper.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('never dismisses an Age closing on a preference toggle', async () => {
    const dismissChapter = vi.fn();
    const actions = { dismissChapter } as unknown as GameActions;
    const closing = {
      kind: 'closing',
      view: { name: 'A named Age', verdict: [{ text: 'A verdict.' }], boundary: false },
    } as ChapterBeat;
    const wrapper = mount(Chapter, {
      props: { beat: closing, actions, skipSeenProse: false },
    });
    try {
      await wrapper.setProps({ skipSeenProse: true });
      expect(dismissChapter).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain('A verdict.');
    } finally {
      // The shared modal defers focus restoration until the next animation frame.
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => callback(0));
      wrapper.unmount();
      vi.unstubAllGlobals();
    }
  });
});
