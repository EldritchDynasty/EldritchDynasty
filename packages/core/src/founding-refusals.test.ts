import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadContent } from '@ed/content';
import { proseOriginalHash } from '@ed/schema';
import {
  HOUSE_NAME_MAX, foundHouse, missingPlainEnglish, newGame, resumeGame, saveGame, setProseMode, setProseVariants,
  testWorld, type SimCtx,
} from '@ed/core';
import { coreMessageAddress } from './messages.js';

const content = loadContent();

const CHOICE = {
  houseName: 'The House of Salt',
  heirloom: 'portion_of_agelessness',
  grudge: 'house_marrow',
};

/** Every `msg(ctx|this.ctx, 'founding.refuse.…', original…)` call in one source file. */
function keyed(file: string): [string, string][] {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  return [...source.matchAll(/msg\((?:this\.)?ctx,\s*'(founding\.refuse\.[^']+)',\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)]
    .map(([, key, literal]) => [key!, literal!.slice(1, -1)] as [string, string]);
}

/** The exact Original of every founding and Examination refusal (#812). */
const FOUNDING_ORIGINALS: Record<string, string> = {
  'founding.refuse.no_prologue': 'this bundle has no prologue',
  'founding.refuse.founded': 'the house has already been founded',
  'founding.refuse.no_name': 'the house needs a name',
  'founding.refuse.long_name': 'that is a paragraph, not a name',
  'founding.refuse.heirloom': 'he did not ask for that',
  'founding.refuse.grudge': 'nobody was wronged in that direction',
  'founding.refuse.content_gone': 'the content no longer holds that',
  'founding.refuse.answer': 'the Examination answer was not understood',
  'founding.refuse.signing_retainer': "the signing names unavailable retainer '{RETAINER}'",
  'founding.refuse.signing_house': "the signing names missing house '{HOUSE}'",
};

const SESSION_ORIGINALS: Record<string, string> = {
  'founding.refuse.examination_restart': 'the Examination can only be answered from a new run',
  'founding.refuse.examination_late': 'the Examination belongs before the first year or decision',
};

function translate(ctx: SimCtx, originals: Record<string, string>): void {
  setProseVariants(ctx, Object.entries(originals).map(([key, original]) => ({
    address: coreMessageAddress(key),
    of: proseOriginalHash(original),
    plainenglish: `plain:${key}`,
  })));
  setProseMode(ctx, 'plainenglish');
}

describe('founding and Examination refusals in Plain English (#812)', () => {
  it('pins every keyed Original at its own call site', () => {
    const prologue = keyed('./prologue.ts');
    const session = keyed('./session.ts');
    expect(Object.fromEntries(prologue)).toEqual(FOUNDING_ORIGINALS);
    expect(prologue).toHaveLength(Object.keys(FOUNDING_ORIGINALS).length);
    expect(Object.fromEntries(session)).toEqual(SESSION_ORIGINALS);
    expect(session).toHaveLength(Object.keys(SESSION_ORIGINALS).length);
  });

  it('translates a refused founding and writes nothing to the world', () => {
    const refusals = [
      { ...CHOICE, houseName: '   ' },
      { ...CHOICE, houseName: 'x'.repeat(HOUSE_NAME_MAX + 1) },
      { ...CHOICE, heirloom: 'the_ninefold_seal' },
      { ...CHOICE, grudge: 'commons' },
    ];
    const run = (plain: boolean) => {
      const ctx = testWorld(content);
      if (plain) translate(ctx, FOUNDING_ORIGINALS);
      const before = { treasury: ctx.world.treasury, chronicle: ctx.world.chronicle.length };
      const results = refusals.map((choice) => foundHouse(ctx, choice));
      return {
        results,
        founding: ctx.world.founding,
        after: { treasury: ctx.world.treasury, chronicle: ctx.world.chronicle.length },
        before,
        missing: missingPlainEnglish(ctx),
      };
    };
    const original = run(false);
    const translated = run(true);
    expect(original.results).toEqual([
      { ok: false, reason: 'the house needs a name' },
      { ok: false, reason: 'that is a paragraph, not a name' },
      { ok: false, reason: 'he did not ask for that' },
      { ok: false, reason: 'nobody was wronged in that direction' },
    ]);
    expect(translated.results).toEqual([
      { ok: false, reason: 'plain:founding.refuse.no_name' },
      { ok: false, reason: 'plain:founding.refuse.long_name' },
      { ok: false, reason: 'plain:founding.refuse.heirloom' },
      { ok: false, reason: 'plain:founding.refuse.grudge' },
    ]);
    for (const r of [original, translated]) {
      expect(r.founding).toBeUndefined();
      expect(r.after).toEqual(r.before);
    }
    expect(translated.missing).toEqual([]);
  });

  it('translates the once-only refusal without disturbing the first founding', () => {
    const ctx = testWorld(content);
    expect(foundHouse(ctx, CHOICE).ok).toBe(true);
    translate(ctx, FOUNDING_ORIGINALS);
    expect(foundHouse(ctx, { ...CHOICE, houseName: 'A Second Thought' }))
      .toEqual({ ok: false, reason: 'plain:founding.refuse.founded' });
    expect(ctx.world.founding?.houseName).toBe('The House of Salt');
  });

  it('translates the session refusals for a late or resumed Examination', () => {
    const late = newGame(content, { seed: 8121, decider: 'chronicler' });
    late.advance(1);
    const signed = { ...CHOICE, founderName: 'Arlen Gearithy' };
    expect(late.found(signed)).toEqual({ ok: false, reason: SESSION_ORIGINALS['founding.refuse.examination_late'] });
    translate(late.ctx, SESSION_ORIGINALS);
    const lateCtx = late.ctx;
    expect(late.found(signed)).toEqual({ ok: false, reason: 'plain:founding.refuse.examination_late' });
    expect(late.ctx).toBe(lateCtx);
    expect(late.ctx.world.founding).toBeUndefined();

    const resumed = resumeGame(saveGame(newGame(content, { seed: 8122 }).ctx), content);
    expect(resumed.found(signed))
      .toEqual({ ok: false, reason: SESSION_ORIGINALS['founding.refuse.examination_restart'] });
    translate(resumed.ctx, SESSION_ORIGINALS);
    expect(resumed.found(signed)).toEqual({ ok: false, reason: 'plain:founding.refuse.examination_restart' });
    expect(resumed.ctx.world.founding).toBeUndefined();
  });
});
