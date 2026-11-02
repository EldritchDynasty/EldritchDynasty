// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserPlatform, copyTextInBrowser } from './platform';

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

  it('uses the legacy fallback when the writeText method getter itself throws', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: Object.defineProperty({}, 'writeText', {
        configurable: true,
        get() { throw new DOMException('writeText access denied', 'SecurityError'); },
      }),
    });
    const copied: string[] = [];
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        const area = document.activeElement;
        if (area instanceof HTMLTextAreaElement) {
          copied.push(area.value.slice(area.selectionStart, area.selectionEnd));
        }
        return true;
      }),
    });
    await expect(copyTextInBrowser('ED1.method.blocked')).resolves.toBeUndefined();
    expect(copied).toEqual(['ED1.method.blocked']);
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('still rejects if the Clipboard API getter throws and no fallback exists', async () => {
    refuseClipboardAccess();
    Object.defineProperty(document, 'execCommand', { configurable: true, value: undefined });
    await expect(copyTextInBrowser('ED1.share.code')).rejects.toThrow('this browser cannot copy');
    expect(document.querySelector('textarea')).toBeNull();
  });
});


describe('browser save-slot names (#2502)', () => {
  it('refuses blank slots before storage writes while preserving named opaque saves', async () => {
    const initial = { year: 1200 };
    const entries = new Map<string, string>([['ed:save:autosave', JSON.stringify(initial)]]);
    const setItem = vi.fn((key: string, value: string) => { entries.set(key, value); });
    const storage: Storage = {
      get length() { return entries.size; },
      key: (index: number) => [...entries.keys()][index] ?? null,
      getItem: (key: string) => entries.get(key) ?? null,
      setItem,
      removeItem: (key: string) => { entries.delete(key); },
      clear: () => { entries.clear(); },
    };
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
    try {
      const host = browserPlatform();
      for (const slot of ['', '   ', '\t\n']) {
        await expect(host.writeSave(slot, { year: 1300 })).rejects.toThrow(TypeError);
      }
      expect(setItem).not.toHaveBeenCalled();
      expect(await host.readSave('autosave')).toEqual(initial);
      expect(entries.get('ed:save:autosave')).toBe(JSON.stringify(initial));

      await expect(host.writeSave('demo-autosave', { year: 1300 })).resolves.toBeUndefined();
      expect(await host.readSave('demo-autosave')).toEqual({ year: 1300 });
      expect((await host.listSaves()).map((save) => save.slot).sort())
        .toEqual(['autosave', 'demo-autosave']);
      expect([...entries.keys()].sort()).toEqual(['ed:save:autosave', 'ed:save:demo-autosave']);
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
      else Reflect.deleteProperty(window, 'localStorage');
    }
  });
});
