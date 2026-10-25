import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { asId, type EventTemplate, type Person } from '@ed/schema';
import { place, testRng, testWorld } from '../testing.js';
import { beginCommitment } from '../muster.js';
import { assignDuty, releaseDuty, tickMystic } from '../mystic.js';
import { resolvePresence } from '../presence.js';
import { knowsAffinity, loseLibraryCopy } from '../people/library.js';
import { captureFamily, ransomCaptive } from '../people/captivity.js';
import { resolveSlots } from './slots.js';
import { choiceAvailability } from './availability.js';
import { evalCheck, poolScore } from './checks.js';
import { evalFilter } from './conditions.js';
import { queueChoice, resolveChoice } from './decisions.js';
import { saveGame } from '../save.js';
import { resumeGame } from '../session.js';
import type { SimCtx } from '../world.js';

const content = loadContent();
const cases = [
  ['the_smoke_above_the_store', 'fluid', 'male'],
  ['the_smoke_above_the_store', 'thermal', 'male'],
  ['the_wind_under_the_slates', 'aero', 'male'],
  ['the_wind_under_the_slates', 'terra', 'male'],
  ['the_fever_and_the_vigil', 'life', 'female'],
  ['the_fever_and_the_vigil', 'death', 'female'],
  ['the_cawdry_copy', 'light', 'female'],
  ['the_cawdry_copy', 'darkness', 'female'],
] as const;

function fixture(row: readonly [string, (typeof cases)[number][1], Person['sex']] = cases[0]) {
  const [id, affinity, sex] = row;
  const ctx = testWorld(content);
  ctx.world.treasury = 500;
  for (const p of ctx.world.people.all()) p.spellsKnown = [];
  const helper = place(ctx, { sex: 'female', age: 35, name: 'Agnes at the hall' });
  helper.acquired = { ...helper.acquired, mind: 400, strength: 400, charm: 400 };
  const p = place(ctx, { sex, age: 30, name: 'Amice the reader' });
  p.spellsKnown = [asId(`lesser_workings_of_${affinity}`)];
  const deploymentBook = sex === 'male' ? 'lesser_workings_of_fluid' : 'lesser_workings_of_life';
  if (!p.spellsKnown.some(b => b === deploymentBook)) p.spellsKnown.push(asId(deploymentBook));
  p.acquired = { ...p.acquired, [affinity]: 200, mind: 200 };
  const event = content.event(id)!;
  if (event.interaction.kind !== 'choice') throw new Error('Expected an authored challenge');
  const choice = event.interaction.choices.find(c => c.id === `use_${affinity}`)!;
  const check = event.checks.find(c => c.id === choice.check)!;
  const slot = Object.keys(event.slots).find(s => event.slots[s]!.filters
    .some(f => 'knows' in f && f.knows.affinity === affinity))!;
  return { ctx, p, event, choice, check, slot, affinity };
}

function deploy(ctx: SimCtx, p: Person) {
  const working = p.sex === 'male' ? 'keeping_the_camp_water' : 'the_field_infirmary';
  const book = p.sex === 'male' ? 'lesser_workings_of_fluid' : 'lesser_workings_of_life';
  expect(p.spellsKnown).toContain(book);
  const c = beginCommitment(ctx, 10, 'the_wars');
  expect(assignDuty(ctx, { person: p.id, working, target: { kind: 'muster', commitment: c.id } }).ok).toBe(true);
  return ctx.world.mystic.assignments.find(a => a.practitioner === p.id)!;
}

describe('the actual learned reader must be at the authored incident (#1919)', () => {
  it.each(cases)('%s / %s loses only remote support, then regains it on return', (...row) => {
    const { ctx, p, event, choice, check, slot, affinity } = fixture(row);
    const home = resolveSlots(event, ctx, testRng('the same cast')).fill;
    expect(home[slot]).toBe(p.id);
    expect(choiceAvailability(choice, ctx, home, event).available).toBe(true);
    expect(evalCheck(ctx, check, event, home, testRng('the same check')).outcomeId).toBe('held');
    const pending = queueChoice(ctx, event, event.body, home, []);
    const knowledgeScore = poolScore(ctx, check.pool, home, event);

    const duty = deploy(ctx, p);
    expect(resolvePresence(ctx, { kind: 'hall', hall: 'main' }, {}).people).not.toContain(p.id);
    expect(knowsAffinity(ctx, p, affinity)).toBe(true);
    expect(evalFilter({ knows: { affinity } }, p, ctx, {})).toBe(true);
    const away = resolveSlots(event, ctx, testRng('the same cast')).fill;
    expect(away[slot]).toBeUndefined();
    expect(choiceAvailability(choice, ctx, away, event).available).toBe(false);
    // Knowledge and attributes stay factual; eligibility prevents their use here.
    expect(poolScore(ctx, check.pool, home, event)).toBe(knowledgeScore);
    expect(choiceAvailability(choice, ctx, home, event).available).toBe(false);
    const beforeRefusal = ctx.world.treasury;
    expect(resolveChoice(ctx, pending.id, choice.id, testRng('the same check')).ok).toBe(false);
    expect(ctx.world.treasury).toBe(beforeRefusal);

    expect(releaseDuty(ctx, duty.id).ok).toBe(true);
    const returned = resolveSlots(event, ctx, testRng('the same cast')).fill;
    expect(returned[slot]).toBe(p.id);
    expect(evalCheck(ctx, check, event, returned, testRng('the same check')).outcomeId).toBe('held');
    expect(resolveChoice(ctx, pending.id, choice.id, testRng('the same check')).ok).toBe(true);
  });

  it.each(cases)('%s / %s chooses a weaker present reader before the stronger absent one', (...row) => {
    const { ctx, p, event, slot, affinity } = fixture(row);
    const present = place(ctx, { sex: p.sex, age: 25, name: 'The present reader' });
    present.spellsKnown = [asId(`lesser_workings_of_${affinity}`)];
    expect(resolveSlots(event, ctx, testRng('cast')).fill[slot]).toBe(p.id);
    deploy(ctx, p);
    expect(resolveSlots(event, ctx, testRng('cast')).fill[slot]).toBe(present.id);
  });

  it.each(cases.filter((_, i) => i % 2 === 0))('%s does not turn affinity or a shelf copy into learned help', (...row) => {
    const { ctx, p, event, choice, check, affinity } = fixture(row);
    p.spellsKnown = [];
    const book = `lesser_workings_of_${affinity}`;
    ctx.world.library.set(book, { id: book, acquiredYear: ctx.world.year, condition: 100 });
    const fill = resolveSlots(event, ctx, testRng('cast')).fill;
    expect(poolScore(ctx, check.pool, fill, event)).toBe(0);
    // This is the genuinely unlearned attempt described by the existing failure.
    expect(choiceAvailability(choice, ctx, fill, event).available).toBe(true);
    expect(evalCheck(ctx, check, event, fill, testRng('check')).outcomeId).toBe('lost');
  });

  it('keeps completed knowledge useful after losing the physical book', () => {
    const { ctx, p, event, choice, check, affinity } = fixture();
    const book = `lesser_workings_of_${affinity}`;
    ctx.world.library.set(book, { id: book, acquiredYear: ctx.world.year, condition: 100 });
    expect(loseLibraryCopy(ctx, book)).toBe(true);
    const fill = resolveSlots(event, ctx, testRng('cast')).fill;
    expect(knowsAffinity(ctx, p, affinity)).toBe(true);
    expect(choiceAvailability(choice, ctx, fill, event).available).toBe(true);
    expect(evalCheck(ctx, check, event, fill, testRng('check')).outcomeId).toBe('held');
  });
});

describe('physical absence and recovery use the existing presence contract', () => {
  it.each(['other_hall', 'away_post', 'injury', 'unpaid_field', 'parcel_duty'] as const)('%s cannot support an incident at the seat', reason => {
    const data = fixture(reason === 'parcel_duty' ? cases[3] : cases[0]);
    const { ctx, p, event, choice, check, slot } = data;
    if (reason === 'other_hall') p.membership.find(m => m.to === undefined)!.branch = 'other_hall';
    if (reason === 'away_post') {
      const career = ctx.content.careers.find(c => c.resident !== 'home')!;
      p.career = { career: asId(career.id), from: ctx.world.year };
    }
    if (reason === 'injury') p.fieldRecoveryUntil = ctx.world.year + 2;
    if (reason === 'unpaid_field') {
      const a = deploy(ctx, p);
      ctx.world.year = a.ready;
      ctx.world.treasury = -1_000_000;
      tickMystic(ctx);
      expect(a).toMatchObject({ status: 'suspended', reason: 'unpaid' });
    }
    if (reason === 'parcel_duty') {
      const parcel = ctx.content.parcels.find(d => d.foundingHolding && d.kind === 'tenant_farm' && d.acres <= 140)!;
      expect(assignDuty(ctx, { person: p.id, working: 'shoring_the_banks',
        target: { kind: 'parcel', parcel: parcel.id, slots: ['WARDEN'] } }).ok).toBe(true);
    }
    const fill = resolveSlots(event, ctx, testRng('cast')).fill;
    expect(fill[slot]).toBeUndefined();
    expect(choiceAvailability(choice, ctx, fill, event).available).toBe(false);
  });

  it('a captive retains learning but cannot help until normal ransom returns them', () => {
    const { ctx, p, event, check, slot, affinity } = fixture();
    const captor = ctx.content.houses.find(h => !h.isPlayerHouse)!.id;
    expect(captureFamily(ctx, p.id, captor, 35)).toBe(true);
    expect(knowsAffinity(ctx, p, affinity)).toBe(true);
    const fill = resolveSlots(event, ctx, testRng('cast')).fill;
    expect(fill[slot]).toBeUndefined();
    expect(poolScore(ctx, check.pool, fill, event)).toBe(0);
    expect(ransomCaptive(ctx, p.id).ok).toBe(true);
    expect(resolveSlots(event, ctx, testRng('cast')).fill[slot]).toBe(p.id);
  });

  it('recovery ends on its saved deadline, without relearning the book', () => {
    const { ctx, p, event, choice, affinity } = fixture();
    p.fieldRecoveryUntil = ctx.world.year + 2;
    const loaded = resumeGame(JSON.parse(JSON.stringify(saveGame(ctx))), content);
    loaded.ctx.world.year += 2;
    const fill = resolveSlots(event, loaded.ctx, testRng('cast')).fill;
    expect(knowsAffinity(loaded.ctx, loaded.ctx.world.people.get(p.id)!, affinity)).toBe(true);
    expect(choiceAvailability(choice, loaded.ctx, fill, event).available).toBe(true);
  });
});

describe('the public command refuses a stale remote reader after reload', () => {
  it('keeps the pending decision and its mundane alternatives usable', () => {
    const { ctx, p, event } = fixture();
    const fill = resolveSlots(event, ctx, testRng('cast')).fill;
    const pending = queueChoice(ctx, event, event.body, fill, []);
    const commitment = beginCommitment(ctx, 10, 'the_wars');
    const session = resumeGame(JSON.parse(JSON.stringify(saveGame(ctx))), content);
    expect(session.order({ kind: 'mysticAssign', person: p.id, working: 'keeping_the_camp_water',
      target: { kind: 'muster', commitment: commitment.id } }).ok).toBe(true);
    const resumed = resumeGame(JSON.parse(JSON.stringify(session.save())), content);
    const treasury = resumed.ctx.world.treasury;
    expect(resumed.choose(pending.id, 'use_fluid').ok).toBe(false);
    expect(resumed.ctx.world.treasury).toBe(treasury);
    expect(resumed.pending.some(d => d.id === pending.id)).toBe(true);
    if (event.interaction.kind !== 'choice') throw new Error('Expected choice');
    const alternative = event.interaction.choices.find(c => c.check === 'family_work')!;
    expect(resumed.choose(pending.id, alternative.id).ok).toBe(true);
    expect(resumed.pending.some(d => d.id === pending.id)).toBe(false);
  });
});

describe('knowledge alone does not invent a physical site', () => {
  it('leaves background queries unchanged without an explicit common site', () => {
    const { ctx, p, event, affinity } = fixture();
    deploy(ctx, p);
    const background: EventTemplate = structuredClone(event);
    if (background.interaction.kind !== 'choice') throw new Error('Expected choice');
    for (const choice of background.interaction.choices) for (const outcome of choice.outcomes) delete outcome.site;
    const check = background.checks.find(c => c.pool.kind === 'family_knows')!;
    const fill = resolveSlots(background, ctx, testRng('cast')).fill;
    expect(poolScore(ctx, check.pool, fill, background)).toBe(1);
    expect(poolScore(ctx, { kind: 'family_knows', affinity }, {})).toBe(1);
  });
});
