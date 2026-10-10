import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { PendingDecisionS, type EventTemplate } from '@ed/schema';
import { castRequests } from './events/decisions.js';
import { place, marry, beget, testWorld } from './testing.js';
import type { SimCtx } from './world.js';

const bundle = loadContent();

/**
 * THE VESSEL DECISION SURFACE (issue #28 item 2).
 *
 * `the_vessel_rite` asks the house to name a relative and never said what
 * spending them costs the family's next generation. `showLine: true` on a
 * slot answers that with exactly the matchmaker's panel's epistemics (issue
 * #68) — her mother and sisters, named, with what the record credits to
 * them — attached to `CastRequest.candidates` rather than reimplemented for
 * the docket. What is asserted here is the wiring: a slot that asks for the
 * read gets it, a slot that does not is untouched, and no test elsewhere
 * needs to know `castRequests` reaches into `people/panel.ts` to do it.
 */

/** A bare single-slot template — nothing about it says "Vessel" on purpose. */
function template(showLine: boolean): EventTemplate {
  return {
    id: 'test_observed_line',
    slots: {
      WHO: {
        role: 'family_member', castBy: 'player', optional: false, bind: 'event', filters: [],
        ...(showLine ? { showLine: true } : {}),
      },
    },
    body: 'The house is asked to name {WHO}.',
  } as unknown as EventTemplate;
}

describe('the observed-line read on a cast request', () => {
  it('attaches her mother and sisters when the slot asks for it, and leaves candidates alone when it does not', () => {
    const ctx: SimCtx = testWorld(bundle, 5200, 1200);
    const mother = place(ctx, { sex: 'female', age: 60, name: 'Cesse' });
    const father = place(ctx, { sex: 'male', age: 62, name: 'Faro' });
    marry(ctx, mother, father);
    const candidate = place(ctx, { sex: 'female', age: 20, name: 'Dala' });
    beget(ctx, candidate, mother, father);
    const youngSibling = place(ctx, { sex: 'female', age: 10, name: 'Enna' });
    beget(ctx, youngSibling, mother, father);

    const withLine = castRequests(template(true), ctx, {}, ['WHO']);
    const dala = withLine[0]!.candidates.find((c) => c.name === 'Dala');
    expect(dala, 'the placed candidate should be in the pool').toBeDefined();
    const row = dala!.issue?.find((r) => r.name === 'Cesse');
    expect(row, 'her mother is a completed life and belongs on the read').toBeDefined();
    // Two children counted (Dala herself and Enna), one of them grown.
    expect(row!.borne).toBe(2);
    expect(row!.grown).toBe(1);
    expect(row!.relation).toBe('her mother');

    const withoutLine = castRequests(template(false), ctx, {}, ['WHO']);
    const dalaPlain = withoutLine[0]!.candidates.find((c) => c.name === 'Dala');
    expect(dalaPlain?.issue).toBeUndefined();
  });

  it('reads empty, not missing, for a candidate the pedigree does not reach', () => {
    const ctx: SimCtx = testWorld(bundle, 5201, 1200);
    // No claimed mother at all — a founder-shaped person.
    const orphan = place(ctx, { sex: 'male', age: 30, name: 'Bertran' });

    const reqs = castRequests(template(true), ctx, {}, ['WHO']);
    const row = reqs[0]!.candidates.find((c) => c.id === orphan.id);
    expect(row?.issue).toEqual([]);
  });

  it('never exposes fecundity, a locus, or anything else off the genome', () => {
    const ctx: SimCtx = testWorld(bundle, 5202, 1200);
    const mother = place(ctx, { sex: 'female', age: 60, name: 'Cesse' });
    const father = place(ctx, { sex: 'male', age: 62, name: 'Faro' });
    marry(ctx, mother, father);
    const candidate = place(ctx, { sex: 'female', age: 20, name: 'Dala' });
    beget(ctx, candidate, mother, father);

    const reqs = castRequests(template(true), ctx, {}, ['WHO']);
    const row = reqs[0]!.candidates.find((c) => c.id === candidate.id);
    for (const issueRow of row?.issue ?? []) {
      // `kin` is `relation` as data (#1005): who she is to the candidate, off
      // the claimed pedigree. Public, and nothing to do with the genome.
      expect(Object.keys(issueRow).sort()).toEqual(['borne', 'grown', 'kin', 'name', 'relation']);
    }
  });

  /**
   * AND IT SURVIVES A SAVE. The docket is what `PendingDecisionS` persists,
   * so a candidate's `issue` rows have to reach `CastRequestS` intact rather
   * than being silently stripped as an unrecognised key — the exact failure
   * `MatchCard.line`/`lineSeen` were written up against on this same issue.
   */
  it('round-trips through the save schema', () => {
    const event = loadContent().bundle.events.find((e) => e.interaction.kind === 'choice');
    expect(event, 'the fixture content needs at least one choice event').toBeDefined();

    const persisted = PendingDecisionS.parse({
      kind: 'choice',
      id: 'dec_1',
      year: 1200,
      event,
      body: 'test',
      fill: {},
      cast: [{
        slot: 'WHO',
        optional: false,
        candidates: [{
          id: 'p_1',
          name: 'Dala',
          age: 20,
          issue: [{ name: 'Cesse', relation: 'her mother', borne: 2, grown: 1 }],
        }],
      }],
      choices: [],
    });

    if (persisted.kind !== 'choice') throw new Error('parsed the wrong kind');
    expect(persisted.cast[0]!.candidates[0]!.issue).toEqual([
      { name: 'Cesse', relation: 'her mother', borne: 2, grown: 1 },
    ]);
  });
});
