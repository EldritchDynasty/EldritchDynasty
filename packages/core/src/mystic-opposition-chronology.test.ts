import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { asId } from '@ed/schema';
import { beginCommitment } from './muster.js';
import { assignDuty, tickMystic } from './mystic.js';
import { addGrudge, relate } from './people/relationships.js';
import { place, testWorld } from './testing.js';
import type { SimCtx } from './world.js';

const content = loadContent();
const ENEMY = 'house_marrow';
const watch = content.bundle.mysticWorkings.find(w => w.benefit.kind === 'field_watch');

function fieldWorld(year: number): SimCtx {
  const ctx = testWorld(content, 2731, year);
  ctx.world.relationships.clear();
  ctx.world.treasury = 500;
  expect(ctx.world.houses.has(ENEMY)).toBe(true);
  expect(watch).toBeDefined();
  return ctx;
}

function fieldWatch(ctx: SimCtx): string | undefined {
  const p = place(ctx, { sex: 'male', age: 30, name: 'The field reader', awakened: true });
  for (const book of watch!.books) p.spellsKnown.push(asId(book));
  const commitment = beginCommitment(ctx, 5, 'the_wars');
  const ordered = assignDuty(ctx, {
    person: p.id,
    working: watch!.id,
    target: { kind: 'muster', commitment: commitment.id },
  });
  expect(ordered.ok, ordered.reason).toBe(true);
  return commitment.opponent;
}

describe('field Mystic opponents respect grudge chronology (#2731)', () => {
  it('does not turn a neutral future feud into an opponent today', () => {
    const ctx = fieldWorld(1100);
    const grudge = addGrudge(ctx, ENEMY, ctx.world.playerHouse,
      { severity: 80, inheritance: 'house_wide' }, 'future_record');
    grudge.originYear = 1110;
    expect(fieldWatch(ctx)).toBeUndefined();
  });

  it.each([1110, 1111])('recognises the same feud once its year has arrived (%i)', year => {
    const ctx = fieldWorld(year);
    const grudge = addGrudge(ctx, ENEMY, ctx.world.playerHouse,
      { severity: 80, inheritance: 'house_wide' }, 'future_record');
    grudge.originYear = 1110;
    expect(fieldWatch(ctx)).toBe(ENEMY);
  });

  it('still honours genuinely negative sentiment even alongside a future grudge', () => {
    const ctx = fieldWorld(1100);
    const grudge = addGrudge(ctx, ENEMY, ctx.world.playerHouse,
      { severity: 80, inheritance: 'house_wide' }, 'future_record');
    grudge.originYear = 1110;
    relate(ctx.world, ENEMY, ctx.world.playerHouse, -10);
    expect(fieldWatch(ctx)).toBe(ENEMY);
  });
});

/** A recovered future deployment can carry a previously-saved field reader. */
describe('future-start recovered Mystic opposition (#2903)', () => {
  it('does not mobilize a foreign opponent before the saved muster begins', () => {
    const ctx = fieldWorld(1100);
    expect(fieldWatch(ctx)).toBeUndefined();
    const commitment = ctx.world.muster.commitments.at(-1)!;
    commitment.began = 1105;
    addGrudge(ctx, ENEMY, ctx.world.playerHouse,
      { severity: 80, inheritance: 'house_wide' }, 'current_quarrel');

    // The existing player assignment is recovered from a later save. The
    // yearly opposition pass precedes duty eligibility checks: the latter
    // must not retroactively create an enemy before the first field year.
    tickMystic(ctx);
    expect(commitment.opponent).toBeUndefined();
    expect(ctx.world.mystic.assignments.some(a => a.house === ENEMY)).toBe(false);
  });

  it('still selects that opponent after a current-year deployment begins', () => {
    const ctx = fieldWorld(1105);
    expect(fieldWatch(ctx)).toBeUndefined();
    const commitment = ctx.world.muster.commitments.at(-1)!;
    expect(commitment.began).toBe(ctx.world.year);
    addGrudge(ctx, ENEMY, ctx.world.playerHouse,
      { severity: 80, inheritance: 'house_wide' }, 'current_quarrel');

    tickMystic(ctx);
    expect(commitment.opponent).toBe(ENEMY);
  });
});
