import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { indexContent } from '@ed/schema';
import { beget, place, testWorld } from './testing.js';
import { queueChoice } from './events/decisions.js';
import {
  adviceFor,
  adviceForDecision,
  type HelpSurface,
  type HelpTier,
} from './advisers.js';
import type { SimCtx } from './world.js';

const contentBundle = indexContent(loadContent());
const HELP_SURFACES: HelpSurface[] = ['tree', 'chronicle', 'branches'];
const HELP_TIERS: HelpTier[] = [1, 2, 3];

function clearLiving(ctx: SimCtx): void {
  for (const person of ctx.world.people.all()) {
    person.status = 'dead';
    person.castSlots = [];
  }
}

function helpWorld() {
  const ctx = testWorld(contentBundle, 273);
  clearLiving(ctx);
  const target = place(ctx, { sex: 'male', age: 21, name: 'Edren' });
  const reader = place(ctx, {
    sex: 'female',
    age: 43,
    name: 'Mara',
    career: { career: 'scholar', heldYears: 8 },
  });
  beget(ctx, target, reader);
  return { ctx, target, reader };
}

function helpLines(ctx: SimCtx, target: string) {
  return HELP_SURFACES.flatMap((surface) =>
    HELP_TIERS.flatMap((tier) => adviceFor(
      ctx,
      surface,
      surface === 'tree' ? target : surface === 'chronicle' ? 'the-chronicle' : 'the-main-hall',
      tier,
    )));
}

describe('adviser knowledge boundary (#273)', () => {
  it('keeps the adviser module an epistemic cul-de-sac by import allow-list', () => {
    const source = readFileSync(new URL('./advisers.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);

    expect(imports).toEqual([
      '@ed/schema',
      './world.js',
      './events/decisions.js',
      './people/match.js',
    ]);
    expect(imports.some((path) => /genetics\/|bearing|rng|checks/i.test(path ?? ''))).toBe(false);
  });

  it('keeps advice templates out of the Bearing vocabulary', () => {
    const source = readFileSync(new URL('./advisers.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

    // Mirrors prose/bearing's forbidden vocabulary, and also guards the
    // internal mechanic's own names from being spoken by counsel.
    expect(source).not.toMatch(/\b(?:pride|proud|arrogance|arrogant|hubris|vanity|vain|bearing|carriage)\b/i);
  });

  it('does not change help when only a hidden attribute changes', () => {
    const a = helpWorld();
    const b = helpWorld();
    const hidden = contentBundle.attributes.find((attribute) => attribute.kind === 'hidden');
    expect(hidden, 'real content needs a hidden attribute for this boundary test').toBeDefined();

    a.reader.acquired[String(hidden!.id)] = 0;
    b.reader.acquired[String(hidden!.id)] = 91;

    expect(helpLines(a.ctx, a.target.id)).toEqual(helpLines(b.ctx, b.target.id));
  });

  it('does not change help when only an unawakened adviser can express', () => {
    const a = helpWorld();
    const b = helpWorld();
    expect(a.reader.awakening.awakened).toBe(false);
    expect(b.reader.awakening.awakened).toBe(false);

    const cache = (canExpress: boolean) => ({
      attrs: new Map<string, number>(),
      eldritch: {
        carriedFont: 0,
        canExpress,
        expressedPower: 0,
        overflowMadness: 0,
        ceiling: 0,
      },
      computedAtYear: a.ctx.world.year,
      dirty: false,
    });
    a.reader.phenotype = cache(false);
    b.reader.phenotype = cache(true);

    expect(helpLines(a.ctx, a.target.id)).toEqual(helpLines(b.ctx, b.target.id));
  });

  it('keeps a renamed rite classified from its structured effect', () => {
    const ctx = testWorld(contentBundle, 274);
    clearLiving(ctx);
    const priest = place(ctx, {
      sex: 'female',
      age: 40,
      name: 'Sister Elian',
      career: { career: 'clergy' },
    });
    const source = ctx.content.event('the_vessel_rite');
    expect(source).toBeDefined();

    const event = { ...source!, id: 'ordinary_page', title: 'A Quiet Question' };
    const pending = queueChoice(ctx, event, event.body, {}, []);
    const advice = adviceForDecision(ctx, pending);

    expect(advice).toHaveLength(1);
    expect(advice[0]?.adviser.id).toBe(priest.id);
    expect(advice[0]?.lens).toBe('priest');
    expect(advice[0]?.position).toContain('With a rite');
  });

  it('uses sex-correct pronouns for a woman adviser at every help tier', () => {
    const { ctx, target, reader } = helpWorld();
    const lines = helpLines(ctx, target.id);
    expect(lines.length).toBeGreaterThan(0);

    for (const line of lines) {
      expect(line.adviser.id).toBe(reader.id);
      expect(`${line.cares} ${line.position}`).not.toMatch(/\b(?:he|his|him)\b/i);
    }
  });

  it('keeps every help line attributed and free of numeric oracle text', () => {
    const { ctx, target } = helpWorld();

    for (const surface of HELP_SURFACES) {
      for (const tier of HELP_TIERS) {
        const subject = surface === 'tree'
          ? target.id
          : surface === 'chronicle' ? 'the-chronicle' : 'the-main-hall';
        const lines = adviceFor(ctx, surface, subject, tier);
        expect(lines.length, `${surface} tier ${tier} had no living adviser`).toBeGreaterThan(0);
        for (const line of lines) {
          expect(line.adviser.name.length).toBeGreaterThan(0);
          expect(`${line.position} ${line.cares}`).not.toMatch(/\d/);
        }
      }
    }
  });

  it('returns exactly the tier requested rather than preloading a later answer', () => {
    const { ctx, target } = helpWorld();
    const first = adviceFor(ctx, 'tree', target.id, 1);
    const second = adviceFor(ctx, 'tree', target.id, 2);
    const third = adviceFor(ctx, 'tree', target.id, 3);

    expect(first[0]?.position).not.toEqual(second[0]?.position);
    expect(second[0]?.position).not.toEqual(third[0]?.position);
    expect(first[0]?.position).not.toContain('Find somebody by name');
    expect(second[0]?.position).not.toContain('Find somebody by name');
    expect(third[0]?.position).toContain('Find somebody by name');
  });
});
