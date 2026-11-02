import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { indexContent } from '@ed/schema';
import type { PendingChoice } from '../events/decisions.js';
import { newGame } from '../session.js';
import { nameScion } from './ladder-policy.js';
import { buryOption, playSummitRoute, routeReplays, wantedPair } from './summit-route.js';

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
