import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { asId, type Person } from '@ed/schema';
import { attr, beginStudy, completeStudies, gainSpellbook, makeRng, place, poolScore, resolveSlots, testWorld, type SimCtx } from '@ed/core';
import { executeOutcomeWitness } from './events/reach.js';

const content = loadContent();
function set(ctx: SimCtx, p: Person, key: string, value: number) {
  p.acquired[key] = (p.acquired[key] ?? 0) + value - attr(p, key, ctx.genetics, ctx.world.year);
  if (p.phenotype) p.phenotype.dirty = true;
}
function fixture() {
  const ctx = testWorld(content);
  for (const p of ctx.world.people.all()) p.spellsKnown = [];
  return ctx;
}

describe('ordinary family challenges (#1796)', () => {
  it.each([
    ['the_smoke_above_the_store', 'fluid'], ['the_wind_under_the_slates', 'aero'],
    ['the_fever_and_the_vigil', 'life'], ['the_cawdry_copy', 'light'],
  ])('%s changes a committed outcome only when the matching book was learned', (id, affinity) => {
    const event = content.event(id)!;
    for (const learned of [false, true]) {
      const ctx = fixture();
      const p = place(ctx, { sex: affinity === 'life' || affinity === 'light' ? 'female' : 'male', age: 30, awakened: true, name: 'Amice the Reader' });
      const book = content.spellbook(`lesser_workings_of_${affinity}`)!;
      if (learned) expect(gainSpellbook(ctx, p, book)).toBe(true);
      else ctx.world.library.set(book.id, { id: book.id, condition: 100, acquiredYear: ctx.world.year });
      const before = ctx.world.treasury;
      const result = executeOutcomeWitness(ctx, event, { choiceId: `use_${affinity}`, expectedOutcomeId: learned ? 'held' : 'lost', rng: makeRng(9) });
      expect(result.ok, result.reason).toBe(true);
      expect(ctx.world.treasury - before).toBe(learned ? -10 : -35);
      if (learned) expect(ctx.world.chronicle.some((entry) => entry.eventId === id && entry.text?.includes(p.name))).toBe(true);
    }
  });

  it('a woman completing normal Life study changes the same ordinary scene', () => {
    const ctx = fixture();
    const p = place(ctx, { sex: 'female', age: 30, awakened: true, name: 'Amice' });
    const book = content.spellbook('lesser_workings_of_life')!;
    expect(beginStudy(ctx, p, book)).toBe(true);
    const e = content.event('the_fever_and_the_vigil')!;
    expect(executeOutcomeWitness(ctx, e, { choiceId: 'use_life', expectedOutcomeId: 'lost', rng: makeRng(1) }).ok).toBe(true);
    ctx.world.year = ctx.world.studies.find((study) => study.person === p.id)!.completes;
    completeStudies(ctx);
    const result = executeOutcomeWitness(ctx, e, { choiceId: 'use_life', expectedOutcomeId: 'held', rng: makeRng(2) });
    expect(result.ok, result.reason).toBe(true);
    expect(ctx.world.chronicle.some((entry) => entry.eventId === e.id && entry.text?.includes('Amice'))).toBe(true);
  });

  it('the strongest Darkness reader uses that reader\'s Mind, not the household maximum', () => {
    const event = content.event('the_cawdry_copy')!;
    for (const improve of ['neither', 'other', 'reader'] as const) {
      const ctx = fixture();
      const reader = place(ctx, { sex: 'female', age: 30, awakened: true, name: 'Amice' });
      const other = place(ctx, { sex: 'male', age: 30, name: 'The Scholar' });
      expect(gainSpellbook(ctx, reader, content.spellbook('lesser_workings_of_darkness')!)).toBe(true);
      set(ctx, reader, 'darkness', 20);
      set(ctx, reader, 'mind', improve === 'reader' ? 60 : 20);
      set(ctx, other, 'mind', improve === 'other' ? 100 : 20);
      set(ctx, other, 'darkness', 100); // high affinity alone is not a working
      const fill = resolveSlots(event, ctx, makeRng(3)).fill;
      expect(fill.COVER).toBe(reader.id);
      const check = event.checks.find((c) => c.id === 'practised_working')!;
      expect(poolScore(ctx, check.pool, fill, event)).toBe(improve === 'reader' ? 32 : 20);
      const result = executeOutcomeWitness(ctx, event, { choiceId: 'use_darkness', expectedOutcomeId: improve === 'reader' ? 'held' : 'lost', rng: makeRng(3) });
      expect(result.ok, result.reason).toBe(true);
    }
  });

  it('a nonmagical specialist also uses one person\'s combined attributes', () => {
    const e = content.event('the_smoke_above_the_store')!;
    for (const improve of ['other', 'rescuer'] as const) {
      const ctx = fixture();
      for (const p of ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)) set(ctx, p, 'strength', 0);
      const rescuer = place(ctx, { sex: 'female', age: 30, name: 'Amice' });
      const other = place(ctx, { sex: 'male', age: 30 });
      set(ctx, rescuer, 'strength', 60);
      set(ctx, rescuer, 'agility', improve === 'rescuer' ? 30 : 10);
      set(ctx, other, 'strength', 30);
      set(ctx, other, 'agility', 100);
      expect(resolveSlots(e, ctx, makeRng(4)).fill.EXPERT).toBe(rescuer.id);
      const result = executeOutcomeWitness(ctx, e, { choiceId: 'send_specialist', expectedOutcomeId: improve === 'rescuer' ? 'held' : 'lost', rng: makeRng(4) });
      expect(result.ok, result.reason).toBe(true);
    }
  });

  it('the player sends either relative, and the outcome and injury belong to that participant', () => {
    const event = content.event('the_wick_bridge_load')!;
    for (const strong of [false, true]) {
      const ctx = fixture();
      const weak = place(ctx, { sex: 'female', age: 30, name: 'Amice' });
      const sturdy = place(ctx, { sex: 'male', age: 30, name: 'Gyles' });
      for (const key of ['strength', 'agility']) { set(ctx, weak, key, 20); set(ctx, sturdy, key, 70); }
      const sent = strong ? sturdy : weak;
      const original = sent.acquired.health ?? 0;
      const result = executeOutcomeWitness(ctx, event, { choiceId: strong ? 'lifted' : 'paid', expectedOutcomeId: strong ? 'clear' : 'wet', cast: { SENT: sent.id }, rng: makeRng(5) });
      expect(result.ok, result.reason).toBe(true);
      expect(sent.acquired.health).toBe(original - (strong ? 1 : 3));
      expect(ctx.world.chronicle.some((entry) => entry.eventId === event.id && entry.text?.includes(sent.name))).toBe(true);
      expect((strong ? weak : sturdy).acquired.health ?? 0).toBe(0);
    }
  });

  it('uses every family primitive and each affinity in reachable authored checks or filters', () => {
    const events = content.events.filter((e) => e.tags.includes('family_challenge'));
    expect(events).toHaveLength(5);
    const kinds = new Set(events.flatMap((e) => e.checks.map((c) => c.pool.kind)));
    for (const kind of ['family_sum', 'family_max', 'family_any', 'family_knows']) expect(kinds.has(kind as never)).toBe(true);
    expect(events.some((e) => e.conditions && 'familyAny' in e.conditions)).toBe(true);
    const affinities = new Set(events.flatMap((e) => Object.values(e.slots).flatMap((s) => s.filters.flatMap((f) => 'knows' in f ? [f.knows.affinity] : []))));
    expect(affinities.size).toBe(8);
  });
});
