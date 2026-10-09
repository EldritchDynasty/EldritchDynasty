import { describe, expect, it } from 'vitest';
import { loadBundle } from '@ed/content';
import { proseOriginalHash } from '@ed/schema';
import { testWorld } from '@ed/core';
import { coreMessageAddress, msg } from './messages.js';
import { setProseMode, setProseVariants } from './prose.js';

describe('keyed core-message interpolation (#706)', () => {
  it('substitutes upper, lower, mixed-case and repeated placeholders', () => {
    const ctx = testWorld(loadBundle());
    const original = '{HEAD} served {years} years, until {endYear}; {HEAD} remembers {_LEGACY}.';
    expect(msg(ctx, 'test.mixed_case', original, {
      HEAD: 'The Head',
      years: '500',
      endYear: '1542',
      _LEGACY: 'the oath',
    })).toBe('The Head served 500 years, until 1542; The Head remembers the oath.');
  });

  it('rejects missing lower and mixed-case values rather than exposing raw placeholders', () => {
    const ctx = testWorld(loadBundle());
    expect(() => msg(ctx, 'test.missing_years', 'The term lasts {years} years.'))
      .toThrow('Missing {years} in core message test.missing_years');
    expect(() => msg(ctx, 'test.missing_end', 'The term ends at {endYear}.', {
      endyear: '1542',
    })).toThrow('Missing {endYear} in core message test.missing_end');
  });

  it('interpolates reviewed Plain English variants without changing Original mode', () => {
    const ctx = testWorld(loadBundle());
    const key = 'test.rendering';
    const original = '{HEAD} keeps {years} years in the book.';
    const plainenglish = 'For {years} years, {HEAD} keeps the record.';
    setProseVariants(ctx, [{
      address: coreMessageAddress(key),
      of: proseOriginalHash(original),
      plainenglish,
    }]);

    const values = { HEAD: 'Mara', years: '500' };
    expect(msg(ctx, key, original, values)).toBe('Mara keeps 500 years in the book.');

    setProseMode(ctx, 'plainenglish');
    expect(msg(ctx, key, original, values)).toBe('For 500 years, Mara keeps the record.');

    // Token mismatch is rejected by renderProse; the Original remains playable.
    setProseVariants(ctx, [{
      address: coreMessageAddress(key),
      of: proseOriginalHash(original),
      plainenglish: 'For {years} years, Mara keeps the record.',
    }]);
    expect(msg(ctx, key, original, values)).toBe('Mara keeps 500 years in the book.');
  });
});
