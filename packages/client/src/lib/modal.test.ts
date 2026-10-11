// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import { useModal } from './modal';

function mountDialog(close: () => void) {
  const Dialog = defineComponent({
    setup() {
      const card = ref<HTMLElement | null>(null);
      useModal(card, close);
      return () => h('article', {
        ref: card,
        role: 'dialog',
        'aria-modal': 'true',
      }, [h('button', { type: 'button' }, 'Inside')]);
    },
  });
  return mount(Dialog, { attachTo: document.body });
}

function keydown(key: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

describe('stacked modal keyboard handling (#1346)', () => {
  it('Escape dismisses only the top dialog, then the uncovered dialog', () => {
    const closeFirst = vi.fn();
    const closeSecond = vi.fn();
    const first = mountDialog(closeFirst);
    const second = mountDialog(closeSecond);
    let secondMounted = true;
    try {
      keydown('Escape');
      expect(closeSecond).toHaveBeenCalledTimes(1);
      expect(closeFirst).not.toHaveBeenCalled();

      second.unmount();
      secondMounted = false;
      keydown('Escape');
      expect(closeFirst).toHaveBeenCalledTimes(1);
      expect(closeSecond).toHaveBeenCalledTimes(1);
    } finally {
      if (secondMounted) second.unmount();
      first.unmount();
    }
  });

  it('Tab cannot focus a control in a covered dialog', () => {
    const first = mountDialog(vi.fn());
    const second = mountDialog(vi.fn());
    try {
      const background = first.get('button').element as HTMLButtonElement;
      const foreground = second.get('button').element as HTMLButtonElement;
      const backgroundFocus = vi.spyOn(background, 'focus');
      foreground.focus();

      keydown('Tab');

      expect(backgroundFocus).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(foreground);
    } finally {
      second.unmount();
      first.unmount();
      vi.restoreAllMocks();
    }
  });
});
