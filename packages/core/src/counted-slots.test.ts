import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import type { EventTemplate } from '@ed/schema';
import { resolveSlots, autoCast, renderBody, castIn, soleCast, nameList } from './events/slots.js';
import { resolveTargets } from './events/effects.js';
import { poolScore } from './events/checks.js';
import { autoResolveDecision, queueChoice, resolveChoice, type PendingChoice } from './events/decisions.js';
import { place, testRng, testWorld } from './testing.js';
import type { SimCtx } from './world.js';

const bundle = loadContent();

/**
 * COUNTED SLOTS (issue #90, Muster stage 0).
 *
 * `SlotSpec.count` was declared in the content schema and read by nothing for
 * as long as it had existed: every slot cast exactly one person, and three
 * shipped events reached for `SENT_A/B/C` by hand to say "a party". That is
 * invariant 11's exact shape, and it is invisible — a counted slot that casts
 * one man looks like a working cast.
 *
 * So none of these assert that a function returns. They assert that the party
 * is a party: that it is bounded, that it is distinct, that the whole of it
 * reaches an effect and a check and a sentence, and that an event that cannot
 * find `min` does not fire at all.
 */
describe('a slot that casts a party', () => {
  /** A house with nine grown sons — more than any party could want. */
  function aFullHouse(seed = 4400): SimCtx {
    const ctx = testWorld(bundle, seed);
    place(ctx, { sex: 'male', age: 46, name: 'Head', castSlots: ['head'] });
    for (let i = 0; i < 9; i++) {
      place(ctx, { sex: 'male', age: 20 + i, name: `Son${i}` });
    }
    return ctx;
  }

  /** A bare template with one counted slot, and nothing else in the way. */
  function partyEvent(min: number, max: number): EventTemplate {
    return {
      id: 'test_party',
      slots: {
        SENT: { role: 'family_member', castBy: 'engine', optional: false, bind: 'event', filters: [], count: { min, max } },
      },
      body: 'The house sends {SENT}.',
    } as unknown as EventTemplate;
  }

  it('casts between min and max, and never the same man twice', () => {
    // Over many seeds, because one seed reaching one size proves nothing about
    // a range — and the sizes are what is being claimed here.
    const sizes = new Set<number>();
    for (let seed = 0; seed < 60; seed++) {
      const ctx = aFullHouse(9000 + seed);
      const res = resolveSlots(partyEvent(2, 5), ctx, testRng('party', seed));
      expect(res.ok).toBe(true);
      const party = castIn(res.fill, 'SENT');
      expect(party.length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      expect(party.length, `seed ${seed}`).toBeLessThanOrEqual(5);
      expect(new Set(party).size, `seed ${seed} sent the same man twice`).toBe(party.length);
      sizes.add(party.length);
    }
    // The size is ROLLED, not "as many as the house can spare". A house of ten
    // that always sent five would be the same bug wearing a bigger number.
    expect(sizes.size, `every party was the same size: ${[...sizes]}`).toBeGreaterThan(1);
  });

  /**
   * A pool of exactly the people a test means. `testWorld` bootstraps a
   * founding household, so "the household" is never as small as it was
   * written to be — the marked men are the only ones this slot can see.
   */
  const MARK = 'levied';

  function marked(ctx: SimCtx, n: number): void {
    for (let i = 0; i < n; i++) {
      place(ctx, { sex: 'male', age: 24 + i, name: `Marked${i}`, traits: [MARK] });
    }
  }

  function markedEvent(min: number, max: number): EventTemplate {
    const e = partyEvent(min, max);
    e.slots.SENT!.filters = [{ trait: MARK, has: true } as never];
    return e;
  }

  /**
   * THE WHOLE POINT OF `min`. A house with two men it can send cannot send
   * three, and the event does not fire — which is what makes a levy a levy
   * rather than "whoever happens to be about". `gate:slot-fillability` asks
   * exactly this question through `resolveSlots(...).ok`, so it gained the
   * check without changing a line.
   */
  it('refuses the event when the house cannot field min', () => {
    const ctx = testWorld(bundle, 4401);
    marked(ctx, 2);

    const res = resolveSlots(markedEvent(3, 5), ctx, testRng('thin'));
    expect(res.ok).toBe(false);
    expect(res.missing).toBe('SENT');
  });

  it('fires when the house has exactly min, and sends exactly them', () => {
    const ctx = testWorld(bundle, 4402);
    marked(ctx, 2);

    const res = resolveSlots(markedEvent(2, 5), ctx, testRng('exact'));
    expect(res.ok).toBe(true);
    expect(castIn(res.fill, 'SENT')).toHaveLength(2);
  });

  /** An ordinary slot is untouched: one man, stored as one man, read as one. */
  it('leaves an uncounted slot exactly as it was', () => {
    const ctx = aFullHouse();
    const e = partyEvent(2, 4);
    delete (e.slots.SENT as { count?: unknown }).count;

    const res = resolveSlots(e, ctx, testRng('single'));
    expect(typeof res.fill.SENT).toBe('string');
    expect(castIn(res.fill, 'SENT')).toHaveLength(1);
    expect(soleCast(res.fill, 'SENT')).toBe(res.fill.SENT);
  });

  /**
   * THE HALF THAT MAKES IT WORTH HAVING. A party that only one man's worth of
   * effect ever lands on is four men of prose — `the_levy_in_earnest` saying
   * "eleven men" when there are no eleven men, one layer down.
   */
  it('lands an `all` effect on everybody, and a `slot` effect on one', () => {
    const ctx = aFullHouse();
    const res = resolveSlots(partyEvent(3, 3), ctx, testRng('targets'));
    const party = castIn(res.fill, 'SENT');
    expect(party).toHaveLength(3);

    expect(resolveTargets({ all: 'SENT' }, ctx, res.fill).map((p) => String(p.id)).sort())
      .toEqual([...party].sort());
    expect(resolveTargets({ slot: 'SENT' }, ctx, res.fill)).toHaveLength(1);
  });

  it('pools the whole party in a party_sum, not the first man of it', () => {
    const ctx = aFullHouse();
    const res = resolveSlots(partyEvent(3, 3), ctx, testRng('pool'));
    const party = castIn(res.fill, 'SENT');

    const whole = poolScore(ctx, { kind: 'party_sum', slots: ['SENT'], attr: 'strength' }, res.fill);
    const one = poolScore(ctx, { kind: 'party_sum', slots: ['SENT'], attr: 'strength' }, { SENT: party[0]! });

    expect(whole).toBeGreaterThan(one);
    // Three men, so the sum is three men — not one, and not a mean.
    expect(whole / one).toBeGreaterThan(1.5);
  });

  /**
   * ONE TOKEN, HOWEVER MANY MEN. Deciding the join in `renderBody` is what
   * stops every author writing "{A}, {B} and {C}" and finding out later what a
   * party of two reads like.
   */
  it('renders the party as one English list', () => {
    const ctx = aFullHouse();
    const res = resolveSlots(partyEvent(3, 3), ctx, testRng('render'));
    const line = renderBody('The house sends {SENT}.', res.fill, ctx);

    expect(line).not.toMatch(/\{SENT\}/);
    expect(line).toMatch(/ and /);
    expect(line.split(',').length).toBe(2); // "A, B and C." — no serial comma
    for (const id of castIn(res.fill, 'SENT')) {
      expect(line).toContain(ctx.world.people.get(id)!.name);
    }
  });

  it('renders a saved byname once across one-person and counted party slots (#2319)', () => {
    const ctx = testWorld(bundle, 4404);
    const legacy = place(ctx, { sex: 'female', age: 46, name: 'Adela the Elder' });
    legacy.epithet = 'the Elder'; // older or authored recorded name already includes this
    const newlyNamed = place(ctx, { sex: 'female', age: 32, name: 'Mara' });
    newlyNamed.epithet = 'the Witness';
    const plain = place(ctx, { sex: 'male', age: 28, name: 'Nora' });

    expect(renderBody('{SENT}', { SENT: String(legacy.id) }, ctx)).toBe('Adela the Elder');
    expect(renderBody('{SENT}', { SENT: String(newlyNamed.id) }, ctx)).toBe('Mara the Witness');
    expect(renderBody('{SENT}', { SENT: String(plain.id) }, ctx)).toBe('Nora');
    expect(renderBody('The house sends {SENT}.', {
      SENT: [String(legacy.id), String(newlyNamed.id), String(plain.id)],
    }, ctx)).toBe('The house sends Adela the Elder, Mara the Witness and Nora.');
    expect(legacy.name).toBe('Adela the Elder');
    expect(legacy.epithet).toBe('the Elder');
  });

  it('joins one, two and three names the way a person would', () => {
    expect(nameList(['Aldous'])).toBe('Aldous');
    expect(nameList(['Aldous', 'Bren'])).toBe('Aldous and Bren');
    expect(nameList(['Aldous', 'Bren', 'Corr'])).toBe('Aldous, Bren and Corr');
    expect(nameList([])).toBe('');
  });

  /**
   * A player-cast party still gets cast when nobody is asked — the same reason
   * `autoCast` exists at all. Without it the chronicle of an auto-resolved run
   * carries a raw `{SENT}` in the artefact the whole game is about.
   */
  it('auto-casts a party when the run has no player in it', () => {
    const ctx = aFullHouse();
    const e = partyEvent(2, 4);
    e.slots.SENT!.castBy = 'player';

    const res = resolveSlots(e, ctx, testRng('auto'));
    expect(res.playerCast).toEqual(['SENT']);
    expect(castIn(res.fill, 'SENT')).toHaveLength(0);

    const filled = autoCast(e, ctx, res.fill, res.playerCast, testRng('auto2'));
    const party = castIn(filled, 'SENT');
    expect(party.length).toBeGreaterThanOrEqual(2);
    expect(renderBody('{SENT}', filled, ctx)).not.toMatch(/\{SENT\}/);
  });

  /**
   * A `relation` filter on the slot itself narrows WITHIN the party, because
   * `castParty` puts the men cast so far under the slot's own name before it
   * draws the next one. Distinctness comes free from that; this asserts the
   * author-facing half — "not a brother of anyone already going" is a thing
   * that can now be written and honoured.
   */
  it('narrows within the party, so a relation filter on itself is not inert', () => {
    const ctx = testWorld(bundle, 4403);
    const father = place(ctx, { sex: 'male', age: 60, name: 'Father' });
    const mother = place(ctx, { sex: 'female', age: 55, name: 'Mother' });
    const brothers = [0, 1, 2].map((i) =>
      place(ctx, { sex: 'male', age: 30 + i, name: `Brother${i}`, traits: [MARK] }));
    for (const b of brothers) {
      b.trueParents = { mother: mother.id, father: father.id };
    }
    place(ctx, { sex: 'male', age: 33, name: 'Stranger', traits: [MARK] });

    // Four men the slot can see, three of them brothers. Drawing two at random
    // sends two brothers half the time, so a filter that did nothing would be
    // caught here rather than passing by luck.
    const free = markedEvent(2, 2);
    const bothBrothers = (e: EventTemplate) => {
      let hits = 0;
      for (let seed = 0; seed < 40; seed++) {
        const res = resolveSlots(e, ctx, testRng('kin', seed));
        if (!res.ok) continue;
        const party = castIn(res.fill, 'SENT');
        if (party.filter((id) => brothers.some((b) => String(b.id) === id)).length > 1) hits++;
      }
      return hits;
    };

    expect(bothBrothers(free), 'the unfiltered slot never paired brothers — the fixture is wrong')
      .toBeGreaterThan(0);

    const gated = markedEvent(2, 2);
    gated.slots.SENT!.filters = [
      { trait: MARK, has: true } as never,
      { not: { relation: 'sibling_of', of: 'SENT' } } as never,
    ];
    expect(bothBrothers(gated)).toBe(0);
  });
});

/**
 * THE PLAYER'S HALF. A counted slot the player casts is answered with a list,
 * and `resolveChoice` is where a client's answer stops being trusted: too few,
 * too many, a repeat, or a name that was never offered. Every one of those
 * silently casting *something* is the failure this codebase has — a party of
 * one where the player named five reads as a working send.
 */
describe('a party the player names', () => {
  const MARK = 'levied';

  function aDocket(min: number, max: number): { ctx: SimCtx; pending: PendingChoice; ids: string[] } {
    const ctx = testWorld(bundle, 5150);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(String(place(ctx, { sex: 'male', age: 25 + i, name: `Man${i}`, traits: [MARK] }).id));
    }

    const e = {
      id: 'test_send',
      body: 'The house sends {SENT}.',
      slots: {
        SENT: {
          role: 'family_member', castBy: 'player', optional: false, bind: 'event',
          filters: [{ trait: MARK, has: true }], count: { min, max },
        },
      },
      interaction: {
        kind: 'choice',
        decidedBy: 'player',
        choices: [{ id: 'send', label: 'Send them', requires: [], outcomes: [{ id: 'gone', weight: 1, text: 'They go.', effects: [], tags: [] }] }],
      },
      frequency: 'common',
    } as unknown as EventTemplate;

    const res = resolveSlots(e, ctx, testRng('docket'));
    const pending = queueChoice(ctx, e, e.body, res.fill, res.playerCast);
    return { ctx, pending, ids };
  }

  it('tells the client it is a party, and how big a one', () => {
    const { pending } = aDocket(2, 4);
    expect(pending.cast).toHaveLength(1);
    expect(pending.cast[0]!.count).toEqual({ min: 2, max: 4 });
  });

  it('takes a party within the bounds, whole', () => {
    const { ctx, pending, ids } = aDocket(2, 4);
    const sent = ids.slice(0, 3);
    const res = resolveChoice(ctx, pending.id, 'send', testRng('send'), { SENT: sent });

    expect(res.reason).toBeUndefined();
    expect(res.ok).toBe(true);
    const logged = ctx.world.decisionLog.at(-1)!;
    expect(logged.kind === 'outcome' && castIn(logged.fill, 'SENT')).toEqual(sent);
  });

  it('refuses too few, too many, and nobody at all', () => {
    for (const [named, why] of [
      [1, /at least 2/],
      [5, /at most 4/],
      [0, /at least 2/],
    ] as const) {
      const { ctx, pending, ids } = aDocket(2, 4);
      const res = resolveChoice(ctx, pending.id, 'send', testRng('bad'), { SENT: ids.slice(0, named) });
      expect(res.ok, `${named} named`).toBe(false);
      expect(res.reason).toMatch(why);
    }
  });

  it('counts a man named twice once, and refuses a man never offered', () => {
    const { ctx, pending, ids } = aDocket(2, 4);
    const twice = resolveChoice(ctx, pending.id, 'send', testRng('dup'), { SENT: [ids[0]!, ids[0]!] });
    expect(twice.ok).toBe(false);
    expect(twice.reason).toMatch(/at least 2/);

    const { ctx: c2, pending: p2, ids: i2 } = aDocket(2, 4);
    const outsider = resolveChoice(c2, p2.id, 'send', testRng('ghost'), { SENT: [i2[0]!, 'p_nobody'] });
    expect(outsider.ok).toBe(false);
  });

  /**
   * INVARIANT 9, from the other side. A deferred cast is not checked when the
   * event fires, so a house with two men for a slot asking three would take
   * the docket, refuse every answer the player could give, and sit there
   * blocking the clock for the rest of the run. The pool is measured up front
   * instead and the event does not fire at all.
   */
  it('does not fire at all when the player could never field the party', () => {
    const ctx = testWorld(bundle, 5151);
    for (let i = 0; i < 2; i++) place(ctx, { sex: 'male', age: 30 + i, name: `Few${i}`, traits: ['levied'] });

    const e = {
      id: 'test_unanswerable',
      body: '{SENT}',
      slots: {
        SENT: {
          role: 'family_member', castBy: 'player', optional: false, bind: 'event',
          filters: [{ trait: 'levied', has: true }], count: { min: 3, max: 5 },
        },
      },
    } as unknown as EventTemplate;

    const res = resolveSlots(e, ctx, testRng('unanswerable'));
    expect(res.ok).toBe(false);
    expect(res.missing).toBe('SENT');
    expect(ctx.world.pendingDecisions).toHaveLength(0);
  });

  /**
   * THE PATH NO PLAYER EVER WALKS, and the one every measurement takes.
   *
   * `autoResolveDecision` picked one candidate per cast request and ignored
   * `req.count`, so a slot asking for up to four men was sent exactly one in
   * every headless run — every harness batch, every gate, every balance
   * number. It read as a working cast and scored like a man on his own.
   *
   * `gate:outcome-reach` is what caught it: two of the Muster's three bands
   * never resolved in 250 runs, because a party of one cannot clear a
   * difficulty calibrated for three. Nothing else could have — the docket path
   * was correct, so a player would never have seen it.
   */
  it('sends a party when the chronicler casts, not one man', () => {
    const sizes = new Set<number>();
    for (let seed = 0; seed < 30; seed++) {
      const { ctx, pending } = aDocket(2, 4);
      autoResolveDecision(ctx, pending, testRng('chronicler', seed));

      const logged = ctx.world.decisionLog.at(-1);
      if (!logged || logged.kind !== 'outcome') continue;
      const party = castIn(logged.fill, 'SENT');
      expect(party.length, `seed ${seed} sent ${party.length}`).toBeGreaterThanOrEqual(2);
      expect(party.length, `seed ${seed} sent ${party.length}`).toBeLessThanOrEqual(4);
      expect(new Set(party).size, 'the same man twice').toBe(party.length);
      sizes.add(party.length);
    }
    expect(sizes.size, `every chronicler party was the same size: ${[...sizes]}`).toBeGreaterThan(1);
  });
});
