import { expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { HouseholdThreatS } from '@ed/schema';
import type { SimCtx } from './world.js';
import { addGrudge } from './people/relationships.js';
import { place, testWorld } from './testing.js';
import { covertOpportunities, operationExclusion } from './covert-operations.js';

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


/** A schema-valid observed attack from the next year, as in an inconsistent restored history. */
function futureIdentification(ctx: SimCtx, operative: string) {
  const head = ctx.world.people.living().find((person) => person.castSlots.includes('head'))!;
  const id = 'future_covert_identification_fixture';
  const observationYear = ctx.world.year + 1;
  const threat = HouseholdThreatS.parse({
    plan: {
      id, sponsor: operative, operative, target: head.id,
      motive: { kind: 'grudge', grudge: 'fixture_grudge' },
      site: { kind: 'covert', operation: id }, bindings: {},
      preparation: 'careful', preparedAt: ctx.world.year,
      attemptYear: observationYear, paidCrowns: 0,
    },
    stage: 'resolved',
    defence: { guards: [], response: 'ordinary', paidCrowns: 0 },
    warned: false,
    observation: {
      occurrence: id, year: observationYear, target: head.id,
      result: 'missed', identifiedOperative: operative, witnesses: [],
    },
  });
  ctx.world.covert.threats.push(threat);
  return threat.observation!;
}

it('does not recognise an operative before the saved observation year (#2693)', () => {
  const ctx = testWorld(loadContent(), 2693, 1042);
  const operative = place(ctx, { sex: 'male', age: 30, name: 'Unrecognised Operative' });
  expect(operationExclusion(ctx, operative)).toBe('unknown');

  const observed = futureIdentification(ctx, operative.id);
  expect(operationExclusion(ctx, operative)).toBe('unknown');

  // Recognition becomes valid on its own date, with no new record or mutation.
  ctx.world.year = observed.year;
  expect(operationExclusion(ctx, operative)).toBe('family');
});

it('does not unlock answer_attack from an identification saved in the future (#2693)', () => {
  const ctx = testWorld(loadContent(), 2694, 1042);
  const rival = ctx.world.people.living().find((person) => person.castSlots.includes('rival'))!;
  addGrudge(ctx, ctx.world.playerHouse, rival.id, { severity: 75, inheritance: 'house_wide' });
  const purposes = () => covertOpportunities(ctx).find((o) => o.target.id === rival.id)?.purposes;

  expect(purposes()).toEqual(['settle_grudge']);
  const observed = futureIdentification(ctx, rival.id);
  expect(purposes(), 'a later witness cannot authorise a response today').toEqual(['settle_grudge']);

  observed.year = ctx.world.year;
  expect(purposes(), 'a current identification authorises the response').toEqual(['answer_attack', 'settle_grudge']);
});
