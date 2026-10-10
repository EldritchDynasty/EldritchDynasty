import { describe, expect, it } from 'vitest';
import { loadBundle } from '@ed/content';
import { msg } from './messages.js';
import { testWorld } from './testing.js';

describe('core message interpolation', () => {
  it('rejects inherited prototype properties as missing placeholder values (#861)', () => {
    const ctx = testWorld(loadBundle());
    for (const name of ['constructor', 'toString', '__proto__']) {
      const original = `A message about {${name}}.`;
      expect(() => msg(ctx, 'test.own-values', original, {}))
        .toThrow(`Missing {${name}} in core message test.own-values`);
    }
  });

  it('still substitutes explicitly supplied values with prototype-like names', () => {
    const ctx = testWorld(loadBundle());
    expect(msg(ctx, 'test.constructor', 'The {constructor} replied.', { constructor: 'court' }))
      .toBe('The court replied.');

    const values: Record<string, string> = Object.create(null);
    Object.defineProperty(values, '__proto__', { value: 'family', enumerable: true });
    Object.defineProperty(values, 'toString', { value: 'chronicle', enumerable: true });
    expect(msg(ctx, 'test.null-prototype', 'The {__proto__} read the {toString}.', values))
      .toBe('The family read the chronicle.');
  });
});
