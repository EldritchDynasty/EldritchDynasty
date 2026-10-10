// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import type { ChapterBeat, GameActions } from '../lib/game';
import Chapter from './Chapter.vue';

describe('Chapter keyboard focus (#939)', () => {
  it.each(['opening', 'closing'] as const)(
    '%s dialog recaptures Tab and Shift+Tab after focus moves behind the scrim',
    (kind) => {
      const outside = document.createElement('button');
      outside.textContent = 'board action';
      document.body.appendChild(outside);
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });

      const dismissChapter = vi.fn();
      const beat = kind === 'opening'
        ? { kind, opening: { text: 'An unnamed Age begins.' } } as unknown as ChapterBeat
        : { kind, view: { name: null, verdict: [], boundary: false } } as unknown as ChapterBeat;
      const wrapper = mount(Chapter, {
        attachTo: document.body,
        props: { beat, actions: { dismissChapter } as unknown as GameActions },
      });

      try {
        const goOn = wrapper.get('.chapter button').element as HTMLButtonElement;
        expect(document.activeElement).toBe(goOn);

        for (const shiftKey of [false, true]) {
          outside.focus();
          expect(document.activeElement).toBe(outside);

          const key = new KeyboardEvent('keydown', {
            key: 'Tab',
            shiftKey,
            bubbles: true,
            cancelable: true,
          });
          window.dispatchEvent(key);

          expect(key.defaultPrevented).toBe(true);
          expect(document.activeElement).toBe(goOn);
        }
        expect(dismissChapter).not.toHaveBeenCalled();
      } finally {
        wrapper.unmount();
        outside.remove();
        vi.unstubAllGlobals();
      }
    },
  );
});
