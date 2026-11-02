import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { indexContent } from '@ed/schema';
import type { PendingChoice } from '../events/decisions.js';
import { newGame } from '../session.js';
import { nameScion } from './ladder-policy.js';
import { buryOption, emptyDiagnosis, playSummitRoute, routeReplays, summariseRoutes, wantedPair, type RouteRun } from './summit-route.js';

const bundle = loadContent();
const content = indexContent(bundle);

describe('the summit route is played through the public session (#1978)', () => {
  // A bounded horizon: the property is about HOW the house is played, not how
  // far it climbs, so forty years of signing, standing orders, docket answers
  // and naming are enough to catch a policy that writes the world directly.
  const run = playSummitRoute(content, 197800, { years: 40 });

  it('signs, chooses the ascent, then sets its standing orders as accepted Table orders', () => {
    expect(run.acts[0]).toMatchObject({ verb: 'found', ok: true });
    expect(run.acts[1]).toMatchObject({ verb: 'ambition', what: 'raise_ascendant', ok: true });
    expect(run.acts.find(a => a.what === 'marriages')).toMatchObject({ verb: 'order', ok: true });
    expect(run.acts.find(a => a.what === 'bid')).toMatchObject({ verb: 'order', ok: true });
    expect(run.commands.advance).toBeGreaterThanOrEqual(40);
  });

  it('leaves a log that replay rebuilds to the identical world', () => {
    // `replay` re-derives its own decision log through the session verbs and
    // throws on the first divergence; a policy that changed the world other
    // than through a logged command could not pass this.
    expect(routeReplays(bundle, run)).toBe(true);
  });

  it('keeps the named Scion only through the logged order', () => {
    const named = run.acts.filter(a => a.what === 'scion' && a.ok).at(-1)?.person;
    expect(named).toBeDefined();
    expect(run.saved.scion).toBe(named);
  });
});

describe('the route policy reads without writing (#1978)', () => {
  it('computes the ascendant pair and puts the world back', () => {
    const s = newGame(content, { seed: 197801, campaign: 'long', decider: 'ask' });
    s.advance(20);
    s.letHimDecide();
    const before = { scion: s.ctx.world.scion, heir: s.ctx.world.scionHeir };
    const want = wantedPair(s);
    expect({ scion: s.ctx.world.scion, heir: s.ctx.world.scionHeir }).toEqual(before);

    // The same answer the shared rule gives when it is allowed to write.
    nameScion(s.ctx);
    expect(want.scion).toBe(s.ctx.world.scion ?? null);
  });

  it('recognises an offered option that buries an open lie, and nothing else', () => {
    const event = content.events.find(e => e.interaction.kind !== 'narration'
      && e.interaction.choices.some(c => c.outcomes.length > 0
        && c.outcomes.every(o => o.effects.some(f => f.kind === 'discrepancy' && f.op === 'bury'))));
    expect(event, 'the shipped content authors at least one burying choice').toBeDefined();
    if (!event || event.interaction.kind === 'narration') return;
    const choices = event.interaction.choices.map(c => ({ id: c.id, available: true }));
    const pending = (over: Record<string, unknown>) => ({
      kind: 'choice', id: 'd-1', event, choicesAreOpen: true, choices, ...over,
    }) as unknown as PendingChoice;
    const burying = buryOption(pending({}));
    expect(burying).toBeDefined();
    // An option the docket does not offer this year is not an answer.
    expect(buryOption(pending({ choices: choices.map(c => ({ ...c, available: c.id !== burying })) })))
      .not.toBe(burying);
    // Nor is a party decision, whose branch follows from who is sent.
    expect(buryOption(pending({ choicesAreOpen: false }))).toBeUndefined();
  });
});

describe('the route summary reproduces the published tables (#1978)', () => {
  type Row = Omit<RouteRun, 'acts'>;
  const row = (seed: number, over: Partial<Row> = {}): Row => ({
    seed, signed: true, policy: 'summit', endYear: 1542, best: 'adept', reachedAt: {}, clauses: 3,
    respect: 'known', diagnosis: emptyDiagnosis(), commands: {}, fullSaveHash: '', ...over,
  });

  it('counts houses, not years, for reach and endings, and years for the recipient gate', () => {
    const god = row(1, { best: 'god', ending: 'apotheosis', reachedAt: { god: 1400 }, diagnosis: {
      ...emptyDiagnosis(), recipientYears: 30, recipientClear: 4,
      recipientBlockers: { respect: 20, clauses: 6 }, recipientSole: { respect: 18 },
    } });
    const waiting = row(2, { best: 'demigod', ending: 'devoured', diagnosis: {
      ...emptyDiagnosis(), recipientYears: 10, recipientBlockers: { respect: 10, mind: 2 }, recipientSole: { respect: 8 },
    } });
    const summary = summariseRoutes([god, waiting, row(3, { ending: 'broken_line' }), row(4, { ending: 'forgotten' })]);

    expect(summary.runs).toBe(4);
    expect(summary.endings).toEqual({ apotheosis: 1, broken_line: 1, devoured: 1, forgotten: 1 });
    expect(summary.reached.demigod).toMatchObject({ hits: 2, n: 4 });
    expect(summary.reached.god).toMatchObject({ hits: 1, n: 4 });
    expect(summary.apotheosis.hits).toBe(1);
    expect(summary.apotheosis.lower!).toBeLessThan(0.25);
    expect(summary.apotheosis.upper!).toBeGreaterThan(0.25);
    expect(summary.godHouses).toEqual([{ seed: 1, ending: 'apotheosis', god: 1400 }]);
    expect(summary.recipients).toEqual({
      houses: 2, years: 40, clearYears: 4,
      blockers: { respect: 30, clauses: 6, mind: 2 }, sole: { respect: 26 },
      respectOnlyHouses: 2, respectOnlyReachedGod: 1,
    });
  });
});
