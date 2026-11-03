import { expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { place, testWorld } from './testing.js';
import { operationExclusion } from './covert-operations.js';

it('does not learn a covert target from a future-dated Chronicle mention (#2663)', () => {
  const ctx = testWorld(loadContent(), 1042, 1042);
  const person = place(ctx, { sex: 'male', age: 30, name: 'Not Yet Written' });
  // The recognition check precedes the family/availability exclusions. A
  // person with no cast role or prior page starts unknown to this rule.
  expect(operationExclusion(ctx, person)).toBe('unknown');

  const page = {
    year: ctx.world.year + 1, weight: 'line' as const,
    named: true, people: [person.id], text: 'The later page names him.',
  };
  ctx.world.chronicle.push(page);
  expect(operationExclusion(ctx, person)).toBe('unknown');

  // Once the same account exists in the current year, the ordinary later
  // eligibility rules apply (the test person is part of the player family).
  page.year = ctx.world.year;
  expect(operationExclusion(ctx, person)).toBe('family');
});
