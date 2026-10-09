import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import type { RetainerContract } from '@ed/schema';
import { proseOriginalHash } from '@ed/schema';
import { coreMessageAddress } from './messages.js';
import {
  bootstrap, DEBT_FLOOR, dismissRetainer, driftLoyalty, leakChance, place, releaseContracts,
  setProseMode, setProseVariants, tellSecrets, testRng, walkSecrets, yearsOfService,
} from '@ed/core';
import type { SimCtx } from '@ed/core';

const bundle = loadContent();

/**
 * SECRETS THAT WALK.
 *
 * `knowsSecrets` and `loyalty` were filled in on every authored contract and
 * read by nothing for the whole life of the project, which is invariant 11's
 * exact shape and looks from the outside like a feature that has not come up
 * yet. Nothing here asserts that a function returns: each test asserts that
 * something the house did changes what the world outside it can prove.
 */

/** Clear the founding cast, so the only staff in the world is the test's. */
function emptyHouse(seed = 1042): SimCtx {
  const ctx = bootstrap(bundle, seed, 1042);
  for (const p of ctx.world.people.living()) {
    ctx.world.people.kill(p.id, ctx.world.year, 'before the test began');
  }
  for (const p of ctx.world.people.all()) p.castSlots = [];
  ctx.world.looseSecrets = [];
  ctx.world.discrepancies.clear();
  return ctx;
}

const contract = (over: Partial<RetainerContract> = {}): RetainerContract => ({
  role: 'archivist',
  term: 'lifetime',
  wage: 40,
  loyalty: 50,
  boundTo: 'nobody',
  onEmployerDeath: 'released',
  debt: 0,
  knowsSecrets: [],
  ...over,
});

/** A retainer who has been in post `years` years and knows one thing. */
function staffed(over: Partial<RetainerContract> = {}, years = 4) {
  const ctx = emptyHouse();
  const employer = place(ctx, { sex: 'male', age: 50, name: 'Employer' });
  employer.castSlots.push('head');
  const servant = place(ctx, { sex: 'female', age: 40, name: 'Ilsabet' });
  servant.membership = [{
    house: ctx.world.playerHouse as never,
    kind: 'retainer',
    from: ctx.world.year - years,
  }];
  servant.contract = contract({ boundTo: employer.id, knowsSecrets: ['what_the_archive_holds' as never], ...over });
  ctx.world.treasury = 500;
  return { ctx, employer, servant };
}

describe('what leaves with them', () => {
  it('lets a secret walk when service ends badly', () => {
    const { ctx, servant } = staffed({ loyalty: 0 });
    walkSecrets(ctx, servant, servant.contract!, 'unpaid', testRng('walk'));

    expect(ctx.world.looseSecrets.map((l) => l.secret)).toEqual(['what_the_archive_holds']);
    expect(ctx.world.looseSecrets[0]!.carrierName).toBe('Ilsabet');
    expect(ctx.world.looseSecrets[0]!.house).not.toBe(ctx.world.playerHouse);
  });

  it('freezes reviewed Chronicle messages when a secret walks and is told (#727)', () => {
    const { ctx, servant } = staffed({ loyalty: 0 });
    const walkedOriginal =
      '{CARRIER} took a place elsewhere within the year, and took the rest of it along.';
    const toldOriginal =
      'Something this house has never written down was known at {HOUSE} by the spring, '
      + 'and the road it came by ran through {CARRIER}. '
      + 'Nobody there was rude about it. They simply had it.';
    setProseVariants(ctx, [
      {
        address: coreMessageAddress('secrets.walked'),
        of: proseOriginalHash(walkedOriginal),
        plainenglish: '{CARRIER} left the household that year and took its secrets elsewhere.',
      },
      {
        address: coreMessageAddress('secrets.told'),
        of: proseOriginalHash(toldOriginal),
        plainenglish: 'By spring, {HOUSE} knew what the family had never recorded. {CARRIER} had brought the secret there.',
      },
    ]);
    setProseMode(ctx, 'plainenglish');
    const walked = walkSecrets(ctx, servant, servant.contract!, 'unpaid', testRng('walk'));
    expect(walked).toHaveLength(1);
    const departure = ctx.world.chronicle.at(-1)!;
    expect(departure.text).toBe('Ilsabet left the household that year and took its secrets elsewhere.');
    expect(walked[0]!.page).toBe(departure.id);

    ctx.world.year += 3;
    let told = false;
    for (let i = 0; i < 400; i++) {
      if (tellSecrets(ctx, testRng(`tell-${i}`)).length > 0) { told = true; break; }
    }
    expect(told).toBe(true);
    const report = ctx.world.chronicle.at(-1)!;
    const house = ctx.world.houses.get(walked[0]!.house)?.name ?? walked[0]!.house;
    expect(report.text).toBe(
      `By spring, ${house} knew what the family had never recorded. Ilsabet had brought the secret there.`,
    );
    expect(report.cause?.page).toBe(departure.id);
    expect(ctx.world.discrepancies.get(walked[0]!.secret)?.state).toBe('open');

    // The prose preference selects words only when the Chronicle entry is
    // written; mode changes must not rewrite historical pages or proofs.
    setProseMode(ctx, 'original');
    expect(departure.text).toBe('Ilsabet left the household that year and took its secrets elsewhere.');
    expect(report.text).toContain('Ilsabet had brought the secret there.');
  });

  it('keeps the secret of somebody who had no reason to talk', () => {
    // Loyalty 100 released on the employer's death is the floor chance, 2%.
    // A hundred draws off one stream is the honest way to say "almost never"
    // without pinning the test to one seed reaching one state.
    const kept = Array.from({ length: 100 }, (_, i) => {
      const { ctx, servant } = staffed({ loyalty: 100 }, 30);
      walkSecrets(ctx, servant, servant.contract!, 'employer_died', testRng(`kept-${i}`));
      return ctx.world.looseSecrets.length;
    });
    expect(kept.filter((n) => n > 0).length).toBeLessThan(12);
  });

  it('prices loyalty, the manner of leaving, and long service, in that order', () => {
    const loyal = contract({ loyalty: 90 });
    const sullen = contract({ loyalty: 20 });
    expect(leakChance(sullen, 'employer_died', 0)).toBeGreaterThan(leakChance(loyal, 'employer_died', 0));
    expect(leakChance(loyal, 'destitute', 0)).toBeGreaterThan(leakChance(loyal, 'employer_died', 0));
    expect(leakChance(loyal, 'dismissed', 0)).toBeGreaterThan(leakChance(loyal, 'employer_died', 0));
    expect(leakChance(loyal, 'unpaid', 30)).toBeLessThan(leakChance(loyal, 'unpaid', 0));
  });

  it('reads the contract before the release clears it', () => {
    // The whole reason `releaseContracts` captures the contract first: a
    // secret read after `p.contract = undefined` is a secret nobody knows,
    // which is how this field would have gone on doing nothing.
    let leaked = 0;
    for (let i = 0; i < 20; i++) {
      const { ctx, employer, servant } = staffed({ loyalty: 0, onEmployerDeath: 'released' });
      ctx.world.people.kill(employer.id, ctx.world.year, 'a fever');

      expect(releaseContracts(ctx, testRng(`release-${i}`)).map((r) => r.person.id)).toEqual([servant.id]);
      expect(servant.contract).toBeUndefined();
      leaked += ctx.world.looseSecrets.length;
    }
    // Read after the release rather than before, this is zero every time.
    expect(leaked).toBeGreaterThan(0);
  });

  it('dismisses through the same secret path, then closes the retainer membership', () => {
    let leaked = 0;
    for (let i = 0; i < 20; i++) {
      const { ctx, servant } = staffed({ loyalty: 0 }, 25);
      expect(yearsOfService(ctx, servant)).toBe(25);

      const ended = dismissRetainer(ctx, servant, testRng(`dismiss-${i}`));

      expect(ended?.reason).toBe('dismissed');
      expect(servant.contract).toBeUndefined();
      expect(servant.membership[0]?.to).toBe(ctx.world.year);
      leaked += ctx.world.looseSecrets.length;
    }
    // The release path reads service length and the contract before either is
    // closed. A second dismissal-specific secret formula would make this test
    // pass for the wrong reason, so the assertion exercises the shared path.
    expect(leaked).toBeGreaterThan(0);
  });

  it('does not let two servants make the same secret loose twice', () => {
    const { ctx, servant } = staffed({ loyalty: 0 });
    const second = place(ctx, { sex: 'male', age: 45, name: 'Other' });
    second.contract = contract({ loyalty: 0, knowsSecrets: ['what_the_archive_holds' as never] });

    walkSecrets(ctx, servant, servant.contract!, 'unpaid', testRng('a'));
    walkSecrets(ctx, second, second.contract!, 'unpaid', testRng('b'));
    expect(ctx.world.looseSecrets).toHaveLength(1);
  });

  it('is worth more from somebody who was there nineteen years', () => {
    const long = staffed({ loyalty: 0 }, 25);
    walkSecrets(long.ctx, long.servant, long.servant.contract!, 'unpaid', testRng('long'));
    const short = staffed({ loyalty: 0 }, 2);
    walkSecrets(short.ctx, short.servant, short.servant.contract!, 'unpaid', testRng('short'));

    expect(long.ctx.world.looseSecrets[0]!.severity).toBe('major');
    expect(short.ctx.world.looseSecrets[0]!.severity).toBe('minor');
  });
});

describe('a secret that is told', () => {
  /** One loose secret, out for `years` years, and nothing else in the world. */
  function loose(years: number, over: Partial<SimCtx['world']['looseSecrets'][number]> = {}) {
    const ctx = emptyHouse();
    ctx.world.looseSecrets = [{
      secret: 'what_the_archive_holds',
      carrier: 'p_gone',
      carrierName: 'Ilsabet',
      house: 'house_marrow',
      since: ctx.world.year - years,
      severity: 'minor',
      ...over,
    }];
    return ctx;
  }

  /** Run the telling roll until it lands, so no test pins itself to one seed. */
  function tellEventually(ctx: SimCtx, tries = 400): boolean {
    for (let i = 0; i < tries; i++) {
      if (tellSecrets(ctx, testRng(`tell-${i}`)).length) return true;
    }
    return false;
  }

  it('becomes an open Discrepancy the house that took her can prove', () => {
    const ctx = loose(20);
    expect(tellEventually(ctx)).toBe(true);

    const d = ctx.world.discrepancies.get('what_the_archive_holds');
    expect(d, 'a told secret that is not a Discrepancy is a told secret nothing can act on').toBeDefined();
    expect(d!.state).toBe('open');
    expect(d!.provableBy).toContain('house_marrow');
    expect(ctx.world.looseSecrets[0]!.told).toBe(ctx.world.year);
  });

  it('is not told the year she leaves', () => {
    const ctx = loose(0);
    expect(tellEventually(ctx, 60)).toBe(false);
    expect(ctx.world.discrepancies.size).toBe(0);
  });

  it('is told once and then left alone', () => {
    const ctx = loose(20);
    expect(tellEventually(ctx)).toBe(true);
    const told = ctx.world.looseSecrets[0]!.told;
    for (let i = 0; i < 200; i++) tellSecrets(ctx, testRng(`again-${i}`));
    expect(ctx.world.looseSecrets[0]!.told).toBe(told);
    expect(ctx.world.discrepancies.get('what_the_archive_holds')!.provableBy).toEqual(['house_marrow']);
  });

  it('digs a buried thing back up, and leaves a proven one proven', () => {
    const buried = loose(20);
    buried.world.discrepancies.set('what_the_archive_holds', {
      severity: 'major', provableBy: ['the_church'], state: 'buried',
    });
    expect(tellEventually(buried)).toBe(true);
    const d = buried.world.discrepancies.get('what_the_archive_holds')!;
    expect(d.state, 'burying it settled the house\'s record and nothing outside it').toBe('open');
    expect(d.provableBy).toEqual(['the_church', 'house_marrow']);

    const proven = loose(20);
    proven.world.discrepancies.set('what_the_archive_holds', {
      severity: 'major', provableBy: ['the_church'], state: 'proven',
    });
    expect(tellEventually(proven)).toBe(true);
    expect(proven.world.discrepancies.get('what_the_archive_holds')!.state).toBe('proven');
  });
});

describe('loyalty is earned and spent', () => {
  it('rises while the house pays, and falls while it cannot', () => {
    const { ctx, servant } = staffed({ loyalty: 50 });
    driftLoyalty(ctx);
    expect(servant.contract!.loyalty).toBeGreaterThan(50);

    ctx.world.treasury = DEBT_FLOOR;
    const paid = servant.contract!.loyalty;
    driftLoyalty(ctx);
    expect(servant.contract!.loyalty).toBeLessThan(paid);
  });

  it('never buys silence outright, and never runs past nothing', () => {
    const { ctx, servant } = staffed({ loyalty: 99 });
    for (let i = 0; i < 200; i++) driftLoyalty(ctx);
    expect(servant.contract!.loyalty).toBeLessThanOrEqual(100);
    expect(servant.contract!.loyalty).toBeLessThan(99);

    ctx.world.treasury = DEBT_FLOOR;
    for (let i = 0; i < 200; i++) driftLoyalty(ctx);
    expect(servant.contract!.loyalty).toBe(0);
  });

  it('does not write a servant\'s bad year back into the content bundle', () => {
    // The seed characters used to be handed the AUTHORED contract object, and
    // the bundle is shared by every world in the process. One destitute run
    // set the next run's starting loyalty (INVARIANT 8) — and `year.test.ts`
    // catches it as two identical seeds diverging.
    const authored = bundle.characters.find((c) => c.contract)!;
    const before = authored.contract!.loyalty;
    const ctx = bootstrap(bundle, 77, 1042);
    ctx.world.treasury = DEBT_FLOOR;
    for (let i = 0; i < 50; i++) driftLoyalty(ctx);
    expect(authored.contract!.loyalty).toBe(before);
  });
});
