import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { FREQUENCY_PROFILES } from '@ed/schema';
import {
  bootstrap, runYears, makeRng, mint, mintForRole, pickTemplate,
  eligibleTemplates, previewTemplate, genomeOf, eldritch,
} from '@ed/core';

const bundle = loadContent();

describe('character templates', () => {
  it('authors at least one template for every role the sim asks for', () => {
    const needed = ['suitor', 'groom', 'retainer', 'rival', 'the_match'];
    for (const role of needed) {
      expect(bundle.characterTemplates.some((t) => t.role === role), role).toBe(true);
    }
  });

  it('names every gene pool it draws from', () => {
    const houses = new Set(bundle.houses.map((h) => h.id));
    for (const t of bundle.characterTemplates) {
      for (const h of t.houses) {
        expect(houses.has(h.house), `${t.id} -> ${h.house}`).toBe(true);
      }
    }
  });

  it('mints a person that matches its own recipe', () => {
    const ctx = bootstrap(bundle, 4, 1042);
    const rng = makeRng(4);
    for (const t of bundle.characterTemplates) {
      const p = mint(t, ctx, rng);
      const age = ctx.world.year - p.born;
      expect(age, t.id).toBeGreaterThanOrEqual(t.ageAtArrival.min);
      expect(age, t.id).toBeLessThanOrEqual(t.ageAtArrival.max);
      if (t.sex !== 'any') expect(p.sex, t.id).toBe(t.sex);
      expect(t.houses.map((h) => h.house)).toContain(p.houseOfOrigin);
      expect(p.mintedFrom).toBe(t.id);
      for (const trait of t.traits) expect(p.traits.has(trait as never), `${t.id}/${trait}`).toBe(true);
      for (const slot of t.castSlots) expect(p.castSlots).toContain(slot);
    }
  });

  /**
   * This used to assert `boundTo === playerHouse`, and asserting it is what
   * kept the bug alive: bound to a house, the employer can never die, so
   * `onEmployerDeath` was unreachable on every contract in the game and no
   * retainer's service could ever end. They bind to the HEAD who hired them.
   * The authored literal is still overwritten — that part was always right.
   */
  it('carries a template attribute bias into the minted person', () => {
    const ctx = bootstrap(bundle, 10, 1042);
    const template = bundle.characterTemplates.find((t) => Object.keys(t.bias).length > 0)!;
    const person = mint(template, ctx, makeRng(10));

    expect(Object.keys(template.bias).length).toBeGreaterThan(0);
    expect(person.genome.kind).toBe('lazy');
    if (person.genome.kind === 'lazy') expect(person.genome.bias).toEqual(template.bias);
  });

  it('binds retainer contracts to the head who hired them', () => {
    const ctx = bootstrap(bundle, 5, 1042);
    const rng = makeRng(5);
    const head = ctx.world.people.living().find((p) => p.castSlots.includes('head'));
    expect(head, 'no head in 1042').toBeDefined();

    for (const t of bundle.characterTemplates.filter((x) => x.contract)) {
      const p = mint(t, ctx, rng, { household: ctx.world.playerHouse, membership: 'retainer' });
      expect(p.contract?.boundTo).not.toBe(t.contract!.boundTo);
      expect(p.contract?.boundTo).toBe(head!.id);
    }
  });

  it('never mints a second unique while one is alive', () => {
    const ctx = bootstrap(bundle, 6, 1042);
    const rng = makeRng(6);
    const unique = bundle.characterTemplates.find((t) => t.unique && t.role === 'rival')!;
    mint(unique, ctx, rng);
    expect(eligibleTemplates(ctx, 'rival').map((t) => t.id)).not.toContain(unique.id);
  });

  it('respects the frequency gate — no mythic arrivals in generation one', () => {
    const ctx = bootstrap(bundle, 7, 1042);
    const rng = makeRng(7);
    const mythic = bundle.characterTemplates.filter((t) => t.frequency === 'mythic');
    expect(mythic.length).toBeGreaterThan(0);
    for (const t of mythic) {
      expect(ctx.world.generation).toBeLessThan(FREQUENCY_PROFILES.mythic.minGeneration);
      expect(eligibleTemplates(ctx, t.role).map((x) => x.id)).not.toContain(t.id);
    }
    void pickTemplate;
    void mintForRole;
    void rng;
  });

  /**
   * Preview is an editor affordance and must be free of side effects — a
   * designer rolling twenty-four suitors to inspect a recipe must not thereby
   * add twenty-four people to the world.
   */
  it('leaves no trace when previewing', () => {
    const ctx = bootstrap(bundle, 8, 1042);
    const rng = makeRng(8);
    const t = bundle.characterTemplates.find((x) => x.role === 'suitor')!;

    const before = ctx.world.people.size;
    const namesBefore = ctx.takenNames.size;
    const frequencyBefore = { ...ctx.world.characterFrequency.firedThisRun };

    const result = previewTemplate(t, ctx, 24, (p) => {
      const g = genomeOf(p, ctx.genetics);
      return eldritch(g, p.sex, ctx.genetics.table);
    }, rng);

    expect(result.sample.length).toBe(24);
    expect(ctx.world.people.size).toBe(before);
    expect(ctx.takenNames.size).toBe(namesBefore);
    expect(ctx.world.characterFrequency.firedThisRun).toEqual(frequencyBefore);
  });

  it('produces carriers at roughly the rate the gene pool advertises', () => {
    const ctx = bootstrap(bundle, 9, 1042);
    const rng = makeRng(9);
    const roll = (p: Parameters<typeof genomeOf>[0]) => {
      const g = genomeOf(p, ctx.genetics);
      return eldritch(g, p.sex, ctx.genetics.table);
    };

    // Calder is thin: essentially nobody carries anything.
    const calder = bundle.characterTemplates.find((t) => t.id === 'suitor_common_stock')!;
    const thin = previewTemplate(calder, ctx, 120, roll, rng);
    expect(thin.carrierRate).toBeLessThan(0.15);
  });
});

describe('the minting path in a full run', () => {
  it('keeps the recurring cast occupied across many generations', () => {
    /**
     * TWO SEEDS, because one deterministic history is not a succession rule.
     *
     * Founding inheritance (#344) legitimately re-rolls the whole campaign.
     * Seed 1042 now reaches year 1442 during a Wardship: adults are alive, but
     * the rightful heir is a minor and invariant 15 deliberately refuses to
     * skip that child for an available uncle or cousin. Seed 1079 still gives
     * the ordinary adult-successor case.
     */
    for (const seed of [1042, 1079]) {
      const ctx = bootstrap(bundle, seed, 1042);
      runYears(ctx, 400);
      const w = ctx.world;

      /**
       * A HOUSE THAT *CAN* SEAT A HEAD HAS ONE.
       *
       * There are exactly two legitimate reasons for a vacant seal:
       * - nobody of the blood is old enough to hold it; or
       * - the rightful heir is a living minor under Wardship.
       *
       * Adults existing elsewhere in the line do not cancel Wardship: seniority
       * is the rule, and the whole point of Wardship is that a minor can outrank
       * them. Any other "adult blood, no head" state still fails here.
       */
      const adultBlood = w.people.household(w.playerHouse, w.year).filter(
        (p) => p.status === 'alive'
          && p.membership.some((m) => m.kind === 'blood' || m.kind === 'cadet')
          && w.year - p.born >= 16,
      );
      const head = w.people.living().find((p) => p.castSlots.includes('head'));
      const ward = w.wardship ? w.people.get(w.wardship.ward) : undefined;
      const validWardship = ward !== undefined
        && ward.status === 'alive'
        && w.year - ward.born < 16;

      expect(
        adultBlood.length === 0 || head !== undefined || validWardship,
        `seed ${seed}: ${adultBlood.length} adult blood, no head, `
          + `wardship=${ward ? `${ward.name} age ${w.year - ward.born}` : 'none'}`,
      ).toBe(true);
    }
  });

  it('mints people from templates rather than from hardcoded spawns', () => {
    const ctx = bootstrap(bundle, 77, 1042);
    runYears(ctx, 300);
    const minted = ctx.world.people.all().filter((p) => p.mintedFrom);
    expect(minted.length).toBeGreaterThan(0);
    const ids = new Set(bundle.characterTemplates.map((t) => t.id));
    for (const p of minted) expect(ids.has(p.mintedFrom!), p.mintedFrom).toBe(true);
  });
});
