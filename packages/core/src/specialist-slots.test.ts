import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { ALL_AFFINITIES, EventTemplateS, FilterS, PoolSpecS, asId, runRule, type Person, type SlotSpec } from '@ed/schema';
import { acquireLibraryCopy, attr, beginStudy, completeStudies, degradeLibraryCopy, evalFilter, gainSpellbook, knowsAffinity, loseLibraryCopy, loseSpellbookKnowledge, makeRng, place, poolScore, resolveSlots, testWorld } from '@ed/core';
import type { SimCtx } from './world.js';
import { autoCast } from './events/slots.js';

const content = loadContent();
const slot = (extra: Partial<SlotSpec> = {}): SlotSpec => ({ role: 'family_member', castBy: 'engine', filters: [{ status: ['alive'] }], optional: false, bind: 'event', ...extra });
const eventWith = (spec: SlotSpec) => EventTemplateS.parse({ id: 'specialist_test', title: 'Specialist', tier: 'family', frequency: 'common', body: 'A test.', purposes: ['test_magic_rule', 'worldbuild_through_action', 'change_relationship'], slots: { WORKER: spec }, interaction: { kind: 'narration', outcomes: [{ id: 'done', text: 'Done.' }] } });
function set(ctx: SimCtx, p: Person, attribute: string, value: number) {
  p.acquired[attribute] = (p.acquired[attribute] ?? 0) + value - attr(p, attribute, ctx.genetics, ctx.world.year);
  if (p.phenotype) p.phenotype.dirty = true;
}

describe('completed affinity knowledge (#1796)', () => {
  it.each(ALL_AFFINITIES)('%s is learned by a man independently of a later missing physical copy', (affinity) => {
    const ctx = testWorld(content);
    const p = place(ctx, { sex: 'male', age: 30, awakened: true });
    const book = content.spellbook(`lesser_workings_of_${affinity}`)!;
    acquireLibraryCopy(ctx, book.id);
    expect(knowsAffinity(ctx, p, affinity)).toBe(false);
    expect(beginStudy(ctx, p, book)).toBe(true);
    expect(knowsAffinity(ctx, p, affinity)).toBe(false);
    ctx.world.year = ctx.world.studies.find((s) => s.person === p.id)!.completes;
    completeStudies(ctx);
    expect(knowsAffinity(ctx, p, affinity)).toBe(true);
    const copy = ctx.world.library.get(book.id)!;
    copy.restoresAt = ctx.world.year + 2;
    degradeLibraryCopy(ctx, book.id);
    expect(knowsAffinity(ctx, p, affinity)).toBe(true);
    loseLibraryCopy(ctx, book.id);
    expect(knowsAffinity(ctx, p, affinity)).toBe(true);
    loseSpellbookKnowledge(ctx, p, book.id);
    expect(knowsAffinity(ctx, p, affinity)).toBe(false);
  });

  it.each(ALL_AFFINITIES)('a woman may practise only Threshold knowledge: %s', (affinity) => {
    const ctx = testWorld(content);
    const p = place(ctx, { sex: 'female', age: 30, awakened: true });
    const allowed = ['life', 'death', 'light', 'darkness'].includes(affinity);
    expect(gainSpellbook(ctx, p, content.spellbook(`lesser_workings_of_${affinity}`)!)).toBe(allowed);
    expect(evalFilter({ knows: { affinity } }, p, ctx, {})).toBe(allowed);
    // Even a malformed manually supplied knowledge id cannot open Elemental practice.
    p.spellsKnown.push(asId(`lesser_workings_of_${affinity}`));
    expect(knowsAffinity(ctx, p, affinity)).toBe(allowed);
    expect(evalFilter({ all: [{ knows: { affinity } }, { not: { knows: { affinity: 'fluid' } } }] }, p, ctx, {})).toBe(allowed);
  });

  it('counts living spouses and cadets, but not a guardian, dead, departed or foreign reader', () => {
    const ctx = testWorld(content);
    for (const p of ctx.world.people.all()) p.spellsKnown = [];
    const spec = { kind: 'family_knows', affinity: 'life' } as const;
    expect(poolScore(ctx, spec, {})).toBe(0);
    const p = place(ctx, { sex: 'female', age: 30, branch: 'reader_hall' });
    p.membership[0]!.kind = 'married_in';
    p.spellsKnown.push(asId('lesser_workings_of_life'));
    expect(poolScore(ctx, spec, {})).toBe(1);
    expect(poolScore(ctx, { kind: 'family_knows', affinity: 'death' }, {})).toBe(0);
    p.status = 'guardian';
    expect(poolScore(ctx, spec, {})).toBe(0);
    p.status = 'dead';
    expect(poolScore(ctx, spec, {})).toBe(0);
    p.status = 'alive';
    p.membership[0]!.to = ctx.world.year;
    expect(poolScore(ctx, spec, {})).toBe(0);
    const outsider = place(ctx, { sex: 'male', age: 30, house: 'house_marrow' });
    outsider.spellsKnown.push(asId('lesser_workings_of_life'));
    expect(poolScore(ctx, spec, {})).toBe(0);
    for (const q of ctx.world.people.all()) q.membership = [];
    expect(poolScore(ctx, spec, {})).toBe(0);
  });
});

describe('a specialist is one eligible person (#1796)', () => {
  it('ranks after filtering, breaks ties by stable id, and reselects after a death', () => {
    const ctx = testWorld(content);
    const a = place(ctx, { sex: 'female', age: 30, name: 'Amice' });
    const b = place(ctx, { sex: 'male', age: 30, name: 'Gyles' });
    const outsider = place(ctx, { sex: 'male', age: 30, house: 'house_marrow' });
    for (const p of ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)) set(ctx, p, 'life', -1000);
    for (const p of [a, b, outsider]) {
      p.spellsKnown.push(asId('lesser_workings_of_life'));
      set(ctx, p, 'life', 1000); // clamped identically, so the ids resolve the tie
    }
    const e = eventWith(slot({ select: { bestBy: 'life' }, filters: [{ knows: { affinity: 'life' } }] }));
    const first = [a, b].sort((x, y) => x.id < y.id ? -1 : 1)[0]!;
    const other = first.id === a.id ? b : a;
    expect(resolveSlots(e, ctx, makeRng(1)).fill.WORKER).toBe(first.id);
    expect(resolveSlots(e, ctx, makeRng(999)).fill.WORKER).toBe(first.id);
    // A stronger non-reader is never allowed to replace a qualified reader.
    const unqualified = place(ctx, { sex: 'male', age: 30 });
    set(ctx, unqualified, 'life', 1000);
    first.status = 'dead';
    expect(resolveSlots(e, ctx, makeRng(2)).fill.WORKER).toBe(other.id);
    other.membership[0]!.to = ctx.world.year;
    expect(resolveSlots(e, ctx, makeRng(2)).ok).toBe(false);
  });

  it('preserves the random default and leaves player casting to the player', () => {
    const ctx = testWorld(content);
    const e = eventWith(slot());
    const rng = makeRng(177);
    const expected = makeRng(177).pick(ctx.world.people.household(ctx.world.playerHouse, ctx.world.year))!;
    expect(resolveSlots(e, ctx, rng).fill.WORKER).toBe(expected.id);
    e.slots.WORKER!.castBy = 'player';
    const resolution = resolveSlots(e, ctx, makeRng(177));
    expect(resolution.playerCast).toEqual(['WORKER']);
    expect(resolution.fill.WORKER).toBeUndefined();
    expect(autoCast(e, ctx, {}, resolution.playerCast, makeRng(177)).WORKER).toBe(expected.id);
  });

  it('scores all attributes on the selected person, without borrowing from another relative', () => {
    const ctx = testWorld(content);
    const a = place(ctx, { sex: 'female', age: 30 });
    const b = place(ctx, { sex: 'male', age: 30 });
    a.spellsKnown.push(asId('lesser_workings_of_life'));
    set(ctx, a, 'life', 30);
    const e = eventWith(slot({ filters: [{ knows: { affinity: 'life' } }], select: { bestBy: 'life' } }));
    const fill = resolveSlots(e, ctx, makeRng(8)).fill;
    const spec = { kind: 'slot', slot: 'WORKER', attrs: [{ attr: 'life', weight: .7 }, { attr: 'mind', weight: .3 }] } as const;
    const score = () => poolScore(ctx, { ...spec, attrs: [...spec.attrs] }, fill, e);
    const initial = score();
    set(ctx, b, 'mind', 1000);
    expect(score()).toBe(initial);
    set(ctx, a, 'mind', 1000);
    expect(score()).toBeGreaterThan(initial);
  });
});

describe('specialist authoring validation (#1796)', () => {
  it.each([{ castBy: 'player' }, { role: 'head' }, { count: { min: 2, max: 3 } }])('rejects unsupported automatic selection: %j', (extra) => {
    const e = eventWith(slot({ select: { bestBy: 'mind' }, ...extra } as Partial<SlotSpec>));
    const bundle = { ...content.bundle, events: [e] };
    expect(runRule('refs/known', bundle).some((i) => i.message.includes('bestBy requires'))).toBe(true);
  });

  it('rejects an unknown selection attribute and missing affinity definitions, including nested heirloom filters', () => {
    const e = eventWith(slot({ select: { bestBy: 'typo' }, filters: [{ not: { knows: { affinity: 'life' } } }] }));
    e.checks.push({ id: 'knowledge', pool: { kind: 'family_knows', affinity: 'life' }, difficulty: 1, variance: 'none', bands: [{ atLeast: 0, outcome: 'done' }] });
    const heirloom = structuredClone(content.bundle.heirlooms[0]!);
    heirloom.target = [{ any: [{ knows: { affinity: 'life' } }] }];
    const issues = runRule('refs/known', { ...content.bundle, events: [e], heirlooms: [heirloom], attributes: content.bundle.attributes.filter((a) => a.id !== 'life') });
    expect(issues.filter((i) => i.message.includes('unknown affinity')).length).toBe(3);
    expect(issues.some((i) => i.message.includes("unknown attribute 'typo'"))).toBe(true);
    expect(FilterS.safeParse({ knows: { affinity: 'mind' } }).success).toBe(false);
    expect(PoolSpecS.safeParse({ kind: 'family_knows', affinity: 'typo' }).success).toBe(false);
  });
});
