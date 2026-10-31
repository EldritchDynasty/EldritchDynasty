// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyTextInBrowser } from './platform';

describe('clipboard access fallback (#2049)', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
    Reflect.deleteProperty(document, 'execCommand');
  });

  function refuseClipboardAccess(): void {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      get() { throw new DOMException('clipboard access is blocked', 'SecurityError'); },
    });
  }

  it('uses selected-textarea copy when merely reading the optional Clipboard API throws', async () => {
    refuseClipboardAccess();
    const copied: string[] = [];
    const exec = vi.fn((command: string) => {
      expect(command).toBe('copy');
      const area = document.activeElement;
      if (area instanceof HTMLTextAreaElement) {
        copied.push(area.value.slice(area.selectionStart, area.selectionEnd));
      }
      return true;
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });

    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    try {
      await expect(copyTextInBrowser('ED1.share.code')).resolves.toBeUndefined();
      expect(exec).toHaveBeenCalledTimes(1);
      expect(copied).toEqual(['ED1.share.code']);
      expect(document.querySelector('textarea')).toBeNull();
      expect(document.activeElement).toBe(button);
    } finally {
      button.remove();
    }
  });

  it('still rejects if the Clipboard API getter throws and no fallback exists', async () => {
    refuseClipboardAccess();
    Object.defineProperty(document, 'execCommand', { configurable: true, value: undefined });
    await expect(copyTextInBrowser('ED1.share.code')).rejects.toThrow('this browser cannot copy');
    expect(document.querySelector('textarea')).toBeNull();
  });
});
