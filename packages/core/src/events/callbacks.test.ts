import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { declineMatch, queueMatch, resolveMatch } from './decisions.js';
import { dealMatch } from '../people/match.js';
import { startDecisionArcs } from './arcs.js';
import { applyEffect } from './effects.js';
import { captureFamily } from '../people/captivity.js';
import { causeOf } from '../cause.js';
import { order } from '../table.js';
import { makeRng } from '../rng.js';
import { phase, place, testWorld } from '../testing.js';
import type { SimCtx } from '../world.js';

/**
 * #1898: THE ORDINARY DECISIONS, COME BACK TO.
 *
 * A Match, a tutor's term and an awakening start their own story through
 * `startsOn`, and the story's return cites the decision's page. Built state,
 * one door at a time; `callbacks.slow.test.ts` measures the batch.
 */
const bundle = loadContent();

const MATCH = 'arc_the_match_come_to_something';
const TERM = 'arc_the_term_paid_for';
const WAKING = 'arc_the_waking_kept';

function instancesOf(ctx: SimCtx, arc: string) {
  return [...ctx.world.arcs.values()].filter((a) => a.arc === arc);
}

/** Run the arcs phase in every year up to and including `until`. */
function playArcsUntil(ctx: SimCtx, until: number): void {
  for (; ctx.world.year <= until; ctx.world.year++) phase('arcs', ctx);
  ctx.world.year = until;
}

describe('decision-started arcs (#1898)', () => {
  it('a Match answered opens the couple\'s story, bound to both of them', () => {
    const ctx = testWorld(bundle, 8383, 1060);
    const her = place(ctx, { sex: 'female', age: 19, name: 'The Bride Of The Blood' });
    const offer = dealMatch(ctx, her, makeRng(1));
    const card = offer.cards[0]!;
    Object.assign(card, { available: true, blockedBy: undefined, dowry: 0 });
    const pending = queueMatch(ctx, offer);

    const result = resolveMatch(ctx, pending.id, card.id);
    expect(result.ok).toBe(true);
    const [story] = instancesOf(ctx, MATCH);
    expect(story?.bindings).toEqual({ SUBJECT: her.id, SPOUSE: result.spouse });
    expect(story?.startedYear).toBe(1060);
  });

  it('a declined hand opens nothing', () => {
    const ctx = testWorld(bundle, 8384, 1060);
    const her = place(ctx, { sex: 'female', age: 19, name: 'The Bride Who Waits' });
    const pending = queueMatch(ctx, dealMatch(ctx, her, makeRng(1)));
    expect(declineMatch(ctx, pending.id)).toBe(true);
    expect(instancesOf(ctx, MATCH)).toHaveLength(0);
  });

  it('a term ordered at the Table opens the pupil\'s story; an authored tutor effect does not', () => {
    const ctx = testWorld(bundle, 8385, 1060);
    ctx.world.treasury = 500;
    const pupil = place(ctx, { sex: 'male', age: 10, name: 'The Paid For' });
    expect(order(ctx, { kind: 'tutor', person: pupil.id, attr: 'mind' }).ok).toBe(true);
    expect(instancesOf(ctx, TERM).map((a) => a.bindings)).toEqual([{ PUPIL: pupil.id }]);

    // The opening concern's own term goes through the `tutor` effect, and its
    // scene already narrates the choice. A second story about it would tell
    // the 1042 schoolroom twice.
    const other = testWorld(bundle, 8386, 1042);
    const opening = other.content.arc('arc_the_tutors_good_years')!;
    expect(opening.startsOn).toBeUndefined();
  });

  it('a refused order opens nothing', () => {
    const ctx = testWorld(bundle, 8387, 1060);
    ctx.world.treasury = -1000;
    const pupil = place(ctx, { sex: 'male', age: 10, name: 'The Unaffordable' });
    expect(order(ctx, { kind: 'tutor', person: pupil.id, attr: 'mind' }).ok).toBe(false);
    expect(instancesOf(ctx, TERM)).toHaveLength(0);
  });

  it('a second decision inside the cooldown does not open a second story', () => {
    const ctx = testWorld(bundle, 8388, 1060);
    const a = place(ctx, { sex: 'male', age: 12, name: 'The First Pupil' });
    const b = place(ctx, { sex: 'male', age: 11, name: 'The Second Pupil' });
    const cooldown = ctx.content.arc(TERM)!.startsOn!.cooldownYears;
    startDecisionArcs(ctx, 'tutor', { PUPIL: a.id });
    instancesOf(ctx, TERM)[0]!.status = 'ended';
    ctx.world.year += cooldown - 1;
    startDecisionArcs(ctx, 'tutor', { PUPIL: b.id });
    expect(instancesOf(ctx, TERM)).toHaveLength(1);
    ctx.world.year += 1;
    startDecisionArcs(ctx, 'tutor', { PUPIL: b.id });
    expect(instancesOf(ctx, TERM).map((i) => i.bindings.PUPIL)).toEqual([a.id, b.id]);
  });

  it('a waking in the house opens the story; a waking in another house does not', () => {
    // The founding children wake in the first decades; run lifecycle until
    // one does. Nothing here is pinned to which child or which year.
    const ctx = testWorld(bundle, 4242, 1042);
    let woken: string | undefined;
    for (; ctx.world.year < 1080 && !woken; ctx.world.year++) {
      const household = new Set(ctx.world.people.household(ctx.world.playerHouse, ctx.world.year).map((p) => p.id));
      const report = phase('lifecycle', ctx);
      woken = report.awakenings.find((p) => household.has(p.id) && p.status === 'alive')?.id;
      const strangers = report.awakenings.filter((p) => !household.has(p.id));
      for (const s of strangers) {
        expect(instancesOf(ctx, WAKING).some((i) => i.bindings.WOKEN === s.id)).toBe(false);
      }
    }
    expect(woken).toBeDefined();
    expect(instancesOf(ctx, WAKING).map((i) => i.bindings.WOKEN)).toContain(woken);
  });

  it('the return names the decision that started it: its page cites the opening page', () => {
    const ctx = testWorld(bundle, 8389, 1060);
    const pupil = place(ctx, { sex: 'female', age: 9, name: 'The Ledger Keeper' });
    startDecisionArcs(ctx, 'tutor', { PUPIL: pupil.id });
    playArcsUntil(ctx, 1068);

    const book = ctx.world.chronicle;
    const opened = book.find((e) => e.eventId === 'the_term_bought');
    const returned = book.find((e) => e.eventId === 'the_term_shows');
    expect(opened?.year).toBe(1060);
    expect(opened!.text).toContain('The Ledger Keeper');
    expect(returned?.year).toBe(1068);
    expect(returned!.text).toContain('The Ledger Keeper');
    expect(causeOf(ctx, returned!.id!)).toEqual({ year: 1060, page: opened!.id, blank: false });
  });

  it('a term cancelled before it completes ends its story, and only that one', () => {
    const ctx = testWorld(bundle, 8391, 1060);
    ctx.world.treasury = 500;
    const pupil = place(ctx, { sex: 'male', age: 10, name: 'The Spoiled Pages' });
    const wed = place(ctx, { sex: 'female', age: 19, name: 'The Unrelated Bride' });
    expect(order(ctx, { kind: 'tutor', person: pupil.id, attr: 'mind' }).ok).toBe(true);
    startDecisionArcs(ctx, 'match', { SUBJECT: wed.id, SPOUSE: pupil.id });
    // The authored door `the_winter_wasted` takes: no refund, no completion.
    applyEffect({ kind: 'tutor', target: { slot: 'PUPIL' }, attr: 'mind', op: 'cancel' }, ctx, { PUPIL: pupil.id });
    expect(instancesOf(ctx, TERM)[0]?.status).toBe('cancelled');
    expect(instancesOf(ctx, MATCH)[0]?.status).toBe('active');
  });

  it('a pupil taken hostage mid-term ends the story about the term', () => {
    const ctx = testWorld(bundle, 8392, 1060);
    ctx.world.treasury = 500;
    const pupil = place(ctx, { sex: 'female', age: 12, name: 'The Held Pupil' });
    expect(order(ctx, { kind: 'tutor', person: pupil.id, attr: 'mind' }).ok).toBe(true);
    expect(captureFamily(ctx, pupil.id, 'house_marrow', 40)).toBe(true);
    expect(instancesOf(ctx, TERM)[0]?.status).toBe('cancelled');
  });

  it.each([
    ['the_match_held', true],
    ['the_match_undone', false],
  ] as const)('a Match return reads whether the marriage still stands: %s', (outcome, stands) => {
    const ctx = testWorld(bundle, 8393, 1060);
    const him = place(ctx, { sex: 'male', age: 22, name: 'The Groom Of The Blood' });
    const her = place(ctx, { sex: 'female', age: 20, name: 'The Bride Who Stayed' });
    const ended = stands ? {} : { to: 1062 };
    him.marriages.push({ spouse: her.id, from: 1060, ...ended });
    her.marriages.push({ spouse: him.id, from: 1060, ...ended });
    startDecisionArcs(ctx, 'match', { SUBJECT: him.id, SPOUSE: her.id });
    playArcsUntil(ctx, 1066);
    expect(instancesOf(ctx, MATCH)[0]?.history.map((h) => h.outcome)).toEqual([expect.any(String), outcome]);
  });

  it('a pupil who dies cancels only their own story', () => {
    const ctx = testWorld(bundle, 8390, 1060);
    const pupil = place(ctx, { sex: 'male', age: 9, name: 'The Short Term' });
    startDecisionArcs(ctx, 'tutor', { PUPIL: pupil.id });
    phase('arcs', ctx);
    ctx.world.people.kill(pupil.id, ctx.world.year + 2, 'fever');
    playArcsUntil(ctx, 1069);
    expect(instancesOf(ctx, TERM)[0]?.status).toBe('cancelled');
    expect(ctx.world.chronicle.some((e) => e.eventId === 'the_term_shows')).toBe(false);
  });
});
