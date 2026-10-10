// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import type { FrameEntry } from '@ed/schema';
import type { GameActions } from '../lib/game';
import Interlude from './Interlude.vue';

describe('Interlude keyboard focus (#937)', () => {
  it('brings forward and reverse Tab back inside when focus escapes the modal', () => {
    // Model a keyboard/extension focus move to the board behind the scrim.
    const outside = document.createElement('button');
    outside.textContent = 'board action';
    document.body.appendChild(outside);

    // The component restores focus on an animation frame during unmount.
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    const dismissInterlude = vi.fn();
    const wrapper = mount(Interlude, {
      attachTo: document.body,
      props: {
        entry: { text: 'The book opens.' } as unknown as FrameEntry,
        actions: { dismissInterlude } as unknown as GameActions,
      },
    });
    try {
      const goOn = wrapper.get('.interlude button').element as HTMLButtonElement;
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
      expect(dismissInterlude).not.toHaveBeenCalled();
    } finally {
      wrapper.unmount();
      outside.remove();
      vi.unstubAllGlobals();
    }
  });
});
