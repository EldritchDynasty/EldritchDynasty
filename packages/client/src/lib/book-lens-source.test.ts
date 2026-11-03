import { describe, expect, it } from 'vitest';
import { LENSES, PLAIN_LENS_LABELS, type Lens } from './book.js';

describe('Chronicle lens catalogue (#2639)', () => {
  it('has one unique visible choice for each translated lens', () => {
    // Do not duplicate the closed lens vocabulary in this test: adding a
    // displayed choice must make its type and Plain English label follow.
    const ids: Lens[] = LENSES.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(PLAIN_LENS_LABELS).sort()).toEqual([...ids].sort());
    expect(LENSES.every(({ label }) => label.trim().length > 0)).toBe(true);
    expect(ids.every((id) => PLAIN_LENS_LABELS[id].trim().length > 0)).toBe(true);
  });
});
