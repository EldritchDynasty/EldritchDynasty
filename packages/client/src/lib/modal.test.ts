// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import Line from '../components/Line.vue';

function escapeKey(composing: boolean, keyCode?: number): KeyboardEvent {
  const key = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(key, 'isComposing', { value: composing });
  if (keyCode !== undefined) Object.defineProperty(key, 'keyCode', { value: keyCode });
  return key;
}

describe('shared modal Escape during input-method composition (#1288)', () => {
  it('leaves the modal open when Escape cancels an IME candidate', () => {
    const close = vi.fn();
    const wrapper = mount(Line, {
      attachTo: document.body,
      props: { line: [], close },
    });
    try {
      const composing = escapeKey(true);
      window.dispatchEvent(composing);
      expect(close).not.toHaveBeenCalled();
      expect(composing.defaultPrevented).toBe(false);
      expect(wrapper.get('[role="dialog"]').exists()).toBe(true);

      const normal = escapeKey(false);
      window.dispatchEvent(normal);
      expect(normal.defaultPrevented).toBe(true);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      wrapper.unmount();
    }
  });

  it('ignores the legacy IME process keycode even when isComposing is false', () => {
    const close = vi.fn();
    const wrapper = mount(Line, {
      attachTo: document.body,
      props: { line: [], close },
    });
    try {
      const ime = escapeKey(false, 229);
      window.dispatchEvent(ime);
      expect(close).not.toHaveBeenCalled();
      expect(ime.defaultPrevented).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });
});
