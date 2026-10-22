import { describe, expect, it, vi } from 'vitest';
import { loadContent } from '@ed/content';
import { EventTemplateS, asId, runRule } from '@ed/schema';
import { place, testWorld } from '../testing.js';
import { genomeOf, phenotypeOf } from '../people/factory.js';
import { ELDRITCH_GIFT } from '../genetics/expression.js';
import { assessHarm } from './harm.js';
import { previewPrimordial, rollPrimordial } from './primordial.js';
import { commitOutcome, queueChoice, queueRecord, resolveChoice, resolveRecord } from './decisions.js';
import { makeRng, streamFor } from '../rng.js';
import { loadGame, saveGame, canonical } from '../save.js';
import { interventionsOf } from '../session.js';
import { recurringGrossIncome } from '../economy.js';
import { grantHeirloom } from '../people/heirlooms.js';

const content = loadContent();
function expresser(ctx: ReturnType<typeof testWorld>, name: string, branch?: string) {
  const source = ctx.world.people.living().find(p => phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch.canExpress)!;
  const p = place(ctx, { name, sex: 'male', age: 30, awakened: true, branch });
  p.genome = { kind: 'materialized', genome: genomeOf(source, ctx.genetics) };
  p.phenotype = undefined;
  p.acquired[ELDRITCH_GIFT] = 1000;
  return p;
}
function scene() {
  return EventTemplateS.parse({
    id: 'emergency_witness', title: 'The Falling Beam', tier: 'family', frequency: 'common',
    purposes: ['change_standing', 'test_magic_rule', 'worldbuild_through_action'],
    slots: { VICTIM: { role: 'family_member' } }, body: 'The beam cracks above {VICTIM}.',
    site: { kind: 'hall', hall: 'main' },
    interaction: { kind: 'narration', outcomes: [{ id: 'fatal', text: 'The beam fell.',
      effects: [{ kind: 'status', target: { slot: 'VICTIM' }, status: 'dead' }, { kind: 'treasury', delta: -90 }],
      primordial: { id: 'caught', text: '{PRIMORDIAL_ACTOR} held the beam in the air. The door still broke.',
        effects: [{ kind: 'treasury', delta: -20 }], record: null } }] },
  });
}

describe('pending harm assessment (#1868)', () => {
  it('uses actual family targets, net category losses, first debt and pre-shock income', () => {
    const ctx = testWorld(content); ctx.world.treasury = 1;
    const victim = place(ctx, { sex: 'female', age: 12 });
    const outsider = place(ctx, { sex: 'male', age: 30, house: 'house_marrow' });
    expect(assessHarm(ctx, { effects: [{ kind: 'treasury', delta: -2 }] }, {}).categories).toEqual(['financial']);
    ctx.world.treasury = -2;
    expect(assessHarm(ctx, { effects: [{ kind: 'treasury', delta: -2 }] }, {}).categories).toEqual([]);
    const assessed = assessHarm(ctx, { effects: [{ kind: 'status', target: { slot: 'V' }, status: 'dead' }, { kind: 'treasury', delta: 200 }] }, { V: victim.id });
    expect(assessed.categories).toContain('life');
    expect(assessHarm(ctx, { effects: [{ kind: 'status', target: { slot: 'V' }, status: 'dead' }] }, { V: outsider.id }).categories).toEqual([]);
    expect(assessHarm(ctx, { effects: [{ kind: 'status', target: 'head', status: 'dead' }] }, {}).categories).toEqual([]);
    expect(assessHarm(ctx, { effects: [{ kind: 'treasury', delta: -100 }, { kind: 'treasury', delta: 100 }] }, {}).cashLoss).toBe(0);
  });

  it('does not count absent assets; aggregates distinct titles, estate yield and tiers', () => {
    const ctx = testWorld(content);
    expect(assessHarm(ctx, { effects: [{ kind: 'land', op: 'seize', parcel: 'cradlemoor' }, { kind: 'spellbook', op: 'remove_copy', target: 'head', book: 'not_owned' }] }, {}).categories).toEqual([]);
    const parcel = [...ctx.world.parcels.values()].find(p => p.defId === 'the_home_demesne')!;
    expect(assessHarm(ctx, { effects: [{ kind: 'land', op: 'seize', parcel: parcel.defId! }] }, {}).categories).toContain('estate');
    for (const id of ['lesser_workings_of_life', 'lesser_workings_of_death', 'lesser_workings_of_light']) ctx.world.library.set(id, { id, acquiredYear: ctx.world.year, condition: 100 });
    expect(assessHarm(ctx, { effects: [{ kind: 'spellbook', op: 'remove_copy', target: 'head', book: 'lesser_workings_of_life' }] }, {}).categories).toContain('inheritance');
    ctx.world.respect = 'eminent';
    expect(assessHarm(ctx, { effects: [{ kind: 'respect', delta: -1 }, { kind: 'respect', delta: -1 }] }, {}).respectDrop).toBe(2);
    ctx.world.respect = 'unknown';
    expect(assessHarm(ctx, { effects: [{ kind: 'respect', delta: -2 }] }, {}).categories).toEqual([]);
  });

  it('excludes only the agreed price', () => {
    const ctx = testWorld(content); const victim = place(ctx, { sex: 'female', age: 12 });
    const harm = assessHarm(ctx, { effects: [{ kind: 'treasury', delta: -900 }, { kind: 'status', target: { slot: 'V' }, status: 'dead' }], agreedPrices: [{ effect: 0, reason: 'purchase' }] }, { V: victim.id });
    expect(harm.categories).toEqual(['life']); expect(harm.cashLoss).toBe(0);
  });

  it('uses the inclusive gross-income boundary without treating ordinary book wear as destruction', () => {
    const ctx = testWorld(content); ctx.world.treasury = 1_000_000;
    const boundary = Math.max(50, recurringGrossIncome(ctx) / 2);
    expect(assessHarm(ctx, { effects: [{ kind: 'treasury', delta: -boundary + .01 }] }, {}).categories).not.toContain('financial');
    expect(assessHarm(ctx, { effects: [{ kind: 'treasury', delta: -boundary }] }, {}).categories).toContain('financial');
    ctx.world.library.clear();
    const ordinary = content.spellbooks.find(book => book.tier === 'minor')!;
    ctx.world.library.set(ordinary.id, { id: ordinary.id, acquiredYear: ctx.world.year, condition: 1 });
    const wear = assessHarm(ctx, { effects: [{ kind: 'spellbook', op: 'degrade', target: 'head', book: ordinary.id }] }, {});
    expect(wear.titlesLost).toEqual([]); expect(wear.categories).toEqual([]);
    const named = content.spellbooks.find(book => book.tier === 'named')!;
    ctx.world.library.set(named.id, { id: named.id, acquiredYear: ctx.world.year, condition: 1 });
    expect(assessHarm(ctx, { effects: [{ kind: 'spellbook', op: 'degrade', target: 'head', book: named.id }] }, {}).categories).toContain('inheritance');
  });

  it('counts only held Regalia and includes the actual Respect cost of proving a lie', () => {
    const ctx = testWorld(content); const regalia = content.heirlooms.find(item => item.kind === 'regalia')!;
    ctx.world.heirlooms.clear();
    const effects = [{ kind: 'heirloom' as const, op: 'transfer' as const, heirloom: regalia.id, to: 'house_marrow' }];
    expect(assessHarm(ctx, { effects }, {}).categories).toEqual([]);
    grantHeirloom(ctx, regalia.id);
    expect(assessHarm(ctx, { effects }, {}).regaliaLost).toEqual([regalia.id]);
    ctx.world.respect = 'regarded';
    ctx.world.discrepancies.set('the_lie', { severity: 'minor', provableBy: [], state: 'open' });
    expect(assessHarm(ctx, { effects: [{ kind: 'respect', delta: -1 }, { kind: 'discrepancy', op: 'prove', id: 'the_lie' }] }, {}).categories).toContain('political');
  });
});

describe('single automatic commit (#1868)', () => {
  it('uses only the local expresser and prevents kill, succession and duplicate charges', () => {
    const event = scene(); const outcome = event.interaction.kind === 'narration' ? event.interaction.outcomes[0]! : never();
    let successes = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const ctx = testWorld(content, seed); const local = expresser(ctx, 'Local'); const remote = expresser(ctx, 'Remote', 'another_hall');
      const victim = place(ctx, { sex: 'female', age: 12, name: 'Mira' });
      const fill = { VICTIM: victim.id };
      const preview = previewPrimordial(ctx, event, outcome, fill);
      expect(preview.candidates.map(p => p.id)).toEqual([local.id]);
      const rng = streamFor(ctx.world, 'unrelated'); const control = streamFor(ctx.world, 'unrelated');
      const kill = vi.spyOn(ctx.world.people, 'kill');
      const result = commitOutcome(ctx, event, outcome, fill, undefined, rng);
      expect(rng.next()).toBe(control.next());
      expect(ctx.world.decisionLog).toHaveLength(1);
      expect(ctx.world.pendingDecisions).toHaveLength(0);
      expect(ctx.world.frequency.templateFires[event.id]).toBe(1);
      if (!result.primordial) { expect(kill).toHaveBeenCalledOnce(); continue; }
      successes++;
      expect(kill).not.toHaveBeenCalled(); expect(victim.status).toBe('alive');
      expect(result.primordial.actor).toBe(local.id); expect(result.primordial.actor).not.toBe(remote.id);
      expect(result.text).toContain('Mira did not die'); expect(result.text).toContain('70 crowns were preserved');
      expect(result.outcome.id).toBe('caught');
      const saved = saveGame(ctx); const loaded = loadGame(saved, content);
      expect(interventionsOf(loaded)).toEqual(interventionsOf(ctx));
      expect(canonical(saveGame(loaded))).toBe(canonical(saved));
    }
    expect(successes).toBeGreaterThan(0); expect(successes).toBeLessThan(24);
  });

  it('has no global fallback, and excludes women, dead, guardian, unwoken and outsiders', () => {
    const ctx = testWorld(content); const p = expresser(ctx, 'Distant', 'another_hall');
    const victim = place(ctx, { sex: 'female', age: 12 });
    const e = scene(); const o = e.interaction.kind === 'narration' ? e.interaction.outcomes[0]! : never();
    const fill = { VICTIM: victim.id };
    expect(previewPrimordial(ctx, e, o, fill).candidates).toEqual([]);
    o.site = { kind: 'party', slots: ['VICTIM'] };
    expect(previewPrimordial(ctx, e, o, { VICTIM: p.id }).candidates).toHaveLength(1);
    p.awakening.awakened = false; expect(previewPrimordial(ctx, e, o, { VICTIM: p.id }).candidates).toEqual([]);
    p.awakening.awakened = true; p.status = 'guardian'; expect(previewPrimordial(ctx, e, o, { VICTIM: p.id }).candidates).toEqual([]);
  });

  it('stops after one successful trial and gives duplicates no extra trial', () => {
    const rng = makeRng(40); const bool = vi.spyOn(rng, 'bool').mockReturnValue(true);
    const candidates = [{ id: 'one', ep: 40, chance: .4 }, { id: 'two', ep: 90, chance: .9 }];
    expect(rollPrimordial([...candidates, candidates[0]!], rng)).toBeDefined(); expect(bool).toHaveBeenCalledOnce();
    expect(rollPrimordial(candidates, makeRng(40))).toEqual(rollPrimordial([...candidates].reverse(), makeRng(40)));
    expect(rollPrimordial([{ id: 'zero', ep: 0, chance: 0 }], makeRng(2))).toBeUndefined();
  });

  it('allows a living founder to act and refuses a response erased by tier clamps', () => {
    const ctx = testWorld(content); const actor = expresser(ctx, 'Founder');
    actor.becomesGuardian = true;
    const victim = place(ctx, { sex: 'female', age: 12 });
    const event = scene(); const normal = event.interaction.kind === 'narration' ? event.interaction.outcomes[0]! : never();
    const fill = { VICTIM: victim.id };
    expect(previewPrimordial(ctx, event, normal, fill).candidates.map(p => p.id)).toContain(actor.id);
    ctx.world.respect = 'regarded';
    normal.effects = [{ kind: 'respect', delta: -3 }];
    normal.primordial!.effects = [{ kind: 'respect', delta: -2 }];
    const preview = previewPrimordial(ctx, event, normal, fill);
    expect(preview.normal.categories).toContain('political');
    expect(preview.probability).toBe(0);
    expect(commitOutcome(ctx, event, normal, fill, undefined, makeRng(1)).primordial).toBeUndefined();
  });

  it('keeps pending/manual resolution, public omission and private history coherent across a save', () => {
    const ctx = testWorld(content, 1); expresser(ctx, 'Edric');
    const victim = place(ctx, { sex: 'female', age: 12, name: 'Mira' });
    const base = scene();
    const normal = base.interaction.kind === 'narration' ? base.interaction.outcomes[0]! : never();
    const record = structuredClone(content.mustEvent('the_hall_burns').record!);
    record.subject = 'the falling beam';
    record.options.record.chronicle = '{PRIMORDIAL_ACTOR} kept {VICTIM} alive.';
    record.options.record.claims = [];
    record.options.embellish.chronicle = '{PRIMORDIAL_ACTOR} prevented every loss.';
    record.options.embellish.claims = [];
    normal.primordial!.record = record;
    const event = EventTemplateS.parse({ ...base, record: { ...record, subject: 'the normal account' }, interaction: {
      kind: 'choice', choices: [
        { id: 'risk', label: 'Go through the door', outcomes: [normal] },
        { id: 'wait', label: 'Wait', outcomes: [{ id: 'waited', text: 'They waited.', effects: [] }] },
      ],
    } });
    const fill = { VICTIM: victim.id };
    const pending = queueChoice(ctx, event, event.body, fill, []);
    const restored = loadGame(saveGame(ctx), content);
    const seen: string[] = [];
    restored.observeOutcome = observation => seen.push(`${observation.selectedOutcome.id}/${observation.outcome.id}`);
    restored.observeAppliedOutcome = observation => seen.push(`${observation.selectedOutcome.id}/${observation.outcome.id}`);
    const result = resolveChoice(restored, pending.id, 'risk', makeRng(14));
    expect(result.ok).toBe(true);
    expect(result.resolved?.primordial).toBeDefined();
    expect(seen).toEqual(['fatal/caught', 'fatal/caught']);
    expect(restored.world.pendingDecisions).toHaveLength(1);
    expect(restored.world.pendingDecisions[0]!.kind).toBe('record');
    const receipt = result.resolved!.primordial!.receipt;
    const recordPending = restored.world.pendingDecisions[0]!;
    expect(resolveRecord(restored, recordPending.id, 'omit').ok).toBe(true);
    expect(restored.world.chronicle.find(page => page.id === result.resolved!.entryId)?.text).toBeNull();
    const again = loadGame(saveGame(restored), content);
    expect(interventionsOf(again)[0]!.record.receipt).toBe(receipt);
    expect(interventionsOf(again)[0]!.record.actorName).toBe('Edric');
    expect(again.world.frequency.templateFires[event.id]).toBe(1);
  });

  it('does not change a save or random stream when previewed repeatedly, and upgrades format 32 without invented history', () => {
    const ctx = testWorld(content, 1); expresser(ctx, 'Edric');
    const victim = place(ctx, { sex: 'female', age: 12 });
    const e = scene(); const o = e.interaction.kind === 'narration' ? e.interaction.outcomes[0]! : never();
    // Materialise the ordinary inputs once, just as an already-open decision does.
    previewPrimordial(ctx, e, o, { VICTIM: victim.id });
    const saved = saveGame(ctx);
    for (let i = 0; i < 3; i++) previewPrimordial(ctx, e, o, { VICTIM: victim.id });
    expect(canonical(saveGame(ctx))).toBe(canonical(saved));
    const legacy = { ...saved, format: 32 };
    expect(interventionsOf(loadGame(legacy, content))).toEqual([]);
  });
});

function never(): never { throw new Error('narration fixture'); }
