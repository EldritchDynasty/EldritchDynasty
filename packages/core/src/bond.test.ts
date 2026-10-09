import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { proseOriginalHash, type RetainerContract } from '@ed/schema';
import {
  bindService, bondsmen, CROWN, DEBT_FLOOR, driftLoyalty, freeBond, isBonded, leakChance,
  loadGame, MAX_BOND, order, phase, place, saveGame, serviceBonds, setProseMode, setProseVariants, testWorld, tickEconomy,
  FREEDOM_LOYALTY, RESENTMENT_OF_FREEDOM,
} from '@ed/core';
import { coreMessageAddress } from './messages.js';

const bundle = loadContent();

function contract(over: Partial<RetainerContract> = {}): RetainerContract {
  return {
    role: 'steward',
    term: 'yearly',
    wage: 6,
    loyalty: 60,
    boundTo: 'nobody',
    onEmployerDeath: 'released',
    knowsSecrets: [],
    debt: 0,
    ...over,
  };
}

/**
 * THE BOND (world §12).
 *
 * *"Nobody in this world is a slave and there is no serfdom in Aubren. People
 * are held by debt, custom, contract and having nowhere else to go, which is
 * sufficient."* What is asserted here is that the debt is sufficient — that it
 * holds somebody the wage rules would have let go — and that it is paid for.
 */
describe('a bond is a debt, and the debt holds', () => {
  it('a bonded servant is not released by arrears, which would end any other term', () => {
    const ctx = testWorld(bundle);
    const employer = place(ctx, { sex: 'male', age: 40, name: 'Head', castSlots: ['head'] });
    const free = place(ctx, { sex: 'male', age: 30, name: 'Free', contract: contract({ boundTo: employer.id }) });
    const held = place(ctx, {
      sex: 'male',
      age: 30,
      name: 'Held',
      contract: contract({ boundTo: employer.id, term: 'bonded', debt: 100 }),
    });

    // Not a mark in the house. The yearly man goes; the bonded one cannot.
    ctx.world.treasury = 0;
    phase('quarrels', ctx);

    expect(free.contract, 'the yearly contract survived an empty treasury').toBeUndefined();
    expect(held.contract, 'the bond did not hold').toBeDefined();
    expect(isBonded(held)).toBe(true);
  });

  it('nor by destitution, which ends even a lifetime contract', () => {
    const ctx = testWorld(bundle);
    const employer = place(ctx, { sex: 'male', age: 40, name: 'Head', castSlots: ['head'] });
    const lifer = place(ctx, {
      sex: 'male', age: 30, name: 'Lifer', contract: contract({ boundTo: employer.id, term: 'lifetime' }),
    });
    const held = place(ctx, {
      sex: 'male', age: 30, name: 'Held', contract: contract({ boundTo: employer.id, term: 'bonded', debt: 100 }),
    });

    ctx.world.treasury = DEBT_FLOOR;
    phase('quarrels', ctx);

    expect(lifer.contract, 'destitution did not end a lifetime contract').toBeUndefined();
    expect(held.contract, 'destitution ended a bond').toBeDefined();
  });

  it('nor by the death of the man who signed it — a debt is an asset of the house', () => {
    const ctx = testWorld(bundle);
    const employer = place(ctx, { sex: 'male', age: 80, name: 'Employer' });
    place(ctx, { sex: 'male', age: 40, name: 'Head', castSlots: ['head'] });
    const held = place(ctx, {
      sex: 'male', age: 30, name: 'Held', contract: contract({ boundTo: employer.id, term: 'bonded', debt: 100 }),
    });

    ctx.world.treasury = 5000;
    ctx.world.people.kill(employer.id, ctx.world.year, 'a test');
    phase('quarrels', ctx);

    expect(held.contract, 'the bond died with the man who signed it').toBeDefined();
    // The same phase services the bond before it reads the releases, so a
    // year's wage has already come off what is owed.
    expect(held.contract?.debt).toBe(100 - 6);
  });
});

describe('and the debt is paid off', () => {
  it('the wage services it, and discharges to wages when it is worked off', () => {
    const ctx = testWorld(bundle);
    const p = place(ctx, {
      sex: 'male', age: 30, name: 'Held', contract: contract({ term: 'bonded', debt: 12, wage: 6 }),
    });

    expect(serviceBonds(ctx)).toHaveLength(0);
    expect(p.contract?.debt).toBe(6);

    const done = serviceBonds(ctx);
    expect(done.map((x) => x.id)).toContain(p.id);
    expect(p.contract?.debt).toBe(0);
    // A servant now, on wages, who spent those years not being paid.
    expect(p.contract?.term).toBe('yearly');
    expect(isBonded(p)).toBe(false);
  });

  it('a bond costs the house nothing in wages while it runs — which is why one is taken', () => {
    const ctx = testWorld(bundle);
    ctx.world.treasury = 1000;
    const p = place(ctx, { sex: 'male', age: 30, name: 'Held', contract: contract() });

    bindService(ctx, p, 100);
    const afterAdvance = ctx.world.treasury;
    expect(afterAdvance).toBe(1000 - 100 / CROWN);

    for (let i = 0; i < 5; i += 1) serviceBonds(ctx);
    expect(ctx.world.treasury, 'servicing a bond moved the treasury').toBe(afterAdvance);
  });
});

describe('what a bond costs', () => {
  /**
   * The whole price of the cheap tier, and it is charged by `secrets.ts`
   * rather than by anything invented for the bond.
   */
  it('wages cannot buy a bonded servant\'s loyalty, because there are no wages', () => {
    const ctx = testWorld(bundle);
    ctx.world.treasury = 10_000;
    const paid = place(ctx, { sex: 'male', age: 30, name: 'Paid', contract: contract({ loyalty: 60 }) });
    const held = place(ctx, {
      sex: 'male', age: 30, name: 'Held', contract: contract({ loyalty: 60, term: 'bonded', debt: 200 }),
    });

    for (let i = 0; i < 20; i += 1) driftLoyalty(ctx);

    expect(paid.contract!.loyalty).toBeGreaterThan(60);
    expect(held.contract!.loyalty).toBeLessThan(60);
  });

  it('so a long bond ends in somebody who knows things and is owed nothing', () => {
    const ctx = testWorld(bundle);
    ctx.world.treasury = 10_000;
    const held = place(ctx, {
      sex: 'male', age: 30, name: 'Held', contract: contract({ loyalty: 60, term: 'bonded', debt: 200 }),
    });
    const before = leakChance(held.contract!, 'unpaid', 10);
    for (let i = 0; i < 30; i += 1) driftLoyalty(ctx);
    expect(leakChance(held.contract!, 'unpaid', 10)).toBeGreaterThan(before);
  });
});

describe('freed is not released', () => {
  it('tearing up the bond clears the debt and leaves them on wages', () => {
    const ctx = testWorld(bundle);
    const p = place(ctx, {
      sex: 'male', age: 30, name: 'Held', contract: contract({ term: 'bonded', debt: 140 }),
    });

    const done = freeBond(ctx, p);
    expect(done.ok).toBe(true);
    expect(done.forgiven).toBe(140);
    expect(p.contract?.debt).toBe(0);
    expect(p.contract?.term).toBe('yearly');
    expect(ctx.world.chronicle.some((e) => e.title === 'The bond')).toBe(true);
  });

  /**
   * THE TRADE. Neither way out of a bond is the safe answer, and both of these
   * assert a direction rather than a number — the constants are knobs and the
   * shape is the claim.
   */
  it('FOR: the freed man\'s loyalty jumps, which is what buys his silence', () => {
    const ctx = testWorld(bundle);
    const p = place(ctx, {
      sex: 'male', age: 30, name: 'Held', contract: contract({ term: 'bonded', debt: 140, loyalty: 40 }),
    });
    const before = leakChance(p.contract!, 'unpaid', 10);

    freeBond(ctx, p);

    expect(p.contract!.loyalty).toBe(40 + FREEDOM_LOYALTY);
    expect(leakChance(p.contract!, 'unpaid', 10)).toBeLessThan(before);
  });

  it('AGAINST: every other bondsman resents the one it was done for', () => {
    const ctx = testWorld(bundle);
    const lucky = place(ctx, {
      sex: 'male', age: 30, name: 'Lucky', contract: contract({ term: 'bonded', debt: 100, loyalty: 50 }),
    });
    const left = [0, 1, 2].map((i) => place(ctx, {
      sex: 'male', age: 30, name: `Left${i}`, contract: contract({ term: 'bonded', debt: 100, loyalty: 50 }),
    }));

    const done = freeBond(ctx, lucky);

    expect(done.resented).toBe(3);
    for (const other of left) {
      expect(other.contract!.loyalty, other.name).toBe(50 - RESENTMENT_OF_FREEDOM);
    }
    // And the man it was done for does not dock his own loyalty for it.
    expect(lucky.contract!.loyalty).toBe(50 + FREEDOM_LOYALTY);
  });

  it('AGAINST: a captive who could not leave becomes an employee who can', () => {
    const ctx = testWorld(bundle);
    const employer = place(ctx, { sex: 'male', age: 40, name: 'Boss', castSlots: ['head'] });
    const p = place(ctx, {
      sex: 'male', age: 30, name: 'Held', contract: contract({ boundTo: employer.id, term: 'bonded', debt: 100 }),
    });

    // Held, the house is broke, and he stays because the debt stands.
    ctx.world.treasury = 0;
    phase('quarrels', ctx);
    expect(p.contract, 'the bond did not hold').toBeDefined();

    freeBond(ctx, p);
    ctx.world.treasury = 0;
    phase('quarrels', ctx);
    expect(p.contract, 'a freed man could still not be let go in a lean quarter').toBeUndefined();
  });

  it('AGAINST: a bonded servant draws no wage, so freeing one puts a cost back on the house', () => {
    const ctx = testWorld(bundle);
    const p = place(ctx, {
      sex: 'male', age: 30, name: 'Held', contract: contract({ term: 'bonded', debt: 100, wage: 6 }),
    });

    // `serviceBonds` already takes the wage off the debt. Charging it to the
    // treasury as well had the house paying the same marks twice.
    const held = tickEconomy(ctx);
    freeBond(ctx, p);
    const freedCost = tickEconomy(ctx);

    expect(freedCost.wages).toBeGreaterThan(held.wages);
  });

  it('a servant freed in a will carries less out of the house than one dismissed', () => {
    const c = contract({ loyalty: 50 });
    expect(leakChance(c, 'freed', 10)).toBeLessThan(leakChance(c, 'employer_died', 10));
    expect(leakChance(c, 'freed', 10)).toBeLessThan(leakChance(c, 'unpaid', 10));
  });

  it('`onEmployerDeath: freed` discharges the debt where `released` would not', () => {
    const ctx = testWorld(bundle);
    const employer = place(ctx, { sex: 'male', age: 80, name: 'Employer' });
    place(ctx, { sex: 'male', age: 40, name: 'Head', castSlots: ['head'] });
    const p = place(ctx, {
      sex: 'male',
      age: 30,
      name: 'Held',
      contract: contract({ boundTo: employer.id, term: 'lifetime', onEmployerDeath: 'freed', debt: 90 }),
    });

    ctx.world.treasury = 5000;
    ctx.world.people.kill(employer.id, ctx.world.year, 'a test');
    phase('quarrels', ctx);

    expect(p.contract, 'a freed servant stayed in service').toBeUndefined();
  });
});

describe('follows_named follows the person it names', () => {
  it('rebinds to the named person, not to whoever happens to be Head', () => {
    const ctx = testWorld(bundle);
    const employer = place(ctx, { sex: 'male', age: 80, name: 'Employer' });
    const head = place(ctx, { sex: 'male', age: 40, name: 'Head', castSlots: ['head'] });
    const daughter = place(ctx, { sex: 'female', age: 22, name: 'Daughter' });
    const p = place(ctx, {
      sex: 'female',
      age: 35,
      name: 'Nurse',
      contract: contract({
        role: 'midwife', boundTo: employer.id, onEmployerDeath: 'follows_named', follows: daughter.id,
      }),
    });

    ctx.world.treasury = 5000;
    ctx.world.people.kill(employer.id, ctx.world.year, 'a test');
    phase('quarrels', ctx);

    expect(p.contract?.boundTo, 'the contract went to the Head instead of the one it named').toBe(daughter.id);
    expect(p.contract?.boundTo).not.toBe(head.id);
  });

  it('falls through to the heir when the one they were promised to went first', () => {
    const ctx = testWorld(bundle);
    const employer = place(ctx, { sex: 'male', age: 80, name: 'Employer' });
    const gone = place(ctx, { sex: 'female', age: 22, name: 'Gone' });
    const p = place(ctx, {
      sex: 'female',
      age: 35,
      name: 'Nurse',
      contract: contract({
        role: 'midwife', boundTo: employer.id, onEmployerDeath: 'follows_named', follows: gone.id,
      }),
    });

    ctx.world.treasury = 5000;
    ctx.world.people.kill(gone.id, ctx.world.year, 'a test');
    ctx.world.people.kill(employer.id, ctx.world.year, 'a test');

    // `bootstrap` already seated a Head; the engine takes whoever actually
    // holds the seal, not whoever a test placed most recently.
    const seated = ctx.world.people.living().find((x) => x.castSlots.includes('head'));
    expect(seated, 'no seated Head to fall through to').toBeDefined();
    phase('quarrels', ctx);

    expect(p.contract?.boundTo).toBe(seated!.id);
  });
});

describe('the orders the player actually gives', () => {
  it('binds against a sum, and refuses what a debt may not be', () => {
    const ctx = testWorld(bundle);
    ctx.world.treasury = 1000;
    const p = place(ctx, { sex: 'male', age: 30, name: 'Held', contract: contract() });

    expect(order(ctx, { kind: 'bond', person: p.id, op: 'bind', marks: 0 }).ok).toBe(false);
    expect(order(ctx, { kind: 'bond', person: p.id, op: 'bind', marks: MAX_BOND + 1 }).ok).toBe(false);

    expect(order(ctx, { kind: 'bond', person: p.id, op: 'bind', marks: 100 }).ok).toBe(true);
    expect(isBonded(p)).toBe(true);
    expect(bondsmen(ctx).map((x) => x.id)).toContain(p.id);

    // No stacking: a second advance against a standing bond is how a debt
    // stops being payable, which is the tier this world does not have.
    const again = order(ctx, { kind: 'bond', person: p.id, op: 'bind', marks: 50 });
    expect(again.ok).toBe(false);
    expect(again.reason).toContain('bonded already');
  });

  it('frees, and refuses to free somebody who is not bound', () => {
    const ctx = testWorld(bundle);
    ctx.world.treasury = 1000;
    const p = place(ctx, { sex: 'male', age: 30, name: 'Held', contract: contract() });

    expect(order(ctx, { kind: 'bond', person: p.id, op: 'free' }).ok).toBe(false);
    order(ctx, { kind: 'bond', person: p.id, op: 'bind', marks: 100 });
    expect(order(ctx, { kind: 'bond', person: p.id, op: 'free' }).ok).toBe(true);
    expect(isBonded(p)).toBe(false);
  });

  it('refuses a bond the house cannot advance', () => {
    const ctx = testWorld(bundle);
    ctx.world.treasury = DEBT_FLOOR;
    const p = place(ctx, { sex: 'male', age: 30, name: 'Held', contract: contract() });
    const res = order(ctx, { kind: 'bond', person: p.id, op: 'bind', marks: 200 });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('cannot advance');
  });
});

describe('the bond pages speak the reader\'s setting (#732)', () => {
  const ORIGINALS = {
    'bond.advanced': '{PERSON} took {MARKS} marks from the house and gave the years back for it.',
    'bond.freed_title': 'The bond',
    'bond.forgiven':
      'The house tore up what {PERSON} still owed — {MARKS} marks of it — and said so where people could hear.',
    'bond.forgiven_with_resentment':
      'The house tore up what {PERSON} still owed — {MARKS} marks of it — and said so where people could hear. Not everybody who heard it was glad.',
    'bond.ended_empty': "{PERSON}'s bond was ended, there being nothing left on it worth the ink.",
    'bond.discharged': '{PERSON} finished paying the house what {PERSON} had borrowed, and stayed on for wages.',
  } as const;
  const PLAIN: Record<keyof typeof ORIGINALS, string> = {
    'bond.advanced': '{PERSON} borrowed {MARKS} marks from the house and agreed to work it off.',
    'bond.freed_title': 'The debt',
    'bond.forgiven': 'The house publicly cancelled the {MARKS} marks {PERSON} still owed.',
    // Different clause order proves the resentment case selects one whole
    // template instead of stitching an independently translated suffix.
    'bond.forgiven_with_resentment': 'Some who heard were displeased when the house publicly cancelled the {MARKS} marks {PERSON} still owed.',
    'bond.ended_empty': "{PERSON}'s debt was closed because nothing was left on it.",
    'bond.discharged': '{PERSON} paid off what {PERSON} owed the house and stayed on as a paid servant.',
  };

  /** Advance two, free one with others watching, free an empty bond, work one off. */
  function play(mode: 'original' | 'plainenglish') {
    const ctx = testWorld(bundle);
    ctx.world.treasury = 1000;
    setProseVariants(ctx, Object.entries(ORIGINALS).map(([key, original]) => ({
      address: coreMessageAddress(key),
      of: proseOriginalHash(original),
      plainenglish: PLAIN[key as keyof typeof ORIGINALS],
    })));
    setProseMode(ctx, mode);
    const a = place(ctx, { sex: 'male', age: 30, name: 'Anselm', contract: contract() });
    const b = place(ctx, { sex: 'male', age: 30, name: 'Berrin', contract: contract() });
    const c = place(ctx, { sex: 'male', age: 30, name: 'Cole', contract: contract({ term: 'bonded', debt: 0 }) });
    place(ctx, { sex: 'male', age: 30, name: 'Dunn', contract: contract({ term: 'bonded', debt: 4, wage: 6 }) });
    const from = ctx.world.chronicle.length;
    bindService(ctx, a, 100);
    bindService(ctx, b, 80);
    const freed = freeBond(ctx, a);
    freeBond(ctx, c);
    serviceBonds(ctx);
    // Nobody is left watching when Berrin goes, so his page has no resentment.
    freeBond(ctx, b);
    return { ctx, freed, pages: ctx.world.chronicle.slice(from) };
  }

  it('keeps every Original byte for byte', () => {
    const { pages, freed } = play('original');
    expect(freed.resented).toBeGreaterThan(0);
    expect(pages.map((e) => e.text)).toEqual([
      'Anselm took 100 marks from the house and gave the years back for it.',
      'Berrin took 80 marks from the house and gave the years back for it.',
      'The house tore up what Anselm still owed — 100 marks of it — and said so where people could hear.'
        + ' Not everybody who heard it was glad.',
      "Cole's bond was ended, there being nothing left on it worth the ink.",
      'Dunn finished paying the house what Dunn had borrowed, and stayed on for wages.',
      'The house tore up what Berrin still owed — 74 marks of it — and said so where people could hear.',
    ]);
    expect(pages.filter((e) => e.title === 'The bond')).toHaveLength(3);
  });

  it('renders the reviewed Plain English, and the page keeps it after the setting changes', () => {
    const { ctx, pages } = play('plainenglish');
    expect(pages.map((e) => e.text)).toEqual([
      'Anselm borrowed 100 marks from the house and agreed to work it off.',
      'Berrin borrowed 80 marks from the house and agreed to work it off.',
      'Some who heard were displeased when the house publicly cancelled the 100 marks Anselm still owed.',
      "Cole's debt was closed because nothing was left on it.",
      'Dunn paid off what Dunn owed the house and stayed on as a paid servant.',
      'The house publicly cancelled the 74 marks Berrin still owed.',
    ]);
    expect(pages.filter((e) => e.title === 'The debt')).toHaveLength(3);

    const chosenParagraph = pages[2]!.text;
    setProseMode(ctx, 'original');
    expect(pages[0]!.text).toBe('Anselm borrowed 100 marks from the house and agreed to work it off.');
    expect(pages[2]!.text).toBe(chosenParagraph);
    // A completed Chronicle page is frozen. Saving and loading do not render
    // the now-Original setting over what the reader saw before switching.
    const reloaded = loadGame(saveGame(ctx), bundle);
    expect(reloaded.world.chronicle.some((entry) => entry.text === chosenParagraph)).toBe(true);
  });

  it('changes words only: the debts, terms and loyalties are the same in both settings', () => {
    const strip = (r: ReturnType<typeof play>) => r.ctx.world.people.living()
      .filter((p) => p.contract).map((p) => ({ name: p.name, ...p.contract }));
    const original = play('original');
    const plainRun = play('plainenglish');
    expect(strip(plainRun)).toEqual(strip(original));
    expect(plainRun.ctx.world.treasury).toBe(original.ctx.world.treasury);
  });
});
