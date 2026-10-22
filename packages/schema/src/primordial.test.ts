import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadContent } from '@ed/content';
import { OutcomeS, type Outcome } from './event.js';
import { runRule } from './validate.js';
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

  it('requires complete, non-recursive responses', () => {
    const normal = { id: 'fall', text: 'A fall.', effects: [] };
    const response = { id: 'caught', text: '{PRIMORDIAL_ACTOR} caught him.', effects: [], record: null };
    expect(OutcomeS.safeParse({ ...normal, primordial: response }).success).toBe(true);
    expect(OutcomeS.safeParse({ ...normal, primordial: { ...response, primordial: response } }).success).toBe(false);

  });

  it('rejects missing or stale Plain English through the shared catalogue', () => {
    const source = structuredClone(loadContent().bundle);
    const event = source.events.find(e => e.id === 'the_hall_burns')!;
    source.proseVariants = source.proseVariants.filter(row => !row.address.includes('events[id=the_hall_burns]') || !row.address.endsWith('.primordial.text'));
    expect(runRule('primordial/coverage', source).some(issue => issue.message.includes('Plain English'))).toBe(true);
  });

  it('never makes even a 100 EP actor certain', () => {
    expect([0, 20, 60, 90, 100, 200].map(primordialChance)).toEqual([0, .2, .6, .9, .9, .9]);
  });

  for (const category of ['life', 'financial', 'estate', 'inheritance', 'political'] as const) {
    it(`names the exact missing ${category} response even without any optional tag`, () => {
      const source = loadContent();
      const bundle = structuredClone(source.bundle);
      const row = bundle.events.flatMap(event => {
        const groups = event.interaction.kind === 'narration' ? [{ id: '_', outcomes: event.interaction.outcomes }] : event.interaction.choices;
        return groups.flatMap(choice => choice.outcomes.map(outcome => ({ event, choice, outcome })));
      }).find(row => row.outcome.primordial && potentialHarms(row.outcome).includes(category))!;
      delete row.outcome.primordial;
      row.outcome.tags = [];
      expect(runRule('primordial/coverage', bundle)).toContainEqual(expect.objectContaining({
        level: 'error', where: `event:${row.event.id}/${row.choice.id}/${row.outcome.id}`,
      }));
    });
  }

  it('rejects an unknown site, cosmetic response, unresolved actor, and forged price exemption', () => {
    const bundle = structuredClone(loadContent().bundle);
    const event = bundle.events.find(e => e.id === 'the_hall_burns')!;
    const o = event.interaction.kind === 'narration' ? event.interaction.outcomes[0]! : event.interaction.choices[0]!.outcomes[0]!;
    delete o.site; delete event.site;
    expect(runRule('primordial/site', bundle).some(issue => issue.where.includes(event.id))).toBe(true);
    o.primordial!.effects = o.effects;
    o.primordial!.text = 'A power helped.';
    expect(runRule('primordial/coverage', bundle).filter(issue => issue.where.includes(event.id)).map(issue => issue.message))
      .toEqual(expect.arrayContaining([expect.stringContaining('cosmetic'), expect.stringContaining('PRIMORDIAL_ACTOR')]));
    o.agreedPrices = [{ effect: 9000, reason: 'purchase' }];
    expect(runRule('primordial/coverage', bundle).some(issue => issue.message.includes('validated agreed price'))).toBe(true);
  });
});
