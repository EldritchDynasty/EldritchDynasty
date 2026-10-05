import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import {
  beget, bootstrap, makeRng, mint, place, previewTemplate, tickRespect,
} from '@ed/core';
import { inheritPost, releaseContracts } from './people/succession.js';

const bundle = loadContent();

describe('retainer contracts', () => {
  it('binds a minted retainer contract to the living Head', () => {
    const ctx = bootstrap(bundle, 5, 1042);
    const template = bundle.characterTemplates.find((t) => t.contract)!;
    const p = mint(template, ctx, makeRng(5), {
      household: ctx.world.playerHouse,
      membership: 'retainer',
    });

    const employer = ctx.world.people.get(p.contract!.boundTo);
    expect(employer, 'retainer was not bound to a person').toBeDefined();
    expect(employer!.castSlots).toContain('head');
  });

  it('releases service when its named employer is dead', () => {
    const ctx = bootstrap(bundle, 6, 1042);
    const template = bundle.characterTemplates.find((t) => t.contract)!;
    const p = mint(template, ctx, makeRng(6), {
      household: ctx.world.playerHouse,
      membership: 'retainer',
    });
    const employer = place(ctx, { sex: 'male', age: 60, name: 'Dead Employer' });
    employer.status = 'dead';
    employer.died = ctx.world.year - 3;

    p.contract!.boundTo = employer.id;
    p.contract!.term = 'lifetime';
    p.contract!.onEmployerDeath = 'released';

    const released = releaseContracts(ctx, makeRng(61));

    expect(p.contract).toBeUndefined();
    expect(released.map((entry) => entry.person.id)).toContain(p.id);
    expect(released.find((entry) => entry.person.id === p.id)?.reason).toBe('employer_died');
  });

  it('passes a hereditary post to an adult child before hiring a stranger', () => {
    const ctx = bootstrap(bundle, 7, 1042);
    const template = bundle.characterTemplates.find((t) => t.contract)!;
    const head = ctx.world.people.living().find((p) => p.castSlots.includes('head'))!;
    const holder = place(ctx, {
      sex: 'male',
      age: 55,
      name: 'Old Steward',
      contract: {
        ...template.contract!,
        knowsSecrets: [...template.contract!.knowsSecrets],
        term: 'hereditary',
        boundTo: head.id,
      },
    });
    const heir = place(ctx, { sex: 'male', age: 24, name: 'Young Steward' });
    beget(ctx, heir, undefined, holder);
    holder.status = 'dead';
    holder.died = ctx.world.year;

    const inherited = inheritPost(ctx, template.contract!.role);

    expect(inherited?.id).toBe(heir.id);
    expect(heir.contract?.role).toBe(template.contract!.role);
    expect(heir.contract?.term).toBe('hereditary');
    expect(heir.contract?.boundTo).toBe(head.id);
    expect(ctx.world.chronicle.at(-1)?.text).toContain('took up');
  });
});

describe('standing decay', () => {
  const quietYears = (from: 'known' | 'regarded' | 'eminent' | 'exalted', years: number) => {
    const ctx = bootstrap(bundle, 1042, 1042);
    ctx.world.respect = from;
    ctx.world.respectChanged = ctx.world.year;
    for (let i = 0; i < years; i++) {
      ctx.world.year += 1;
      tickRespect(ctx);
    }
    return ctx.world.respect;
  };

  it('costs tiers during long quiet stretches but never decays below Known', () => {
    expect(quietYears('eminent', 60)).toBe('regarded');
    expect(quietYears('exalted', 200)).toBe('known');
    expect(quietYears('known', 400)).toBe('known');
  });
});

describe('template previews', () => {
  it('rolls a real sample without spending world-local ids', () => {
    const ctx = bootstrap(bundle, 1042, 1042);
    const before = { ...ctx.world.counters };

    const sample = previewTemplate(
      bundle.characterTemplates[0]!,
      ctx,
      24,
      () => ({ carriedFont: 0, canExpress: false }),
      makeRng(11),
    );

    expect(sample.sample).toHaveLength(24);
    expect(ctx.world.counters).toEqual(before);
  });
});
