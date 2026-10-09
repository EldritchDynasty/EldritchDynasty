import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { proseOriginalHash } from '@ed/schema';
import {
  ASSIZE_RESPONSES, armOf, assizeFavour, assizePressure, measureFortune,
  newGame, phase, place, resumeGame, setProseMode, setProseVariants, testWorld,
} from '@ed/core';
import type { SimCtx } from '@ed/core';
import { coreMessageAddress } from './messages.js';

const bundle = loadContent();

/**
 * THE ASSIZE (`assize.ts`) — the world's opinion of the house, and what it
 * does about it.
 *
 * The failure it answers: across fourteen thousand-year runs of the shipped
 * game, no house died out, none fell below ten people, every player-driven run
 * recovered nine of nine clauses, and standing landed on exalted almost every
 * time. Nothing in the world reacted to the house, so the run had feedback of
 * neither sign.
 */
describe('how the world reads the house', () => {
  it('reads a rich, respected, populous house as ahead', () => {
    const ctx = testWorld(bundle, 4242);
    ctx.world.treasury = 6000;
    ctx.world.respect = 'exalted';
    for (let i = 0; i < 24; i++) place(ctx, { sex: i % 2 ? 'male' : 'female', age: 20 + i });

    expect(measureFortune(ctx).score).toBeGreaterThan(0.6);
    expect(assizePressure(ctx)).toBeGreaterThan(0.4);
  });

  it('reads a broke, unknown, dwindling house as behind', () => {
    const ctx = testWorld(bundle, 4243);
    ctx.world.treasury = -100;
    ctx.world.respect = 'unknown';
    // A house with a living expresser and a hall of people is never at the
    // floor, however empty the strongbox. What matters is that it is far
    // enough under for the steadying arm to reach it — see `STEADIES_AT`.
    expect(assizePressure(ctx)).toBeLessThan(-0.26);
  });

  it('raises the bar across a complete Long Line', () => {
    const early = testWorld(bundle, 4244);
    early.world.treasury = 700;
    const late = testWorld(bundle, 4244);
    late.world.treasury = 700;
    late.world.year = 1542;

    expect(assizePressure(late)).toBeLessThan(assizePressure(early));
  });

  it('reads equivalent progress the same way in Short and Long campaigns', () => {
    // #133: this used to divide by a literal 1000, so Short at its term and
    // Long at its term had different world expectations despite both being
    // 100% through their bargain.
    const short = testWorld(bundle, 42441);
    short.world.campaign = 'short';
    short.world.year = 1342;
    short.world.treasury = 700;

    const long = testWorld(bundle, 42441);
    long.world.campaign = 'long';
    long.world.year = 1542;
    long.world.treasury = 700;

    expect(assizePressure(short)).toBeCloseTo(assizePressure(long), 10);
  });
});

describe('what the world does about it', () => {
  it('says so out loud, every time', () => {
    // A hidden rubber band is a lie the player can feel and cannot name. Every
    // response writes a line naming who did what.
    const ctx = testWorld(bundle);
    for (const r of ASSIZE_RESPONSES) {
      expect(r.line(ctx).length, `${r.id} acts silently`).toBeGreaterThan(30);
      expect(armOf(r)).toBe(r.arm);
    }
  });

  it('offers both arms, and enough of each to not be read by the fourth century', () => {
    const resents = ASSIZE_RESPONSES.filter((r) => r.arm === 'resents');
    const steadies = ASSIZE_RESPONSES.filter((r) => r.arm === 'steadies');
    expect(resents.length).toBeGreaterThanOrEqual(6);
    expect(steadies.length).toBeGreaterThanOrEqual(6);
    expect(new Set(ASSIZE_RESPONSES.map((r) => r.id)).size).toBe(ASSIZE_RESPONSES.length);
  });

  it('charges a house that is plainly doing well', () => {
    const ctx = testWorld(bundle, 4245);
    ctx.world.treasury = 9000;
    ctx.world.respect = 'exalted';
    for (let i = 0; i < 26; i++) place(ctx, { sex: i % 2 ? 'male' : 'female', age: 22 + (i % 30) });
    ctx.world.assize.lastSitting = ctx.world.year - 40;

    const before = ctx.world.treasury;
    // Long enough for a sitting to land; the interval is twelve years.
    for (let i = 0; i < 30; i++) {
      phase('assize', ctx);
      ctx.world.year += 1;
    }
    expect(ctx.world.treasury, 'nothing was ever asked of a house with nine thousand crowns')
      .toBeLessThan(before);
  });

  it('steadies a house that is plainly failing', () => {
    const ctx = testWorld(bundle, 4246);
    ctx.world.treasury = -110;
    ctx.world.respect = 'unknown';
    ctx.world.assize.lastSitting = ctx.world.year - 40;

    let helped = false;
    for (let i = 0; i < 40 && !helped; i++) {
      phase('assize', ctx);
      ctx.world.year += 1;
      helped = ctx.world.treasury > -110
        || assizeFavour(ctx, 'favour')
        || assizeFavour(ctx, 'mercy');
    }
    expect(helped, 'the world watched a house starve and did nothing').toBe(true);
  });
});

describe('the Assize speaks the reader\'s setting (#757)', () => {
  const plainFor = (id: string) => `The world acted (${id}).`;
  function speak(ctx: SimCtx, mode: 'original' | 'plainenglish'): SimCtx {
    const original = testWorld(bundle);
    setProseVariants(ctx, ASSIZE_RESPONSES.map((r) => ({
      address: coreMessageAddress(`assize.${r.id}`), of: proseOriginalHash(r.line(original)), plainenglish: plainFor(r.id),
    })));
    setProseMode(ctx, mode);
    return ctx;
  }

  it('gives every response its own reviewed Plain English line', () => {
    const ctx = speak(testWorld(bundle), 'plainenglish');
    for (const r of ASSIZE_RESPONSES) expect(r.line(ctx)).toBe(plainFor(r.id));
  });

  /** A rich house, ticked until the world charges it; the same draws either way. */
  function sitting(mode: 'original' | 'plainenglish') {
    const ctx = speak(testWorld(bundle, 4245), mode);
    ctx.world.treasury = 9000;
    ctx.world.respect = 'exalted';
    for (let i = 0; i < 26; i++) place(ctx, { sex: i % 2 ? 'male' : 'female', age: 22 + (i % 30) });
    ctx.world.assize.lastSitting = ctx.world.year - 40;
    const from = ctx.world.chronicle.length;
    for (let i = 0; i < 30 && Object.keys(ctx.world.assize.fired).length === 0; i++) {
      phase('assize', ctx);
      ctx.world.year += 1;
    }
    const [id] = Object.keys(ctx.world.assize.fired);
    expect(id, 'no sitting landed').toBeDefined();
    return { ctx, id: id!, page: ctx.world.chronicle.slice(from).at(-1)! };
  }

  it('writes the same sitting in both settings, and the page keeps its words', () => {
    const original = sitting('original');
    const plain = sitting('plainenglish');
    expect(plain.id).toBe(original.id);
    expect(original.page.text).toBe(ASSIZE_RESPONSES.find((r) => r.id === original.id)!.line(testWorld(bundle)));
    expect(plain.page.text).toBe(plainFor(plain.id));
    expect(plain.ctx.world.treasury).toBe(original.ctx.world.treasury);
    expect(plain.ctx.world.discontent).toBe(original.ctx.world.discontent);
    setProseMode(plain.ctx, 'original');
    expect(plain.page.text).toBe(plainFor(plain.id));
  });
});
