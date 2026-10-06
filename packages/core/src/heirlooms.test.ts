import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { validateBundle } from '@ed/schema';
import {
  bootstrap, runYears, attr, applyEffect, commitOutcome,
  canUseHeirloom, eligibleBearers, grantHeirloom, testRng, useHeirloom,
} from '@ed/core';

const bundle = loadContent();

/** A living adult of the house, for a bearer. */
function someone(ctx: ReturnType<typeof bootstrap>) {
  const w = ctx.world;
  return w.people
    .household(w.playerHouse, w.year)
    .filter((p) => w.year - p.born >= 20 && w.year - p.born <= 40)[0]!;
}

describe('the heirloom content', () => {
  it('validates', () => {
    expect(validateBundle(bundle).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('authors the two portions', () => {
    const ids = bundle.heirlooms.map((h) => h.id);
    expect(ids).toContain('portion_of_agelessness');
    expect(ids).toContain('portion_of_fertility');
  });

  it('gives every heirloom a spend rule and something to do', () => {
    for (const h of bundle.heirlooms) {
      expect(['consumed', 'cooldown', 'reusable'], h.id).toContain(h.use.spends);
      expect(h.effects.length, `${h.id} does nothing`).toBeGreaterThan(0);
    }
  });

  it('is reachable — the house either starts with it or an event grants it', () => {
    // TWO routes, not one. An heirloom the house is handed in 1042 is acquired
    // as surely as one won at auction, and the Regalia is acquired that way on
    // purpose: authoring a `grant` for a thing the family has held since the
    // founding would mean writing the scene where they are given it, which is
    // the prologue, which is not an ambient event. What this test is actually
    // about is unchanged — no heirloom may be unreachable by every route.
    const reachable = new Set<string>(
      bundle.houses.filter((h) => h.isPlayerHouse).flatMap((h) => h.heirlooms),
    );
    for (const e of bundle.events) {
      const groups = e.interaction.kind === 'narration'
        ? [e.interaction.outcomes]
        : e.interaction.choices.map((c) => c.outcomes);
      for (const o of groups.flat()) {
        for (const eff of o.effects) {
          if (eff.kind === 'heirloom' && eff.op === 'grant') reachable.add(eff.heirloom);
        }
      }
    }
    for (const h of bundle.heirlooms) {
      expect(reachable.has(h.id), `${h.id} can never be acquired`).toBe(true);
    }
  });
});

describe('arc heirlooms do not spend the ambient frequency ration', () => {
  it('records a rare arc node without moving the rare cap or cooldown', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const led = ctx.world.frequency;
    const before = { fired: led.firedThisRun.rare, last: led.lastFiredYear.rare };
    const node = bundle.events.find((e) => e.arc && e.frequency === 'rare')!;
    const outcome = node.interaction.kind === 'narration'
      ? node.interaction.outcomes[0]!
      : node.interaction.choices[0]!.outcomes[0]!;
    const choiceId = node.interaction.kind === 'narration' ? undefined : node.interaction.choices[0]!.id;

    commitOutcome(ctx, node, outcome, {}, choiceId, testRng('regalia-ration'));

    expect(led.templateFires[String(node.id)]).toBe(1);
    expect(led.firedThisRun.rare).toBe(before.fired);
    expect(led.lastFiredYear.rare).toBe(before.last);
  });

  it('still spends the rare ration for an ambient event', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const led = ctx.world.frequency;
    const ambient = bundle.events.find((e) => !e.arc && e.frequency === 'rare' && e.tier !== 'frame')!;
    const outcome = ambient.interaction.kind === 'narration'
      ? ambient.interaction.outcomes[0]!
      : ambient.interaction.choices[0]!.outcomes[0]!;
    const choiceId = ambient.interaction.kind === 'narration' ? undefined : ambient.interaction.choices[0]!.id;

    commitOutcome(ctx, ambient, outcome, {}, choiceId, testRng('ambient-ration'));

    expect(led.firedThisRun.rare).toBe(1);
    expect(led.lastFiredYear.rare).toBe(ctx.world.year);
  });
});

describe('applying an heirloom is generic', () => {
  it('refuses one the house does not hold', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const p = someone(ctx);
    expect(canUseHeirloom(ctx, 'portion_of_agelessness', p).ok).toBe(false);
  });

  it('applies its effects to the bearer through the normal effect path', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const p = someone(ctx);
    const before = attr(p, 'max_age', ctx.genetics, ctx.world.year);

    grantHeirloom(ctx, 'portion_of_agelessness');
    expect(useHeirloom(ctx, 'portion_of_agelessness', p).ok).toBe(true);

    expect(attr(p, 'max_age', ctx.genetics, ctx.world.year)).toBeCloseTo(before + 42, 5);
  });

  it('lengthens a life rather than a number — the bearer outlives the untouched', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const p = someone(ctx);
    grantHeirloom(ctx, 'portion_of_agelessness');
    useHeirloom(ctx, 'portion_of_agelessness', p);
    const ceiling = attr(p, 'max_age', ctx.genetics, ctx.world.year);

    runYears(ctx, 400);
    // Whatever killed them, the ceiling moved with them.
    if (p.died !== undefined) expect(p.died - p.born - ceiling).toBeLessThan(1);
    expect(ceiling).toBeGreaterThan(110);
  });

  it('changes nothing the bearer\'s children inherit', () => {
    const ctx = bootstrap(bundle, 77, 1042);
    const p = someone(ctx);
    grantHeirloom(ctx, 'portion_of_agelessness');
    useHeirloom(ctx, 'portion_of_agelessness', p);
    // The acquired layer is not heritable: longevity, the genome-side
    // attribute, is untouched.
    expect(p.acquired.max_age).toBe(42);
    const longevity = attr(p, 'longevity', ctx.genetics, ctx.world.year);
    expect(Number.isFinite(longevity)).toBe(true);
    expect(p.acquired.longevity ?? 0).toBe(0);
  });
});

describe('the spend flag', () => {
  it('consumed: one use, then never again', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const [a, b] = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)
      .filter((p) => ctx.world.year - p.born >= 20);
    grantHeirloom(ctx, 'portion_of_agelessness');

    expect(useHeirloom(ctx, 'portion_of_agelessness', a!).ok).toBe(true);
    const second = useHeirloom(ctx, 'portion_of_agelessness', b!);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('it is spent');
    expect(ctx.world.heirlooms.get('portion_of_agelessness')!.spent).toBe(true);
  });

  it('cooldown: not twice in the same generation, and it says how long', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const p = someone(ctx);
    grantHeirloom(ctx, 'portion_of_fertility');

    expect(useHeirloom(ctx, 'portion_of_fertility', p).ok).toBe(true);

    const again = canUseHeirloom(ctx, 'portion_of_fertility', p);
    expect(again.ok).toBe(false);
    expect(again.reason).toBe('it is not ready');
    expect(again.readyIn).toBe(60);
  });

  it('cooldown: ready again once the years have passed', () => {
    // 909 was pinned here and reliably survives to 2042 no longer — a house's
    // own founding-century mortality (issue #42) now correctly ends the run
    // in 1074 for that seed, well inside this test's 70-year window. 910
    // does not; picked from a batch check rather than trusted on sight.
    const ctx = bootstrap(bundle, 910, 1042);
    grantHeirloom(ctx, 'portion_of_fertility');
    useHeirloom(ctx, 'portion_of_fertility', someone(ctx));

    runYears(ctx, 70);
    const later = eligibleBearers(ctx, 'portion_of_fertility');
    expect(later.length, 'nobody in the house could take it seventy years on').toBeGreaterThan(0);
  });

  it('charges run out even when the spend rule would allow another', () => {
    // 5150 broke in 1109 under the same founding-century mortality (issue
    // #42), inside this test's 195-year span. 5151 does not.
    const ctx = bootstrap(bundle, 5151, 1042);
    grantHeirloom(ctx, 'portion_of_fertility');
    const state = ctx.world.heirlooms.get('portion_of_fertility')!;
    expect(state.usesLeft).toBe(3);

    for (let i = 0; i < 3; i++) {
      const bearer = eligibleBearers(ctx, 'portion_of_fertility')[0];
      if (bearer) useHeirloom(ctx, 'portion_of_fertility', bearer);
      runYears(ctx, 65);
    }
    expect(state.usesLeft).toBeLessThanOrEqual(0);
    expect(state.spent).toBe(true);
  });
});

describe('targeting', () => {
  it('refuses somebody the heirloom is not for', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    grantHeirloom(ctx, 'portion_of_fertility');
    const old = ctx.world.people
      .household(ctx.world.playerHouse, ctx.world.year)
      .find((p) => ctx.world.year - p.born > 48);
    if (!old) return;
    const check = canUseHeirloom(ctx, 'portion_of_fertility', old);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('they are not who it is for');
  });

  it('refuses the dead', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    grantHeirloom(ctx, 'portion_of_agelessness');
    const p = someone(ctx);
    ctx.world.people.kill(p.id, ctx.world.year, 'for the test');
    expect(canUseHeirloom(ctx, 'portion_of_agelessness', p).ok).toBe(false);
  });

  it('is granted by the effect verb, not by hand', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    applyEffect({ kind: 'heirloom', op: 'grant', heirloom: 'portion_of_agelessness' }, ctx, {});
    expect(ctx.world.heirlooms.has('portion_of_agelessness')).toBe(true);
  });

  /**
   * THE REGALIA IS OWNED BY SOMEBODY.
   *
   * `story/Age-1.md` fixes three named objects on the table in 1042 and makes
   * Demigod require all three held at once; `arcs/seal.yaml` loses one of them
   * to a cousin; `seal_the_regalia_incomplete` has the Church count "two where
   * three were sworn to"; two frame interludes react to the count. All of that
   * ran for a year against `world.heirlooms` starting empty in every run —
   * three files arguing about the ownership of nothing. There was no failure,
   * because counting an empty set is not an error.
   */
  it('puts the Regalia in the house\'s hands in 1042', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    expect([...ctx.world.heirlooms.keys()].sort())
      .toEqual(['the_ninefold_seal', 'the_ring', 'the_rod']);
  });

  it('reads the founding list off the player house, not off a constant', () => {
    const home = bundle.houses.find((h) => h.isPlayerHouse)!;
    expect(home.heirlooms.length, 'the player house declares its founding possessions').toBe(3);
    for (const id of home.heirlooms) {
      expect(bundle.heirlooms.some((h) => h.id === id), `${id} is a real heirloom`).toBe(true);
    }
    // A rival naming heirlooms must not put them in the player's hands:
    // `HeirloomState` has no owner field, so honouring the list anywhere but
    // the player house would hand the player everything every house owns.
    const rival = bundle.houses.find((h) => !h.isPlayerHouse)!;
    expect(rival.heirlooms).toEqual([]);
  });

  it('leaves the seal reusable and the other two rationed', () => {
    const byId = new Map(bundle.heirlooms.map((h) => [h.id, h]));
    expect(byId.get('the_ninefold_seal')!.use.spends).toBe('reusable');
    for (const id of ['the_ring', 'the_rod']) {
      const h = byId.get(id)!;
      expect(h.use.spends, id).toBe('cooldown');
      expect(h.use.charges, `${id} is rationed across the run`).toBeLessThanOrEqual(8);
    }
    // None of the three may be sold. A house that auctions its own Regalia has
    // not made a trade, it has ended the only run in which Demigod is reachable.
    for (const id of ['the_ninefold_seal', 'the_ring', 'the_rod']) {
      expect(byId.get(id)!.cannotBeSold, id).toBe(true);
    }
  });
});

