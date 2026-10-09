import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { musterEscalation, proseOriginalHash } from '@ed/schema';
import { coreMessageAddress } from './messages.js';
import {
  activeCommitment, addOfficer, applyEffect, beginCommitment, bootstrap, buyPosition, loadGame,
  maxMen, musterMortality, musterOrder, musterUpkeep, place, positionOptions, reinforceCommitment,
  saveGame, setPosition, setProseMode, setProseVariants, settleCommitment, testRng, testWorld, tickMuster, withdrawCommitment,
} from '@ed/core';

const bundle = loadContent();

/**
 * THE MUSTER (issue #89, Stage 2 — #95). No content calls the `muster`
 * effect yet — #97 (Stage 3) wires `arc_the_muster`'s existing outcomes to
 * it — so every test here builds the state it means directly, per
 * `testWorld`/`place`, exactly as the issue's own acceptance list asks.
 */
describe('maxMen', () => {
  it('rises with Respect and with each active branch', () => {
    const ctx = testWorld(bundle);
    ctx.world.respect = 'known';
    const base = maxMen(ctx);

    ctx.world.respect = 'exalted';
    expect(maxMen(ctx)).toBeGreaterThan(base);
  });
});

describe('muster save durability', () => {
  it('round-trips a live commitment and the muster ledger', () => {
    const before = bootstrap(bundle, 1042, 1042);
    const officer = before.world.people.household(before.world.playerHouse, before.world.year)[0]!;

    const commitment = beginCommitment(before, 5, 'the_wars');
    reinforceCommitment(before, 3, 'branch_a');
    addOfficer(before, officer.id);
    setPosition(before, 'a_captaincy');
    tickMuster(before, testRng('muster-save'));
    before.world.muster.tide = 63;

    const after = loadGame(JSON.parse(JSON.stringify(saveGame(before))), bundle);
    const restored = activeCommitment(after)!;

    expect(restored.id).toBe(commitment.id);
    expect(restored.men).toBe(commitment.men);
    expect(restored.officers).toEqual(commitment.officers);
    expect(restored.position).toBe(commitment.position);
    expect(restored.credit).toBe(commitment.credit);
    expect(restored.from).toEqual(commitment.from);
    expect(after.world.muster.tide).toBe(63);
  });

  it('round-trips tide and lastSettled without a live commitment', () => {
    const before = bootstrap(bundle, 909, 1042);
    before.world.muster.tide = 71;
    beginCommitment(before, 5, 'the_wars');
    activeCommitment(before)!.status = 'settled';
    before.world.muster.lastSettled = before.world.year;

    const after = loadGame(JSON.parse(JSON.stringify(saveGame(before))), bundle);

    expect(activeCommitment(after)).toBeUndefined();
    expect(after.world.muster.tide).toBe(71);
    expect(after.world.muster.lastSettled).toBe(before.world.year);
    expect(after.world.muster.commitments[0]!.status).toBe('settled');
  });
});

describe('activeCommitment / beginCommitment', () => {
  it('is undefined with no commitment', () => {
    expect(activeCommitment(testWorld(bundle))).toBeUndefined();
  });

  it('opens a commitment, clamped to what the house can field', () => {
    const ctx = testWorld(bundle);
    const cap = maxMen(ctx);

    const c = beginCommitment(ctx, cap + 1000, 'the_wars');

    expect(c.status).toBe('in_the_field');
    expect(c.men).toBe(cap);
    expect(c.age).toBe('the_wars');
    expect(c.began).toBe(ctx.world.year);
    expect(activeCommitment(ctx)?.id).toBe(c.id);
  });

  it('mints a fresh id off counters.muster, every time', () => {
    const ctx = testWorld(bundle);
    const first = beginCommitment(ctx, 5, 'the_wars');
    settleCommitment(ctx);
    const second = beginCommitment(ctx, 5, 'the_wars');
    expect(second.id).not.toBe(first.id);
    expect(ctx.world.counters.muster).toBeGreaterThanOrEqual(2);
  });
});

describe('reinforceCommitment / addOfficer / setPosition', () => {
  it('refuses to reinforce with no commitment standing', () => {
    expect(reinforceCommitment(testWorld(bundle), 5)).toBe(false);
  });

  it('adds men, attributed to a hall when one is named', () => {
    const ctx = testWorld(bundle);
    const c = beginCommitment(ctx, 5, 'the_wars');
    expect(reinforceCommitment(ctx, 3, 'branch_a')).toBe(true);
    expect(c.men).toBe(8);
    expect(c.from['branch_a']).toBe(3);
  });

  it('adds a real officer once, not twice', () => {
    const ctx = testWorld(bundle);
    const officer = place(ctx, { sex: 'male', age: 30 });
    beginCommitment(ctx, 5, 'the_wars');
    expect(addOfficer(ctx, officer.id)).toBe(true);
    expect(addOfficer(ctx, officer.id)).toBe(true);
    expect(activeCommitment(ctx)?.officers).toEqual([officer.id]);
  });

  it('stores whatever position id it is given', () => {
    const ctx = testWorld(bundle);
    beginCommitment(ctx, 5, 'the_wars');
    expect(setPosition(ctx, 'a_captaincy')).toBe(true);
    expect(activeCommitment(ctx)?.position).toBe('a_captaincy');
  });
});

describe('settleCommitment / withdrawCommitment', () => {
  it('settling ends the commitment and records the year', () => {
    const ctx = testWorld(bundle);
    beginCommitment(ctx, 5, 'the_wars');
    expect(settleCommitment(ctx)).toBe(true);
    expect(activeCommitment(ctx)).toBeUndefined();
    expect(ctx.world.muster.lastSettled).toBe(ctx.world.year);
    expect(ctx.world.muster.commitments[0]!.status).toBe('settled');
  });

  it('withdrawing ends the commitment without touching lastSettled', () => {
    const ctx = testWorld(bundle);
    beginCommitment(ctx, 5, 'the_wars');
    expect(withdrawCommitment(ctx)).toBe(true);
    expect(ctx.world.muster.lastSettled).toBeUndefined();
    expect(ctx.world.muster.commitments[0]!.status).toBe('withdrawn');
  });

  it('refuses with no commitment standing', () => {
    expect(settleCommitment(testWorld(bundle))).toBe(false);
    expect(withdrawCommitment(testWorld(bundle))).toBe(false);
  });
});

describe('musterUpkeep', () => {
  it('is zero with no commitment', () => {
    expect(musterUpkeep(testWorld(bundle))).toBe(0);
  });

  it('rises with the men in the field', () => {
    const ctx = testWorld(bundle);
    beginCommitment(ctx, 5, 'the_wars');
    const five = musterUpkeep(ctx);
    activeCommitment(ctx)!.men = 20;
    expect(musterUpkeep(ctx)).toBeGreaterThan(five);
  });
});

describe('musterMortality', () => {
  it('is zero for anyone not an officer of a live commitment', () => {
    const ctx = testWorld(bundle);
    const p = place(ctx, { sex: 'male', age: 30 });
    beginCommitment(ctx, 5, 'the_wars');
    expect(musterMortality(ctx, p)).toBe(0);
  });

  it('is positive for an officer of the commitment standing', () => {
    const ctx = testWorld(bundle);
    const p = place(ctx, { sex: 'male', age: 30 });
    beginCommitment(ctx, 5, 'the_wars');
    addOfficer(ctx, p.id);
    expect(musterMortality(ctx, p)).toBeGreaterThan(0);
  });

  it('worsens as the tide runs against the house', () => {
    const ctx = testWorld(bundle);
    const p = place(ctx, { sex: 'male', age: 30 });
    beginCommitment(ctx, 5, 'the_wars');
    addOfficer(ctx, p.id);

    ctx.world.muster.tide = 100;
    const goodTide = musterMortality(ctx, p);
    ctx.world.muster.tide = 0;
    const badTide = musterMortality(ctx, p);
    expect(badTide).toBeGreaterThan(goodTide);
  });
});

describe('tickMuster', () => {
  it('is fully dormant with no commitment — no chronicle line, nothing moved', () => {
    const ctx = testWorld(bundle);
    const before = ctx.world.chronicle.length;
    tickMuster(ctx, testRng('muster'));
    expect(ctx.world.chronicle.length).toBe(before);
    expect(ctx.world.muster.tide).toBe(50);
  });

  it('walks the tide, writes a chronicle line, and accrues credit for a live commitment', () => {
    const ctx = testWorld(bundle);
    const c = beginCommitment(ctx, 20, 'the_wars');
    const beforeChronicle = ctx.world.chronicle.length;
    const beforeCredit = c.credit;
    const beforeTide = ctx.world.muster.tide;

    tickMuster(ctx, testRng('muster'));

    expect(ctx.world.chronicle.length).toBe(beforeChronicle + 1);
    expect(ctx.world.chronicle.at(-1)!.weight).toBe('line');
    expect(c.credit).toBeGreaterThan(beforeCredit);
    expect(ctx.world.muster.tide).not.toBe(beforeTide);
  });

  it('attrition never takes the commitment below zero men', () => {
    const ctx = testWorld(bundle);
    const c = beginCommitment(ctx, 1, 'the_wars');
    for (let i = 0; i < 200; i++) tickMuster(ctx, testRng('muster', i));
    expect(c.men).toBeGreaterThanOrEqual(0);
  });
});

/**
 * THE ESCALATION LEVER, wired through a played sequence of commitments —
 * `musterEscalation` itself is unit-tested in `schema/src/muster.test.ts`;
 * this proves `tickMuster` actually reads it, by settling one commitment
 * and checking a second one accrues credit faster for the same men and tide.
 */
describe('escalation, read through tickMuster', () => {
  it('a second commitment accrues credit faster than the first, at the same men and tide', () => {
    // `testRng('freeze')` is deterministic in the seed alone, so calling it
    // fresh each time — with the tide reset to the same start first — gives
    // both commitments an identical walk to compare against. Exalted, so
    // `maxMen` clamps neither commitment and 30 men is large enough that
    // `Math.round`'s attrition rounding lands on the same man count for
    // both — a handful of men at close escalations can round to different
    // counts and confound the comparison, which is a fact about rounding
    // small integers, not about the lever.
    const ctx = testWorld(bundle);
    ctx.world.respect = 'exalted';
    const first = beginCommitment(ctx, 30, 'the_wars');
    ctx.world.muster.tide = 50;
    tickMuster(ctx, testRng('freeze'));
    const firstGain = first.credit;
    settleCommitment(ctx);

    const second = beginCommitment(ctx, 30, 'the_wars');
    ctx.world.muster.tide = 50;
    tickMuster(ctx, testRng('freeze'));
    const secondGain = second.credit;

    expect(secondGain).toBeGreaterThan(firstGain);
    expect(secondGain).toBeCloseTo(firstGain * musterEscalation(1), 5);
  });
});

/**
 * THE BUY (issue #97). `positions.yaml` now exists, so this is the
 * affordability/eligibility gate the player's own `session.muster({op:'buy'})`
 * verb goes through — `setPosition` above stays the raw, unpriced setter
 * content uses once its own `requires` clauses have already decided.
 */
describe('buyPosition', () => {
  it('refuses with no commitment standing', () => {
    expect(buyPosition(testWorld(bundle), 'serjeanty').ok).toBe(false);
  });

  it('refuses a position that does not exist', () => {
    const ctx = testWorld(bundle);
    beginCommitment(ctx, 5, 'the_wars');
    expect(buyPosition(ctx, 'not_a_real_position').ok).toBe(false);
  });

  it('buys none for free, always — a choice, not an absence', () => {
    const ctx = testWorld(bundle);
    beginCommitment(ctx, 5, 'the_wars');
    const before = ctx.world.treasury;
    expect(buyPosition(ctx, 'none').ok).toBe(true);
    expect(activeCommitment(ctx)!.position).toBe('none');
    expect(ctx.world.treasury).toBe(before);
  });

  it('refuses a position the house is not Respected enough for', () => {
    const ctx = testWorld(bundle);
    ctx.world.respect = 'known';
    beginCommitment(ctx, 5, 'the_wars');
    expect(buyPosition(ctx, 'a_captaincy').ok).toBe(false);
  });

  it('refuses a captaincy with no officer old enough', () => {
    const ctx = testWorld(bundle);
    ctx.world.respect = 'regarded';
    beginCommitment(ctx, 5, 'the_wars');
    const young = place(ctx, { sex: 'male', age: 18 });
    addOfficer(ctx, young.id);
    expect(buyPosition(ctx, 'a_captaincy').ok).toBe(false);
  });

  it('buys a captaincy with an old-enough officer and the crowns to spend', () => {
    const ctx = testWorld(bundle);
    ctx.world.respect = 'regarded';
    beginCommitment(ctx, 5, 'the_wars');
    const officer = place(ctx, { sex: 'male', age: 25 });
    addOfficer(ctx, officer.id);
    const before = ctx.world.treasury;
    expect(buyPosition(ctx, 'a_captaincy').ok).toBe(true);
    expect(ctx.world.treasury).toBe(before - 90);
    expect(activeCommitment(ctx)!.position).toBe('a_captaincy');
  });

  it('halves the price for a house with an officer already serving in the discounted career', () => {
    const ctx = testWorld(bundle);
    ctx.world.respect = 'regarded';
    beginCommitment(ctx, 5, 'the_wars');
    const officer = place(ctx, { sex: 'male', age: 25 });
    officer.career = { career: 'military' as never, from: ctx.world.year };
    addOfficer(ctx, officer.id);
    const before = ctx.world.treasury;
    expect(buyPosition(ctx, 'a_captaincy').ok).toBe(true);
    expect(ctx.world.treasury).toBe(before - 45);
  });

  it('refuses when the house cannot raise the price, even under the debt floor', () => {
    const ctx = testWorld(bundle);
    ctx.world.respect = 'eminent';
    beginCommitment(ctx, 5, 'the_wars');
    ctx.world.treasury = -100;
    expect(buyPosition(ctx, 'a_banner').ok).toBe(false);
    expect(activeCommitment(ctx)!.position).toBeUndefined();
  });
});

describe('positionOptions', () => {
  it('is empty with no commitment standing', () => {
    expect(positionOptions(testWorld(bundle))).toEqual([]);
  });

  it('lists every position, priced, with `current` and `canBuy` set honestly', () => {
    const ctx = testWorld(bundle);
    ctx.world.respect = 'known';
    beginCommitment(ctx, 5, 'the_wars');
    const options = positionOptions(ctx);

    expect(options.map((o) => o.id)).toEqual(['none', 'serjeanty', 'a_captaincy', 'a_banner']);
    const none = options.find((o) => o.id === 'none')!;
    expect(none.price).toBeUndefined();
    expect(none.canBuy).toBe(true);
    expect(none.current).toBe(false);

    const captaincy = options.find((o) => o.id === 'a_captaincy')!;
    expect(captaincy.canBuy).toBe(false);
    expect(captaincy.reason).toBeDefined();
  });

  it('marks the bought position current, and agrees with buyPosition on what it costs', () => {
    const ctx = testWorld(bundle);
    beginCommitment(ctx, 5, 'the_wars');
    const serjeanty = positionOptions(ctx).find((o) => o.id === 'serjeanty')!;
    expect(serjeanty.price).toBe(25);

    buyPosition(ctx, 'serjeanty');
    const after = positionOptions(ctx).find((o) => o.id === 'serjeanty')!;
    expect(after.current).toBe(true);
  });
});

describe('musterOrder', () => {
  it('reinforce refuses with no commitment, and with a non-positive count', () => {
    const ctx = testWorld(bundle);
    expect(musterOrder(ctx, { op: 'reinforce', men: 5 }).ok).toBe(false);
    beginCommitment(ctx, 5, 'the_wars');
    expect(musterOrder(ctx, { op: 'reinforce', men: 0 }).ok).toBe(false);
  });

  it('reinforce adds men to the standing commitment', () => {
    const ctx = testWorld(bundle);
    const c = beginCommitment(ctx, 5, 'the_wars');
    const result = musterOrder(ctx, { op: 'reinforce', men: 4 });
    expect(result.ok).toBe(true);
    expect(c.men).toBe(9);
  });

  it('buy dispatches to buyPosition', () => {
    const ctx = testWorld(bundle);
    beginCommitment(ctx, 5, 'the_wars');
    expect(musterOrder(ctx, { op: 'buy', position: 'none' }).ok).toBe(true);
    expect(activeCommitment(ctx)!.position).toBe('none');
  });

  it('withdraw ends the commitment, and refuses with none standing', () => {
    const ctx = testWorld(bundle);
    expect(musterOrder(ctx, { op: 'withdraw' }).ok).toBe(false);
    beginCommitment(ctx, 5, 'the_wars');
    expect(musterOrder(ctx, { op: 'withdraw' }).ok).toBe(true);
    expect(activeCommitment(ctx)).toBeUndefined();
  });
});

/**
 * THE `muster` EFFECT CASE (issue #95's acceptance): a test that something
 * CHANGED, exercised the way an authored event will eventually reach it
 * (issue #97) — `applyEffect`, not the bare `core/src/muster.ts` functions.
 */
describe('the muster effect', () => {
  it('begin opens a commitment', () => {
    const ctx = testWorld(bundle);
    applyEffect({ kind: 'muster', op: 'begin', men: 5, age: 'the_wars' }, ctx, {});
    const c = activeCommitment(ctx);
    expect(c).toBeDefined();
    expect(c!.men).toBe(5);
    expect(c!.age).toBe('the_wars');
  });

  it('reinforce, settle and withdraw each change the standing commitment', () => {
    const ctx = testWorld(bundle);
    applyEffect({ kind: 'muster', op: 'begin', men: 5, age: 'the_wars' }, ctx, {});
    applyEffect({ kind: 'muster', op: 'reinforce', men: 2 }, ctx, {});
    expect(activeCommitment(ctx)!.men).toBe(7);

    applyEffect({ kind: 'muster', op: 'settle' }, ctx, {});
    expect(ctx.world.muster.commitments[0]!.status).toBe('settled');
  });

  it('add_officer casts a real person into the commitment, off a slot', () => {
    const ctx = testWorld(bundle);
    const officer = place(ctx, { sex: 'male', age: 30 });
    applyEffect({ kind: 'muster', op: 'begin', men: 5, age: 'the_wars' }, ctx, {});
    applyEffect({ kind: 'muster', op: 'add_officer', officer: { slot: 'OFFICER' } }, ctx, { OFFICER: officer.id });
    expect(activeCommitment(ctx)!.officers).toEqual([officer.id]);
  });

  it('set_position stores the id', () => {
    const ctx = testWorld(bundle);
    applyEffect({ kind: 'muster', op: 'begin', men: 5, age: 'the_wars' }, ctx, {});
    applyEffect({ kind: 'muster', op: 'set_position', position: 'serjeanty' }, ctx, {});
    expect(activeCommitment(ctx)!.position).toBe('serjeanty');
  });
});

/**
 * Yearly lines are written at the time they happen, so translation must affect
 * the next line without changing the tide, casualties, credit or saved history.
 */
describe('muster Chronicle wording', () => {
  const tideBands = {
    favour: { start: 80, wording: "in the house's favour", simple: 'The war is going well for the house.' },
    against: { start: 20, wording: 'against the house', simple: 'The war is going badly for the house.' },
    holding: { start: 50, wording: 'holding, for now', simple: 'Neither side has the advantage yet.' },
  } as const;

  for (const [band, tide] of Object.entries(tideBands) as Array<[keyof typeof tideBands, typeof tideBands[keyof typeof tideBands]]>) {
    for (const withLosses of [false, true]) {
      it(`renders the ${band} tide with ${withLosses ? 'losses' : 'no losses'} in both modes`, () => {
        const shape = withLosses ? 'losses' : 'no_losses';
        const startMen = withLosses ? 20 : 1;
        const makeWorld = () => {
          const ctx = testWorld(bundle);
          ctx.world.respect = 'exalted'; // enough levy for twenty men
          ctx.world.muster.tide = tide.start;
          beginCommitment(ctx, startMen, 'the_wars');
          return ctx;
        };

        const original = makeWorld();
        const plain = makeWorld();
        const originalTemplate = withLosses
          ? `The war goes on. {MEN} of the house's men remain in the field, {LOST} lost this year, and the tide runs ${tide.wording}.`
          : `The war goes on. {MEN} of the house's men remain in the field, and the tide runs ${tide.wording}.`;
        const plainTemplate = withLosses
          ? `The war continues. {MEN} men remain in the field and {LOST} died this year. ${tide.simple}`
          : `The war continues. {MEN} men remain in the field. ${tide.simple}`;
        setProseVariants(plain, [{
          address: coreMessageAddress(`muster.year.${band}.${shape}`),
          of: proseOriginalHash(originalTemplate),
          plainenglish: plainTemplate,
        }]);
        setProseMode(plain, 'plainenglish');

        tickMuster(original, testRng('yearly-muster-message'));
        tickMuster(plain, testRng('yearly-muster-message'));
        const men = activeCommitment(original)!.men;
        const lost = startMen - men;
        expect(withLosses ? lost > 0 : lost === 0).toBe(true);
        const fill = (text: string) => text.replace('{MEN}', String(men)).replace('{LOST}', String(lost));

        expect(original.world.chronicle.at(-1)?.text).toBe(fill(originalTemplate));
        expect(plain.world.chronicle.at(-1)?.text).toBe(fill(plainTemplate));
        expect(plain.world.muster).toEqual(original.world.muster);
        expect(plain.world.chronicle.at(-1)?.weight).toBe('line');

        setProseMode(plain, 'original');
        expect(plain.world.chronicle.at(-1)?.text).toBe(fill(plainTemplate));
      });
    }
  }
});
