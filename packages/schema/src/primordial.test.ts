import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadContent } from '@ed/content';
import { OutcomeS, type Outcome } from './event.js';
import { potentialHarms, primordialChance, primordialInventory } from './primordial.js';

describe('emergency contract (#1868)', () => {
  it('audits every ordinary outcome independently of optional response tags', () => {
    const rows = primordialInventory(loadContent().bundle.events);
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/primordial-inventory.json', import.meta.url), 'utf8'));
    expect(rows).toEqual(fixture);
    expect(rows.some(row => row.candidates.includes('life'))).toBe(true);
  });

  it('aggregates cash and standing, retaining a small shock that can cause first debt', () => {
    expect(potentialHarms({ effects: [{ kind: 'treasury', delta: -1 }] })).toEqual(['financial']);
    expect(potentialHarms({ effects: [{ kind: 'respect', delta: -1 }, { kind: 'respect', delta: -1 }] })).toEqual(['political']);
    expect(potentialHarms({ effects: [{ kind: 'treasury', delta: -90 }, { kind: 'treasury', delta: 90 }] })).toEqual([]);
  });

  it('excludes an agreed effect without exempting an unrelated casualty', () => {
    const o: Pick<Outcome, 'effects' | 'agreedPrices'> = {
      effects: [{ kind: 'treasury', delta: -90 }, { kind: 'status', target: 'head', status: 'dead' }],
      agreedPrices: [{ effect: 0, reason: 'purchase' }],
    };
    expect(potentialHarms(o)).toEqual(['life']);
  });

  it('requires complete, non-recursive responses and both prose modes', () => {
    const normal = { id: 'fall', text: 'A fall.', effects: [] };
    const response = { id: 'caught', text: '{PRIMORDIAL_ACTOR} caught him.', plainEnglish: '{PRIMORDIAL_ACTOR} saved him.', effects: [], record: null };
    expect(OutcomeS.safeParse({ ...normal, primordial: response }).success).toBe(true);
    expect(OutcomeS.safeParse({ ...normal, primordial: { ...response, primordial: response } }).success).toBe(false);
    expect(OutcomeS.safeParse({ ...normal, primordial: { ...response, plainEnglish: undefined } }).success).toBe(false);
  });

  it('never makes even a 100 EP actor certain', () => {
    expect([0, 20, 60, 90, 100, 200].map(primordialChance)).toEqual([0, .2, .6, .9, .9, .9]);
  });
});
