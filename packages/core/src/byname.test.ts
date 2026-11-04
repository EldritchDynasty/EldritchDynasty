import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import {
  bootstrap, bynameStanding, bynameView, grantReignByname, loadGame,
  saveGame, setProseMode, setProseVariants,
} from '@ed/core';

const bundle = loadContent();

function setup() {
  const ctx = bootstrap(bundle, 2287, 1042);
  const reign = ctx.world.succession[0]!;
  const person = ctx.world.people.get(reign.person)!;
  ctx.world.year = 1052;
  // Tests exercise the handover grant directly, without bypassing the one
  // PersonStore death gate or manufacturing a second succession mechanism.
  delete person.epithet;
  delete person.byname;
  return { ctx, reign, person };
}

function page(ctx: ReturnType<typeof bootstrap>, year: number, pen: 'record' | 'omit' | 'embellish') {
  ctx.world.chronicle.push({ year, record: pen, named: true, weight: 'page', text: pen === 'omit' ? null : pen });
}

describe('reign-end bynames (#2287)', () => {
  it('grants the majority pen on a committed handover and preserves exact saved provenance', () => {
    const { ctx, person, reign } = setup();
    page(ctx, 1044, 'record');
    page(ctx, 1045, 'record');
    page(ctx, 1046, 'record');
    page(ctx, 1047, 'omit');
    grantReignByname(ctx, reign);
    expect(person.epithet).toBe('of the Open Leaves');
    expect(person.byname).toEqual({
      source: { kind: 'reign', from: 1042, to: 1052, pen: 'record', pages: 4 },
      year: 1052,
    });
    expect(bynameStanding(person)).toBe('reign');
    expect(bynameView(person, 1051)).toBeUndefined();
    expect(bynameView(person, 1052)).toEqual({
      text: 'of the Open Leaves', standing: 'reign', year: 1052,
    });
    const loaded = loadGame(saveGame(ctx), bundle);
    const restored = loaded.world.people.get(person.id)!;
    expect(restored.byname).toEqual(person.byname);
    expect(restored.epithet).toBe(person.epithet);
    grantReignByname(loaded, reign);
    expect(restored.byname).toEqual(person.byname);
  });

  it('calls omitted reigns by their omissions, with original and Plain English wording', () => {
    const { ctx, person, reign } = setup();
    page(ctx, 1044, 'omit');
    page(ctx, 1045, 'omit');
    setProseVariants(ctx, bundle.proseVariants);
    setProseMode(ctx, 'plainenglish');
    grantReignByname(ctx, reign);
    expect(person.epithet).toBe('of the Unwritten Pages');
    expect(person.byname?.source.kind).toBe('reign');
    if (person.byname?.source.kind === 'reign') expect(person.byname.source.pen).toBe('omit');
  });

  it('uses a divided account for ties and ignores future or pre-reign pages', () => {
    const { ctx, person, reign } = setup();
    page(ctx, 1041, 'record');
    page(ctx, 1043, 'record');
    page(ctx, 1044, 'embellish');
    page(ctx, 1054, 'record');
    page(ctx, 1055, 'record');
    grantReignByname(ctx, reign);
    expect(person.epithet).toBe('of the Divided Book');
    if (person.byname?.source.kind === 'reign') {
      expect(person.byname.source.pages).toBe(2);
      expect(person.byname.source.pen).toBe('mixed');
    } else {
      throw new Error('expected a reign-source byname');
    }
  });

  it('refuses insufficient evidence and protects earlier authored or Record-earned epithets', () => {
    const { ctx, person, reign } = setup();
    page(ctx, 1043, 'record');
    grantReignByname(ctx, reign);
    expect(person.byname).toBeUndefined();
    page(ctx, 1044, 'record');
    person.epithet = 'the First Name';
    grantReignByname(ctx, reign);
    expect(person.epithet).toBe('the First Name');
    expect(person.byname).toBeUndefined();
    delete person.epithet;
    person.byname = { source: { kind: 'record', event: 'test', pen: 'record', page: 'p1' }, year: 1045 };
    grantReignByname(ctx, reign);
    expect(person.epithet).toBeUndefined();
    expect(person.byname.source.kind).toBe('record');
  });
});
