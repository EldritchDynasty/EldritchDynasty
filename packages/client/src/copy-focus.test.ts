import { describe, expect, it, vi } from 'vitest';
import { copyTextInBrowser } from './platform.js';

describe('fallback clipboard copy preserves focus (#2034)', () => {
  it.each([
    { allowed: true, restoreThrows: false },
    { allowed: false, restoreThrows: false },
    { allowed: true, restoreThrows: true },
    { allowed: false, restoreThrows: true },
  ])('preserves clipboard result (copy succeeds=$allowed, focus restore throws=$restoreThrows)', async ({ allowed, restoreThrows }) => {
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const originalHTMLElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');

    let active: unknown;
    // A focusable SVG control has a focus method but is not an HTMLElement.
    const svgControl = { focus: vi.fn(() => {
      if (restoreThrows) throw new Error('control was torn down');
      active = svgControl;
    }) };
    active = svgControl;
    const area = {
      value: '',
      style: {} as Record<string, string>,
      setAttribute: vi.fn(),
      focus: vi.fn(() => { active = area; }),
      select: vi.fn(),
      remove: vi.fn(),
    };
    const documentMock = {
      get activeElement() { return active; },
      createElement: vi.fn(() => area),
      body: { appendChild: vi.fn() },
      execCommand: vi.fn(() => allowed),
    };
    Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: class FakeHTMLElement {} });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: documentMock });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('clipboard denied')) } },
    });
    try {
      if (allowed) await expect(copyTextInBrowser('ED1.example')).resolves.toBeUndefined();
      else await expect(copyTextInBrowser('ED1.example')).rejects.toThrow('the browser refused to copy');

      expect(documentMock.execCommand).toHaveBeenCalledWith('copy');
      expect(documentMock.body.appendChild).toHaveBeenCalledWith(area);
      expect(area.focus).toHaveBeenCalledOnce();
      expect(area.select).toHaveBeenCalledOnce();
      expect(area.remove).toHaveBeenCalledOnce();
      expect(svgControl.focus).toHaveBeenCalledOnce();
      // A failed focus restoration must never erase a successful copy or
      // replace an original copy rejection with a cleanup error.
      expect(active).toBe(restoreThrows ? area : svgControl);
    } finally {
      for (const [key, descriptor] of [
        ['document', originalDocument],
        ['navigator', originalNavigator],
        ['HTMLElement', originalHTMLElement],
      ] as const) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });
});


describe('fallback clipboard copy inside open shadow roots (#2396)', () => {
  it('restores the innermost focused control, not its unfocusable shadow host', async () => {
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

    let active: unknown;
    const inner = { focus: vi.fn(() => { active = outer; }) };
    const middle = { shadowRoot: { activeElement: inner }, focus: vi.fn() };
    const outer = { shadowRoot: { activeElement: middle }, focus: vi.fn() };
    active = outer;
    const area = {
      value: '',
      style: {} as Record<string, string>,
      setAttribute: vi.fn(),
      focus: vi.fn(() => { active = area; }),
      select: vi.fn(),
      remove: vi.fn(),
    };
    const command = vi.fn(() => true);
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        get activeElement() { return active; },
        createElement: vi.fn(() => area),
        body: { appendChild: vi.fn() },
        execCommand: command,
      },
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('clipboard denied')) } },
    });

    try {
      await expect(copyTextInBrowser('ED1.shadow-copy')).resolves.toBeUndefined();
      expect(command).toHaveBeenCalledExactlyOnceWith('copy');
      expect(area.remove).toHaveBeenCalledOnce();
      expect(inner.focus).toHaveBeenCalledOnce();
      expect(middle.focus).not.toHaveBeenCalled();
      expect(outer.focus).not.toHaveBeenCalled();
      // document.activeElement still reports the host; the innermost focus
      // receiver is what matters inside nested open roots.
      expect(active).toBe(outer);
    } finally {
      for (const [key, descriptor] of [
        ['document', originalDocument],
        ['navigator', originalNavigator],
      ] as const) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });
});
