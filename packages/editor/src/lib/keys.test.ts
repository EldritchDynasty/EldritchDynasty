import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { submitsOnEnter } from './keys';

function press(over: Partial<Pick<KeyboardEvent, 'type' | 'key' | 'isComposing' | 'keyCode' | 'repeat'>> = {}) {
  return { type: 'keydown', key: 'Enter', isComposing: false, keyCode: 13, repeat: false, ...over };
}

describe('an Enter that submits (#1303)', () => {
  it('submits on an ordinary Enter keydown', () => {
    expect(submitsOnEnter(press())).toBe(true);
  });

  it('never submits while an input method is composing, or on the 229 process key', () => {
    expect(submitsOnEnter(press({ isComposing: true }))).toBe(false);
    expect(submitsOnEnter(press({ keyCode: 229 }))).toBe(false);
  });

  it('ignores the late keyup after compositionend, and a held key', () => {
    expect(submitsOnEnter(press({ type: 'keyup' }))).toBe(false);
    expect(submitsOnEnter(press({ repeat: true }))).toBe(false);
  });

  it('is not fooled by another key', () => {
    expect(submitsOnEnter(press({ key: 'a' }))).toBe(false);
  });

  it('is the only way the Sim runner names a child from the keyboard', () => {
    const source = readFileSync(join(import.meta.dirname, '..', 'components', 'SimRunner.vue'), 'utf8');
    expect(source).not.toMatch(/@keyup\.enter/);
    expect(source).toContain("import { submitsOnEnter } from '../lib/keys'");
    expect(source).toMatch(/@keydown\.enter="submitsOnEnter\(\$event\) && commitName\(b\.person\)"/);
  });
});
