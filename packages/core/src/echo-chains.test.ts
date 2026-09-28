import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import type { RetainerContract } from '@ed/schema';
import {
  ECHO_AFTER, addGrudge, bootstrap, causeOf, evalCondition, grudgeAgainstUs, place,
  tellSecrets, testRng, tickRelationships, walkSecrets,
} from '@ed/core';
import type { SimCtx } from '@ed/core';
import { echoLineTally } from './echoes.js';

const bundle = loadContent();

/**
 * ECHO CHAINS BILLED BY SOMEBODY OTHER THAN BEARING (issue #326).
 *
 * #211 asked for act -> echo -> bill chains "spanning different systems", with
 * the bill "mechanically resolved by the system that already owns it". Every
 * chain it shipped was Bearing's. These are two whose bill is not: a grudge,
 * billed by the relationships system, and a secret that walked, billed by the
 * Discrepancy system. Each test plays the chain deterministically, the way
 * `bearing.test.ts` plays Bearing's.
 */

function world(seed = 7101): SimCtx {
  const ctx = bootstrap(bundle, seed, 1042);
  ctx.world.relationships.clear();
  ctx.world.looseSecrets = [];
  ctx.world.discrepancies.clear();
  return ctx;
}

const newLines = (ctx: SimCtx, from: number) => ctx.world.chronicle.slice(from);

describe('a grudge, a generation on (billed by the relationships system)', () => {
  function feud(ctx: SimCtx, severity = 60) {
    const rival = place(ctx, { sex: 'male', age: 30, name: 'Oswy Marrow', house: 'house_marrow' });
    const ours = place(ctx, { sex: 'male', age: 30, name: 'Aldo' });
    const origin = ctx.content.events.find((e) => e.title)!;
    const grudge = addGrudge(ctx, rival.id, ours.id, { severity, inheritance: 'house_wide' }, origin.id, 'chr_origin');
    return { rival, ours, origin, grudge };
  }

  it('echoes once, a generation later, linked to where it began, while it is still held', () => {
    const ctx = world();
    const start = ctx.world.year;
    const { origin } = feud(ctx);
    const before = ctx.world.chronicle.length;

    ctx.world.year = start + ECHO_AFTER - 1;
    tickRelationships(ctx);
    expect(newLines(ctx, before), 'no echo before the generation has passed').toHaveLength(0);

    ctx.world.year = start + ECHO_AFTER;
    tickRelationships(ctx);
    const echoes = newLines(ctx, before);
    expect(echoes).toHaveLength(1);
    expect(echoes[0]!.text).toContain('House Marrow');
    expect(echoes[0]!.text).toContain(origin.title);
    expect(echoes[0]!.cause).toEqual({ year: start, page: 'chr_origin' });

    tickRelationships(ctx);
    expect(newLines(ctx, before), 'an origin echoes only once').toHaveLength(1);
  });

  it('leaves the bill with the grudge: it is still held, and content can read it', () => {
    const ctx = world();
    const start = ctx.world.year;
    feud(ctx);
    ctx.world.year = start + ECHO_AFTER;
    tickRelationships(ctx);
    expect(grudgeAgainstUs(ctx.world)).toBeGreaterThan(50);
    expect(evalCondition({ grudgeAgainstUs: { op: 'gte', value: 50 } }, ctx)).toBe(true);
  });

  it('hears a house once a generation, however many quarrels it holds', () => {
    const ctx = world();
    const start = ctx.world.year;
    feud(ctx);
    feud(ctx, 70);
    const before = ctx.world.chronicle.length;
    ctx.world.year = start + ECHO_AFTER;
    tickRelationships(ctx);
    expect(newLines(ctx, before)).toHaveLength(1);
  });

  it('says nothing of a quarrel that has already faded — an echo claims only what is true', () => {
    const ctx = world();
    const start = ctx.world.year;
    feud(ctx, 3);
    const before = ctx.world.chronicle.length;
    for (let y = 1; y <= ECHO_AFTER; y++) {
      ctx.world.year = start + y;
      tickRelationships(ctx);
    }
    expect(grudgeAgainstUs(ctx.world)).toBe(0);
    expect(newLines(ctx, before)).toHaveLength(0);
  });
});

describe('a secret that walked (billed by the Discrepancy system)', () => {
  const contract = (boundTo: string): RetainerContract => ({
    role: 'archivist', term: 'lifetime', wage: 40, loyalty: 0, boundTo: boundTo as never,
    onEmployerDeath: 'released', debt: 0, knowsSecrets: ['what_the_archive_holds' as never],
  });

  it('links the page that tells it back to the page that saw them go, and opens the bill', () => {
    const ctx = world(7102);
    const employer = place(ctx, { sex: 'male', age: 50, name: 'Employer' });
    const servant = place(ctx, { sex: 'female', age: 40, name: 'Ilsabet' });
    servant.membership = [{ house: ctx.world.playerHouse as never, kind: 'retainer', from: ctx.world.year - 20 }];
    servant.contract = contract(employer.id);

    for (let i = 0; i < 200 && !ctx.world.looseSecrets.length; i++) {
      walkSecrets(ctx, servant, servant.contract, 'unpaid', testRng('walk', i));
    }
    const loose = ctx.world.looseSecrets[0];
    expect(loose, 'the secret never walked').toBeDefined();
    const left = ctx.world.chronicle.find((c) => c.id === loose!.page);
    expect(left?.text, 'the page that saw them go').toContain('Ilsabet');

    ctx.world.year += 20;
    let told = false;
    for (let i = 0; i < 400 && !told; i++) told = tellSecrets(ctx, testRng('tell', i)).length > 0;
    expect(told).toBe(true);

    const page = ctx.world.chronicle.at(-1)!;
    expect(page.discrepancyId).toBe('what_the_archive_holds');
    expect(page.cause).toEqual({ year: loose!.since, page: loose!.page });
    expect(causeOf(ctx, page.id!)?.page, 'the backlink resolves to a real page').toBe(loose!.page);

    // The bill is the Discrepancy system's: open, provable by the house that
    // took her, and read by the PRESSURE pass and the creditor.
    expect(ctx.world.discrepancies.get('what_the_archive_holds')?.state).toBe('open');
    expect(evalCondition({ openDiscrepancies: { op: 'gte', value: 1 } }, ctx)).toBe(true);
  });
});

describe('the echo tally reads frames, not words (issues #326, #276)', () => {
  it('counts copies of one frame across systems, and ignores every other page', () => {
    const line = (echo?: string) => ({ year: 1100, weight: 'line' as const, text: 'anything at all', named: false, ...(echo ? { echoFrame: echo } : {}) });
    const t = echoLineTally([
      line('bearing:took_the_cousin:0'), line('bearing:took_the_cousin:0'), line('bearing:took_the_cousin:1'),
      line('grudge:2'), line(), line(),
    ]);
    expect(t).toEqual({ written: 4, maxCopies: 2, bySystem: { bearing: 3, grudge: 1 } });
  });
});
