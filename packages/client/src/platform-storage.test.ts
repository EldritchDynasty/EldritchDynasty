import { describe, expect, it } from 'vitest';
import { browserPlatform } from './platform.js';

describe('browser save enumeration failure (#1234)', () => {
  it('rejects a failed Storage.length read instead of reporting that saved runs vanished', async () => {
    const values = new Map([
      ['ed:save:chapter-1-1080', JSON.stringify({ format: 28, year: 1080 })],
      ['ed:save:unreadable', '{bad JSON'],
    ]);
    let enumerationFails = false;
    const storage = {
      get length() {
        if (enumerationFails) throw new Error('save enumeration unavailable');
        return values.size;
      },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
      clear: () => values.clear(),
    } as Storage;

    const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: storage },
    });
    try {
      const platform = browserPlatform();
      const known = [
        { slot: 'chapter-1-1080', year: 1080, format: 28, savedAt: undefined },
        { slot: 'unreadable' },
      ];
      await expect(platform.listSaves()).resolves.toEqual(known);

      enumerationFails = true;
      await expect(platform.listSaves()).rejects.toThrow('save enumeration unavailable');
      expect(values.size).toBe(2);

      enumerationFails = false;
      await expect(platform.listSaves()).resolves.toEqual(known);
    } finally {
      if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow);
      else Reflect.deleteProperty(globalThis, 'window');
    }
  });

  it('still returns healthy slots if one Storage.key lookup throws', async () => {
    const storage = {
      get length() { return 3; },
      key(index: number) {
        if (index === 1) throw new Error('one key unavailable');
        return ['ed:save:good', 'ed:save:skipped', 'ed:save:other'][index] ?? null;
      },
      getItem(key: string) {
        if (key === 'ed:save:good') return JSON.stringify({ year: 1190 });
        if (key === 'ed:save:other') throw new Error('one unreadable save');
        return null;
      },
    } as Storage;

    const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: storage },
    });
    try {
      await expect(browserPlatform().listSaves()).resolves.toEqual([
        { slot: 'good', year: 1190, savedAt: undefined, format: undefined },
        { slot: 'other' },
      ]);
    } finally {
      if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow);
      else Reflect.deleteProperty(globalThis, 'window');
    }
  });
});
